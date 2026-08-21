/**
 * Which IP addresses this service is allowed to open a socket to.
 *
 * Fetching a candidate-supplied URL means making an outbound request with a
 * destination an untrusted user chose. The only thing standing between that and
 * "read the cloud metadata endpoint / reach an internal admin panel" is this
 * file, so it is written as an ALLOW-LIST BY EXCLUSION: every address is
 * blocked unless it is a normal, globally routable unicast address.
 *
 * Two properties are deliberate:
 *
 *  1. It classifies a resolved IP ADDRESS, never a hostname. A hostname says
 *     nothing about where a connection will land — `internal.example.com` can
 *     resolve to 10.0.0.5, and a public name can start resolving to a private
 *     address a second after it was checked. The caller resolves first and asks
 *     this module about the address it is about to connect to (see
 *     safe-fetcher.ts, which pins that exact address).
 *
 *  2. IPv4 addresses smuggled inside IPv6 (`::ffff:169.254.169.254`, NAT64,
 *     6to4, Teredo) are unwrapped and re-checked as IPv4. Checking only the
 *     v6 prefix is the classic bypass.
 */

/** Why an address was rejected — logged, never shown to the candidate. */
export type BlockedAddressReason =
  | 'unparseable'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'shared-cgnat'
  | 'multicast'
  | 'reserved'
  | 'documentation'
  | 'tunnel';

export interface AddressVerdict {
  allowed: boolean;
  reason?: BlockedAddressReason;
}

const ALLOWED: AddressVerdict = { allowed: true };

const block = (reason: BlockedAddressReason): AddressVerdict => ({
  allowed: false,
  reason,
});

/**
 * True when it is safe to connect to this address.
 *
 * Anything that cannot be parsed is blocked: an address this module does not
 * understand is an address it cannot vouch for.
 */
export function classifyAddress(address: string): AddressVerdict {
  const trimmed = address.trim().replace(/^\[|\]$/g, '');
  // A zone id (`fe80::1%en0`) only ever appears on link-local addresses, which
  // are blocked anyway — but strip it so parsing does not fail into a
  // less specific reason.
  const withoutZone = trimmed.split('%')[0];

  const v4 = parseIpv4(withoutZone);
  if (v4) return classifyIpv4(v4);

  const v6 = parseIpv6(withoutZone);
  if (v6) return classifyIpv6(v6);

  return block('unparseable');
}

export function isPublicAddress(address: string): boolean {
  return classifyAddress(address).allowed;
}

// --- IPv4 --------------------------------------------------------------------

function classifyIpv4(bytes: number[]): AddressVerdict {
  const [a, b] = bytes;

  if (a === 0) return block('reserved'); //          0.0.0.0/8   "this network"
  if (a === 127) return block('loopback'); //        127.0.0.0/8
  if (a === 10) return block('private'); //          10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return block('private'); // 172.16.0.0/12
  if (a === 192 && b === 168) return block('private'); //         192.168.0.0/16
  // 169.254.0.0/16 — link-local, and the home of 169.254.169.254: the AWS /
  // GCP / Azure / DigitalOcean instance metadata endpoint. This single line is
  // the difference between "fetches a portfolio" and "leaks cloud credentials".
  if (a === 169 && b === 254) return block('link-local');
  if (a === 100 && b >= 64 && b <= 127) return block('shared-cgnat'); // 100.64/10
  if (a >= 224 && a <= 239) return block('multicast'); //          224.0.0.0/4
  if (a >= 240) return block('reserved'); //   240.0.0.0/4 incl. 255.255.255.255
  if (a === 198 && (b === 18 || b === 19)) return block('reserved'); // 198.18/15

  if (a === 192 && b === 0) {
    const c = bytes[2];
    if (c === 0) return block('reserved'); //        192.0.0.0/24 IETF protocol
    if (c === 2) return block('documentation'); //   192.0.2.0/24 TEST-NET-1
  }
  if (a === 192 && b === 88 && bytes[2] === 99) return block('tunnel'); // 6to4
  if (a === 198 && b === 51 && bytes[2] === 100) return block('documentation');
  if (a === 203 && b === 0 && bytes[2] === 113) return block('documentation');

  return ALLOWED;
}

export function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  const bytes: number[] = [];
  for (const part of parts) {
    // Reject anything that is not plain decimal: `0x7f.0.0.1` and `010.0.0.1`
    // are accepted by some resolvers as 127.0.0.1 / 8.0.0.1, and a leading-zero
    // form must never be silently reinterpreted here.
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
}

// --- IPv6 --------------------------------------------------------------------

function classifyIpv6(bytes: number[]): AddressVerdict {
  const isZeroPrefix = (length: number) =>
    bytes.slice(0, length).every((byte) => byte === 0);

  // ::  and  ::1
  if (isZeroPrefix(15)) {
    if (bytes[15] === 0) return block('reserved');
    if (bytes[15] === 1) return block('loopback');
  }

  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 costume. Judge the IPv4.
  if (isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return classifyIpv4(bytes.slice(12));
  }
  // 64:ff9b::/96 — NAT64. Same story: the low 32 bits are the real target.
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  ) {
    return classifyIpv4(bytes.slice(12));
  }
  // 2002::/16 — 6to4. It embeds an arbitrary v4 endpoint in bytes 2..5, so the
  // whole prefix is refused rather than unwrapped: nothing legitimate in this
  // product is served over a 6to4 relay.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return block('tunnel');
  // 2001::/32 — Teredo tunnels to an arbitrary v4 endpoint; never a portfolio.
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0 &&
    bytes[3] === 0
  ) {
    return block('tunnel');
  }
  // 2001:db8::/32 — documentation.
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return block('documentation');
  }
  // 100::/64 — discard-only.
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && isTail(bytes, 2, 8)) {
    return block('reserved');
  }
  // fc00::/7 — unique local (the IPv6 answer to 10.0.0.0/8).
  if ((bytes[0] & 0xfe) === 0xfc) return block('private');
  // fe80::/10 — link-local.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)
    return block('link-local');
  // ff00::/8 — multicast.
  if (bytes[0] === 0xff) return block('multicast');

  return ALLOWED;
}

function isTail(bytes: number[], from: number, to: number): boolean {
  return bytes.slice(from, to).every((byte) => byte === 0);
}

export function parseIpv6(value: string): number[] | null {
  if (!value.includes(':')) return null;

  let text = value;
  let trailingV4: number[] | null = null;

  // A trailing dotted-quad (`::ffff:192.168.0.1`) is legal IPv6 text.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    trailingV4 = parseIpv4(tail);
    if (!trailingV4) return null;
    text = text.slice(0, lastColon + 1) + '0:0';
  }

  const doubleColonCount = text.split('::').length - 1;
  if (doubleColonCount > 1) return null;

  const [head, rest] = doubleColonCount === 1 ? text.split('::') : [text, null];
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = rest === null || rest === '' ? [] : rest.split(':');

  const groupCount = headGroups.length + tailGroups.length;
  if (doubleColonCount === 0 && groupCount !== 8) return null;
  if (doubleColonCount === 1 && groupCount > 7) return null;

  const toBytes = (group: string): number[] | null => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const word = Number.parseInt(group, 16);
    return [(word >> 8) & 0xff, word & 0xff];
  };

  const bytes: number[] = [];
  for (const group of headGroups) {
    const pair = toBytes(group);
    if (!pair) return null;
    bytes.push(...pair);
  }
  const zeroFill = 16 - groupCount * 2;
  if (doubleColonCount === 1)
    bytes.push(...new Array<number>(zeroFill).fill(0));
  for (const group of tailGroups) {
    const pair = toBytes(group);
    if (!pair) return null;
    bytes.push(...pair);
  }

  if (bytes.length !== 16) return null;
  if (trailingV4) {
    bytes[12] = trailingV4[0];
    bytes[13] = trailingV4[1];
    bytes[14] = trailingV4[2];
    bytes[15] = trailingV4[3];
  }
  return bytes;
}

import { classifyAddress, isPublicAddress, parseIpv6 } from './ip-guard';

/**
 * The SSRF address gate.
 *
 * These are not "coverage" tests. Each case below is a documented way to reach
 * something a candidate's portfolio link must never reach — a loopback service,
 * a private subnet, the cloud instance metadata endpoint — and a regression in
 * any single line of ip-guard.ts turns this feature into a credential leak.
 */
describe('classifyAddress', () => {
  describe('IPv4 — blocked', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback'],
      ['0.0.0.0', 'reserved'],
      ['10.0.0.1', 'private'],
      ['10.255.255.255', 'private'],
      ['172.16.0.1', 'private'],
      ['172.31.255.255', 'private'],
      ['192.168.0.1', 'private'],
      ['192.168.255.255', 'private'],
      ['100.64.0.1', 'shared-cgnat'],
      ['169.254.0.1', 'link-local'],
      // The one that matters most: AWS/GCP/Azure instance metadata.
      ['169.254.169.254', 'link-local'],
      ['224.0.0.1', 'multicast'],
      ['255.255.255.255', 'reserved'],
      ['192.0.0.1', 'reserved'],
      ['192.0.2.5', 'documentation'],
      ['198.18.0.1', 'reserved'],
      ['198.51.100.5', 'documentation'],
      ['203.0.113.5', 'documentation'],
      ['192.88.99.1', 'tunnel'],
    ])('blocks %s (%s)', (address, reason) => {
      expect(classifyAddress(address)).toEqual({ allowed: false, reason });
    });
  });

  describe('IPv4 — allowed', () => {
    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.15.255.255', // just below the private 172.16/12 block
      '172.32.0.1', //     just above it
      '100.63.255.255', // just below the CGNAT 100.64/10 block
      '100.128.0.1', //    just above it
      '11.0.0.1',
      '223.255.255.255', // just below multicast
    ])('allows %s', (address) => {
      expect(isPublicAddress(address)).toBe(true);
    });
  });

  describe('IPv6 — blocked', () => {
    it.each([
      ['::1', 'loopback'],
      ['::', 'reserved'],
      ['fc00::1', 'private'],
      ['fd12:3456:789a::1', 'private'],
      ['fe80::1', 'link-local'],
      ['ff02::1', 'multicast'],
      ['2001:db8::1', 'documentation'],
      ['2001::1', 'tunnel'], //  Teredo
      ['2002:c0a8:0001::1', 'tunnel'], // 6to4
      ['0100::1', 'reserved'], // discard-only
    ])('blocks %s (%s)', (address, reason) => {
      expect(classifyAddress(address)).toEqual({ allowed: false, reason });
    });

    it('allows a normal global unicast address', () => {
      expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    });
  });

  describe('IPv4 smuggled inside IPv6', () => {
    /**
     * The classic bypass: check the v6 prefix, miss the v4 payload. Each of
     * these decodes to an address that must stay blocked.
     */
    it.each([
      ['::ffff:127.0.0.1', 'loopback'],
      ['::ffff:169.254.169.254', 'link-local'],
      ['::ffff:10.0.0.1', 'private'],
      ['::ffff:192.168.1.1', 'private'],
      ['64:ff9b::169.254.169.254', 'link-local'], // NAT64
    ])('unwraps and blocks %s (%s)', (address, reason) => {
      expect(classifyAddress(address)).toEqual({ allowed: false, reason });
    });

    it('still allows a mapped public address', () => {
      expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    });
  });

  describe('parsing', () => {
    it('blocks anything it cannot parse rather than assuming it is fine', () => {
      for (const value of [
        '',
        'not-an-address',
        '999.1.1.1',
        '1.2.3',
        'x::y',
      ]) {
        expect(classifyAddress(value)).toEqual({
          allowed: false,
          reason: 'unparseable',
        });
      }
    });

    it('rejects octal and hex IPv4 forms instead of reinterpreting them', () => {
      // Some resolvers read 0177.0.0.1 as 127.0.0.1 and 0x7f.0.0.1 likewise.
      // Refusing to parse them is safe; quietly parsing them as decimal is not.
      expect(classifyAddress('0177.0.0.1').allowed).toBe(false);
      expect(classifyAddress('010.0.0.1').allowed).toBe(false);
      expect(classifyAddress('0x7f.0.0.1').allowed).toBe(false);
    });

    it('strips brackets and zone identifiers', () => {
      expect(classifyAddress('[::1]').reason).toBe('loopback');
      expect(classifyAddress('fe80::1%en0').reason).toBe('link-local');
    });

    it('parses compressed and full IPv6 to the same bytes', () => {
      expect(parseIpv6('2001:db8::1')).toEqual(
        parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'),
      );
    });
  });
});

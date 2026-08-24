import { Logger } from '@nestjs/common';

/**
 * Which tenants of a provider this deployment reads.
 *
 * ## Configured, never discovered
 *
 * Every multi-tenant job API addresses its customers by a short slug that is
 * usually just the company name — `vercel`, `matchgroup`, `gopuff`. They are
 * therefore trivially guessable, and a sweep that tried them would be
 * enumerating other people's tenants at volume because the URLs happen to
 * resolve. That is not something this product gets to do, so scopes are
 * listed one at a time by whoever runs the deployment and there is no code
 * path that can invent one.
 *
 * ## The slug is untrusted input that becomes a URL path
 *
 * It arrives from the environment and is pasted into a request path, so it is
 * validated rather than escaped and hoped for: a plain slug, or it is dropped
 * with a warning. Nothing containing a slash, a dot, a percent or whitespace
 * survives, which rules out traversal (`../../v1/harvest`), a full URL
 * (`https://evil.example/x`) and encoded variants of both.
 *
 * Shared by every provider because "which tenants do we read" is not a fact
 * about any one vendor.
 *
 * One property to know before adding a provider: slugs are LOWERCASED. That is
 * safe for Greenhouse, Lever and Ashby — all three resolve `Ashby`, `ashby` and
 * `ASHBY` identically, verified live. A provider whose tenant identifiers are
 * case-SENSITIVE cannot use this parser unchanged, and would need the folding
 * moved behind a per-provider option rather than discovering the problem as a
 * 404 in production.
 */

export interface ProviderScope {
  /** The tenant identifier as it appears in the API path. */
  slug: string;
  /** Optional human label for logs, run records and company fallback. */
  label: string;
  enabled: boolean;
}

/**
 * Lowercase alphanumerics, hyphens and underscores. Anything else would be an
 * attempt to change the shape of the request path.
 */
const SCOPE_SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/;

export function parseScopeConfig(
  raw: string | undefined,
  options: { logger?: Logger; provider: string } = { provider: 'provider' },
): ProviderScope[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const scopes: ProviderScope[] = [];

  // Split on commas only. Labels may contain spaces, and splitting on
  // whitespace first would turn "acme:Acme Corporation" into two entries, one
  // of them a tenant called "Corporation".
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.includes('/')) {
      // A URL, not a slug. Rejected before the colon split, which would
      // otherwise read "https" out of "https://evil.example/x" and accept it.
      options.logger?.warn(
        `Ignoring a ${options.provider} scope entry that looks like a URL`,
      );
      continue;
    }
    // `slug:Label` — the label is cosmetic and never reaches a URL.
    const [slugPart, ...labelParts] = trimmed.split(':');
    const slug = slugPart.trim().toLowerCase();
    if (!SCOPE_SLUG.test(slug)) {
      // The value itself is not echoed: it is untrusted input and this line
      // goes to a log file.
      options.logger?.warn(
        `Ignoring a malformed ${options.provider} scope (${slug.length} chars)`,
      );
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    scopes.push({
      slug,
      label: labelParts.join(':').trim() || slug,
      enabled: true,
    });
  }
  return scopes;
}

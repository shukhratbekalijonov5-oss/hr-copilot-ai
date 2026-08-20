import type { Locale } from "@/lib/i18n/locales";

/**
 * In-tab cache scope for candidate job-match results.
 *
 * The value is deliberately tied to the authenticated user and rendered locale:
 * match evidence is personal data, and AI explanations are generated in the
 * request locale. The cache itself lives only in memory, never localStorage.
 */
export function jobMatchCacheKey(userId: string, locale: Locale): string {
  return `candidate-job-match:${userId}:${locale}`;
}

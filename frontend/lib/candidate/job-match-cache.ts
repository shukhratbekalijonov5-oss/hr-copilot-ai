import type { ApplicationStatus, JobMatchResult } from "@/lib/types";

type MatchPatch = {
  saved?: boolean;
  applicationState?: ApplicationStatus | null;
};

const cache = new Map<string, JobMatchResult>();

export function getCachedJobMatchResult(
  key: string | null | undefined,
): JobMatchResult | null {
  if (!key) return null;
  return cache.get(key) ?? null;
}

export function setCachedJobMatchResult(
  key: string | null | undefined,
  result: JobMatchResult,
): void {
  if (!key) return;
  cache.set(key, result);
}

export function clearCachedJobMatchResult(key: string | null | undefined): void {
  if (!key) return;
  cache.delete(key);
}

export function patchJobMatchResult(
  result: JobMatchResult,
  slug: string,
  patch: MatchPatch,
): JobMatchResult {
  let changed = false;
  const matches = result.matches.map((match) => {
    if (match.vacancy.slug !== slug) return match;

    changed = true;
    return {
      ...match,
      ...(patch.saved !== undefined ? { saved: patch.saved } : {}),
      ...(patch.applicationState !== undefined
        ? { applicationState: patch.applicationState }
        : {}),
    };
  });

  return changed ? { ...result, matches } : result;
}

export function patchCachedJobMatch(
  key: string | null | undefined,
  slug: string,
  patch: MatchPatch,
): JobMatchResult | null {
  const current = getCachedJobMatchResult(key);
  if (!current) return null;

  const next = patchJobMatchResult(current, slug, patch);
  setCachedJobMatchResult(key, next);
  return next;
}

export function patchCachedJobMatchSaved(
  key: string | null | undefined,
  slug: string,
  saved: boolean,
): JobMatchResult | null {
  return patchCachedJobMatch(key, slug, { saved });
}

export function patchCachedJobMatchApplicationState(
  key: string | null | undefined,
  slug: string,
  applicationState: ApplicationStatus,
): JobMatchResult | null {
  return patchCachedJobMatch(key, slug, { applicationState });
}

export function clearJobMatchCacheForTests(): void {
  cache.clear();
}

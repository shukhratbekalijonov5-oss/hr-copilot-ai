"use server";

import { api } from "@/lib/api";
import { runAiAction, type AiActionResult } from "@/lib/api/ai-failure";
import { getLocale } from "@/lib/i18n/server";
import type { ComparisonResult } from "@/lib/types";

/**
 * Rebuilds the comparison when the selection changes.
 *
 * It runs on the server so the evidence lookups use the session cookie and the
 * client never needs a token. It reports what the documents contain; it does
 * not rank the candidates or name a winner.
 *
 * Classified as a retrieval surface: reading a stored evidence map touches the
 * database and the vector index, never the generation provider.
 */
export async function compareCandidatesAction(
  vacancyId: string,
  candidateIds: string[],
): Promise<AiActionResult<ComparisonResult>> {
  return runAiAction("retrieval", () =>
    api.compareCandidates(vacancyId, candidateIds),
  );
}

/** Maps every selected candidate that has no stored map yet, then rebuilds. */
export async function mapMissingCandidatesAction(
  vacancyId: string,
  candidateIds: string[],
): Promise<AiActionResult<ComparisonResult>> {
  const locale = await getLocale();
  return runAiAction("retrieval", () =>
    api.mapMissingCandidates(vacancyId, candidateIds, locale),
  );
}

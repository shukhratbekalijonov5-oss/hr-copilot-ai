import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { runAiAction, type AiActionResult } from "@/lib/api/ai-failure";
import type { Locale } from "@/lib/i18n/locales";
import type { EvidenceSearchResult, GroundedAnswer } from "@/lib/types";

/**
 * The two halves of a recruiter search, as independently settled results.
 *
 * One query fans out into two backend calls — `POST /search/evidence` for
 * retrieval and `POST /ai/answer` for the grounded summary — and the page
 * starts both WITHOUT awaiting either, so retrieval (~2s) is never held
 * hostage to generation (~20-30s). Server Actions cannot provide that:
 * Next.js dispatches actions one at a time per client, so two actions would
 * serialize. Un-awaited fetches in the Server Component, streamed through
 * separate Suspense boundaries, are the framework's supported equivalent of
 * `Promise.allSettled` here.
 *
 * Both functions settle rather than throw, for two reasons. A rejected
 * promise passed to a client component would take down the boundary instead
 * of rendering the failure honestly — and each side must fail alone: a dead
 * LLM must not hide working retrieval, and a retrieval error must not hide a
 * validated answer.
 *
 * Neither call sends a candidateId: this page is the org-wide search, and the
 * tenant itself always comes from the JWT, never from a parameter. An optional
 * owned `vacancyId` narrows retrieval to that pipeline's candidates and gives
 * generation the vacancy's context; omitting it keeps the search org-wide.
 */

import {
  MIN_ANSWER_QUERY_LENGTH,
  MIN_EVIDENCE_QUERY_LENGTH,
} from "@/lib/search/constants";

export { MIN_ANSWER_QUERY_LENGTH, MIN_EVIDENCE_QUERY_LENGTH };

export type EvidenceFetchResult =
  | { ok: true; result: EvidenceSearchResult }
  | { ok: false; message: string; unavailable: boolean };

/** Retrieval half. Same result shape the search screen has always rendered. */
export async function runEvidenceSearch(
  query: string,
  vacancyId?: string,
): Promise<EvidenceFetchResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_EVIDENCE_QUERY_LENGTH) {
    return { ok: false, message: "", unavailable: false };
  }

  try {
    return {
      ok: true,
      result: await api.searchEvidence({ query: trimmed, vacancyId }),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // 503 means retrieval itself is down. That is a different thing from
      // "no matches", and the UI must not blur the two.
      return {
        ok: false,
        message: error.message,
        unavailable: error.kind === "unavailable",
      };
    }
    return { ok: false, message: "", unavailable: false };
  }
}

/**
 * Generation half. A query long enough to search but too short to answer
 * (exactly 2 characters) reports `invalid` without a network call, so the
 * summary slot can say why instead of surfacing a backend 400.
 */
export async function runGroundedAnswer(
  query: string,
  locale: Locale,
  vacancyId?: string,
): Promise<AiActionResult<GroundedAnswer>> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_ANSWER_QUERY_LENGTH) {
    return { ok: false, reason: "invalid", message: "Query too short." };
  }

  // No candidateId here — this is the org-wide surface — so the vacancy stays
  // optional generation context rather than a required pair.
  return runAiAction("generation", () =>
    api.answerQuestion({ query: trimmed, locale, vacancyId }),
  );
}

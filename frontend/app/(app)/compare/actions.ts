"use server";

import { api, ApiError } from "@/lib/api";
import type { ComparisonResult } from "@/lib/types";

export type CompareResult =
  | { ok: true; result: ComparisonResult }
  | { ok: false; message: string };

/**
 * Rebuilds the comparison when the selection changes.
 *
 * It runs on the server so the evidence lookups use the session cookie and the
 * client never needs a token. It reports what the documents contain; it does
 * not rank the candidates or name a winner.
 */
export async function compareCandidatesAction(
  vacancyId: string,
  candidateIds: string[],
): Promise<CompareResult> {
  try {
    return { ok: true, result: await api.compareCandidates(vacancyId, candidateIds) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not build the comparison." };
  }
}

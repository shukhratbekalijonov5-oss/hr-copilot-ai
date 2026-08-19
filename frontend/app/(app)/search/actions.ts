"use server";

import { api, ApiError } from "@/lib/api";
import type { EvidenceSearchResult } from "@/lib/types";

export type SearchActionResult =
  | { ok: true; result: EvidenceSearchResult }
  | { ok: false; message: string; unavailable: boolean };

/**
 * Runs an evidence search on the server, so the session cookie authenticates it
 * and the browser never holds a token. The organization is never passed — the
 * backend takes it from the authenticated user.
 */
export async function searchEvidenceAction(
  query: string,
): Promise<SearchActionResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return {
      ok: false,
      message: "Enter at least two characters to search.",
      unavailable: false,
    };
  }

  try {
    return { ok: true, result: await api.searchEvidence({ query: trimmed }) };
  } catch (error) {
    if (error instanceof ApiError) {
      // 503 means the AI service is down or unconfigured. That is a different
      // thing from "no matches", and the UI must not blur the two.
      return {
        ok: false,
        message: error.message,
        unavailable: error.kind === "unavailable",
      };
    }
    return {
      ok: false,
      message: "Search failed. Try again shortly.",
      unavailable: false,
    };
  }
}

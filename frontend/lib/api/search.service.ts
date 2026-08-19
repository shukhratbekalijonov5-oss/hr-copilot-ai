import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toEvidenceSearchResult } from "@/lib/api/adapters";
import type { EvidenceSearchResponse } from "@/lib/api/contracts";
import type { EvidenceSearchResult } from "@/lib/types";

export interface EvidenceSearchInput {
  query: string;
  /** Optional narrowing. Both are verified against the tenant by the backend. */
  candidateId?: string;
  documentId?: string;
  limit?: number;
  rerank?: boolean;
}

/**
 * Semantic search over indexed resume passages.
 *
 * Note what is *not* sent: no organizationId. The backend derives the tenant
 * from the authenticated user, and accepting one from the client would turn
 * tenancy into a request parameter.
 *
 * Throws ApiError(503) when the AI service is not configured, which the UI
 * shows as unavailable rather than as "no matches".
 */
export async function searchEvidence(
  input: EvidenceSearchInput,
): Promise<EvidenceSearchResult> {
  const response = await apiFetch<EvidenceSearchResponse>("/search/evidence", {
    method: "POST",
    body: {
      query: input.query.trim(),
      candidateId: input.candidateId,
      documentId: input.documentId,
      limit: input.limit ?? 20,
      rerank: input.rerank ?? true,
    },
  });

  return toEvidenceSearchResult(response);
}

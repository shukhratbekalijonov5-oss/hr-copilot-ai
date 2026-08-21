import "server-only";

import { apiFetch, fetchAllPages, type Paginated } from "@/lib/api/http";
import { toDocument } from "@/lib/api/adapters";
import type {
  DocumentResponse,
  DownloadUrlResponse,
} from "@/lib/api/contracts";
import type { CandidateDocument, DocumentStatus, DocumentType } from "@/lib/types";

export async function getDocuments(query: {
  candidateId?: string;
  type?: DocumentType;
  status?: DocumentStatus;
  page?: number;
  limit?: number;
} = {}): Promise<{ documents: CandidateDocument[]; total: number }> {
  const response = await apiFetch<Paginated<DocumentResponse>>("/documents", {
    query: {
      page: query.page ?? 1,
      limit: query.limit ?? 100,
      candidateId: query.candidateId,
      type: query.type,
      status: query.status,
    },
  });

  return {
    documents: response.data.map((document) => toDocument(document)),
    total: response.meta.total,
  };
}

export async function getAllDocuments(): Promise<CandidateDocument[]> {
  const rows = await fetchAllPages<DocumentResponse>("/documents");
  return rows.map((document) => toDocument(document));
}

export async function getDocument(id: string): Promise<CandidateDocument> {
  return toDocument(await apiFetch<DocumentResponse>(`/documents/${id}`));
}

/**
 * Mints a short-lived signed URL for one document.
 *
 * Resume files are never public: the backend returns either a presigned R2 URL
 * or an HMAC-signed local download link, both of which expire. The frontend
 * holds no storage credentials of any kind.
 */
export async function getDocumentDownloadUrl(
  id: string,
): Promise<DownloadUrlResponse> {
  return apiFetch<DownloadUrlResponse>(`/documents/${id}/download-url`);
}

/*
 * There is deliberately no upload function here: `POST /documents` was removed
 * from the API. Organization documents are written only by the apply flow's
 * snapshot of the resume a candidate submitted; the sole upload surface in the
 * product is the candidate's own `/candidate-account/me/documents`.
 */

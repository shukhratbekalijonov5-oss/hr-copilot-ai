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

/**
 * Uploads one file. The API takes a single `file` per request, so a multi-file
 * selection in the UI becomes N requests — see the upload route handler.
 */
export async function uploadDocument(
  file: File,
  options: { candidateId?: string; type?: DocumentType } = {},
): Promise<CandidateDocument> {
  const formData = new FormData();
  formData.append("file", file);
  if (options.candidateId) formData.append("candidateId", options.candidateId);
  formData.append("type", options.type ?? "RESUME");

  return toDocument(
    await apiFetch<DocumentResponse>("/documents", {
      method: "POST",
      formData,
    }),
  );
}

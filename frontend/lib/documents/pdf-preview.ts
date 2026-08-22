export const PDF_MIME_TYPE = "application/pdf";

export function isPdfMimeType(mimeType: string | null | undefined): boolean {
  return mimeType?.split(";")[0]?.trim().toLowerCase() === PDF_MIME_TYPE;
}

/**
 * Paths of the CURRENT-document routes. Both re-verify the owned-vacancy +
 * applicant + current-ownership chain server-side on every call, which is why
 * they are addressed by (candidate, vacancy, document) rather than a bare
 * document id.
 */
export function currentDocumentUrlPath(
  candidateId: string,
  vacancyId: string,
  documentId: string,
): string {
  return (
    `/api/candidates/${encodeURIComponent(candidateId)}` +
    `/current-documents/${encodeURIComponent(documentId)}/url` +
    `?vacancyId=${encodeURIComponent(vacancyId)}`
  );
}

export function currentDocumentPreviewPath(
  candidateId: string,
  vacancyId: string,
  documentId: string,
): string {
  return (
    `/api/candidates/${encodeURIComponent(candidateId)}` +
    `/current-documents/${encodeURIComponent(documentId)}/preview` +
    `?vacancyId=${encodeURIComponent(vacancyId)}`
  );
}

export function pdfFrameSource(objectUrl: string, page: number): string {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return `${objectUrl}#page=${safePage}&view=FitH`;
}

export function isSameDocumentPreview(
  previewDocumentId: string | null,
  activeDocumentId: string | null,
): boolean {
  return previewDocumentId !== null && previewDocumentId === activeDocumentId;
}

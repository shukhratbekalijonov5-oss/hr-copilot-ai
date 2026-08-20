export const PDF_MIME_TYPE = "application/pdf";

export function isPdfMimeType(mimeType: string | null | undefined): boolean {
  return mimeType?.split(";")[0]?.trim().toLowerCase() === PDF_MIME_TYPE;
}

export function documentPreviewPath(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/preview`;
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

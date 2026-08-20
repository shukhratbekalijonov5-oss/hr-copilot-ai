import type { Dictionary } from "@/lib/i18n/dictionary";

export const DOCUMENT_ERROR_CODES = [
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "PERSONAL_DOCUMENT_LIMIT_REACHED",
  "HR_DOCUMENT_UPLOAD_NOT_ALLOWED",
] as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export function isDocumentErrorCode(
  code: string | null | undefined,
): code is DocumentErrorCode {
  return (DOCUMENT_ERROR_CODES as readonly string[]).includes(code ?? "");
}

export function localizedDocumentError(
  code: string | null | undefined,
  d: Dictionary,
  fallback: string,
): string {
  return isDocumentErrorCode(code) ? d.upload.errorCodes[code] : fallback;
}

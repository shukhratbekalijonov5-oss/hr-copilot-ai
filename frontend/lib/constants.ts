export const APP_NAME = "HR Copilot AI";

/**
 * Non-textual constants only.
 *
 * Every human-readable label for a backend enum now lives in the dictionaries
 * under `lib/i18n/dictionaries/*` — keeping a second English-only copy here
 * would be a source of untranslated strings that typecheck cleanly.
 */

/**
 * Employment type and experience level are free-form strings on the API. These
 * are suggestions offered in the create form, not a closed enum.
 */
export const EMPLOYMENT_TYPE_OPTIONS = [
  "Full-time",
  "Part-time",
  "Contract",
  "Internship",
  "Temporary",
] as const;

export const EXPERIENCE_LEVEL_OPTIONS = [
  "Intern",
  "Junior",
  "Mid-level",
  "Senior",
  "Lead",
  "Principal",
] as const;

/**
 * Upload limits. These mirror the backend's own validation
 * (backend/src/documents/file-validation.ts) — it accepts PDF and DOCX only,
 * and rejects anything whose magic number disagrees with its extension.
 */
export const ACCEPTED_RESUME_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const ACCEPTED_RESUME_EXTENSIONS = [".pdf", ".docx"] as const;

/** Backend default is MAX_FILE_SIZE_BYTES; keep this at or below it. */
export const MAX_RESUME_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * The largest UPLOAD REQUEST the Next upload route will relay.
 *
 * Deliberately larger than MAX_RESUME_SIZE_BYTES, and deliberately not the
 * product limit. A multipart request wraps the file in headers and a boundary,
 * so a valid 50 MB file arrives as a body slightly over 50 MB — a ceiling of
 * exactly 50 MB would reject files the product allows.
 *
 * This is a bound on relayed bytes, nothing more. The real 50 MB per-file rule
 * is enforced by the backend (Multer's `limits.fileSize` and then
 * `validateUploadedFile`), where it cannot be bypassed by skipping this route.
 */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_RESUME_SIZE_BYTES + 2 * 1024 * 1024;

export const MAX_COMPARE_CANDIDATES = 5;
export const MIN_COMPARE_CANDIDATES = 2;

/** Minimal class-name joiner — avoids pulling in clsx for a 6-line helper. */
export function cn(
  ...values: Array<string | false | null | undefined>
): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Date, time and number formatting lives in `lib/i18n/format.ts`.
 *
 * The `en-US` helpers that used to sit here were removed with the i18n work:
 * they were untranslatable, and because they read the host's ICU tables they
 * were also a hydration-mismatch source between the Node render and the
 * browser. Nothing here may format a date again.
 */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Derives the organization slug the API expects: lowercase alphanumeric words
 * joined by hyphens (backend RegisterDto enforces this pattern).
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

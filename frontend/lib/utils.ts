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

/**
 * A URL shortened for display.
 *
 * Long URLs must never be rendered at full length: a 300-character address
 * overflows every layout it lands in, on mobile first. The scheme and `www.`
 * carry no information for a reader, the middle of a long path does not
 * either, and the full address stays on the anchor's href and title so nothing
 * is actually lost.
 */
export function displayUrl(url: string, maxLength = 48): string {
  let readable = url;
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    readable = `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    readable = url.replace(/^https?:\/\/(www\.)?/, "");
  }

  if (readable.length <= maxLength) return readable;
  // Elide the middle, keeping the host (which says whose site it is) and the
  // tail (which says which page).
  const head = readable.slice(0, maxLength - 12);
  return `${head}…${readable.slice(-10)}`;
}

/**
 * Display-only handling of evidence snippets.
 *
 * A snippet is the candidate's own words and is never rewritten: PDF
 * extraction sometimes produces letter-spaced or run-together text, and that
 * stays visible exactly as extracted — polishing it away would misrepresent
 * what the document actually yielded. The only adjustment allowed here is
 * whitespace presentation: runs of spaces and newlines collapse to single
 * spaces (which is how HTML renders them anyway) and the ends are trimmed,
 * so no character of content is added, removed or reordered.
 */

export function displaySnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Above this length a source card clamps the snippet behind "Show more".
 *
 * Character count rather than measured lines: a deterministic threshold can
 * be tested and renders identically on server and client, where a
 * layout-measured one would flicker on hydration.
 */
export const SNIPPET_PREVIEW_LIMIT = 260;

export function isLongSnippet(text: string): boolean {
  return displaySnippet(text).length > SNIPPET_PREVIEW_LIMIT;
}

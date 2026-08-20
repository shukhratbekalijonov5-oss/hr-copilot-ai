import { displaySnippet } from "@/lib/ai/snippet";

/**
 * Deriving a readable evidence preview from a raw citation snippet.
 *
 * Everything here is deterministic string handling of text the backend
 * returned — no inference, no repair, no guessed words. The two hard rules:
 *
 *  - A preview may only TRIM or RESHAPE what is there (split an existing
 *    comma list, cut prose at a word boundary). It never adds characters the
 *    source does not contain and never reorders anything.
 *  - Malformed extraction stays malformed. Splitting "FullStackDeveloper"
 *    into words or joining "R a k h m a t i l l o" back together would be
 *    the frontend guessing at content, which belongs to the parser layer.
 */

/**
 * The section vocabulary the AI service's chunker emits
 * (ai-service/app/parsers/sections.py SECTION_KEYWORDS). Anything else —
 * including a missing section — gets the generic localized heading instead
 * of leaking an internal value onto the screen.
 */
export const KNOWN_SECTIONS = [
  "summary",
  "experience",
  "projects",
  "skills",
  "education",
  "certifications",
  "languages",
] as const;

export type KnownSection = (typeof KNOWN_SECTIONS)[number];

export function sectionKey(section: string | null): KnownSection | null {
  if (!section) return null;
  const normalized = section.trim().toLowerCase();
  return (KNOWN_SECTIONS as readonly string[]).includes(normalized)
    ? (normalized as KnownSection)
    : null;
}

export type EvidencePreview =
  | {
      kind: "list";
      /** The source's own comma-separated items, trimmed — nothing added. */
      tokens: string[];
      /** Lists are always a reshaped presentation, so the raw stays reachable. */
      showOriginal: true;
    }
  | {
      kind: "prose";
      text: string;
      /** True when the excerpt cut something off. */
      showOriginal: boolean;
    };

/** A list needs at least this many items to be treated as one. */
const MIN_LIST_TOKENS = 4;
/** Tokens longer than this, or wordier than 3 words, read as prose clauses. */
const MAX_TOKEN_LENGTH = 30;
const MAX_TOKEN_WORDS = 3;

/**
 * Conservative list detection: only a comma-separated run of short tokens
 * counts ("Docker, Kubernetes, Redis, PostgreSQL" — or the parser's
 * space-less "NodeJS,ExpressJS,Python"). A token ending in sentence
 * punctuation, or reading like a clause, disqualifies the whole snippet:
 * prose that merely contains commas must stay prose.
 */
function asTokenList(display: string): string[] | null {
  const tokens = display
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < MIN_LIST_TOKENS) return null;

  const listLike = tokens.every(
    (token) =>
      token.length <= MAX_TOKEN_LENGTH &&
      token.split(/\s+/).length <= MAX_TOKEN_WORDS &&
      !/[.!?;:]$/.test(token),
  );

  return listLike ? tokens : null;
}

/** Prose previews cut here, at a word boundary, with an ellipsis. */
export const EXCERPT_LIMIT = 180;

function excerptOf(display: string): { text: string; truncated: boolean } {
  if (display.length <= EXCERPT_LIMIT) return { text: display, truncated: false };

  const slice = display.slice(0, EXCERPT_LIMIT);
  const lastSpace = slice.lastIndexOf(" ");
  // A boundary too close to the start means one enormous unbroken token
  // (parser artifact) — cut mid-token rather than show almost nothing.
  const cut = lastSpace > 60 ? slice.slice(0, lastSpace) : slice;
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

export function evidencePreview(snippet: string): EvidencePreview {
  const display = displaySnippet(snippet);

  const tokens = asTokenList(display);
  if (tokens) return { kind: "list", tokens, showOriginal: true };

  const { text, truncated } = excerptOf(display);
  return { kind: "prose", text, showOriginal: truncated };
}

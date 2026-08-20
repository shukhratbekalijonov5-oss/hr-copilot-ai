import type { Citation } from "@/lib/types";

/**
 * Inline citation markers inside a generated answer.
 *
 * The AI service writes each supported claim with the chunk id it came from,
 * e.g. "…used PostgreSQL [a755cd78-43f3-5b3a-a9a1-…]". A 36-character
 * identifier mid-sentence is unreadable, so each marker becomes a short
 * numbered reference pointing at the same citation listed below the answer.
 *
 * Nothing about the claim changes: the number and the citation are the same
 * passage the backend validated, so the grounding a reader can check is intact.
 *
 * The model does not always emit one id per bracket. Observed shapes include
 * `[id]`, `[id][id]`, `[id, id]` and — occasionally — a bare id with no
 * brackets at all. All of them are handled, because a raw chunk id reaching the
 * screen is a defect in every one of those cases.
 */

const UUID_SOURCE =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * A bracketed run of one or more chunk ids, or a bare chunk id.
 *
 * Only ids and separators may appear inside the brackets, so ordinary prose
 * such as "[internal tooling]" is never touched.
 */
const MARKER = new RegExp(
  `\\[\\s*${UUID_SOURCE}(?:\\s*[,;]?\\s*${UUID_SOURCE})*\\s*\\]|${UUID_SOURCE}`,
  "g",
);

const UUID = new RegExp(UUID_SOURCE, "g");

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; index: number; citation: Citation };

/**
 * Splits an answer into text and citation references.
 *
 * An id that is not among the returned citations is dropped rather than
 * rendered as a dangling number — the backend already discarded citations it
 * could not verify, and pointing at one of those would invite a reader to check
 * a source that is not there.
 */
export function segmentAnswer(
  answer: string,
  citations: Citation[],
): AnswerSegment[] {
  const indexByChunkId = new Map<string, number>();
  citations.forEach((citation, index) => {
    if (citation.chunkId) indexByChunkId.set(citation.chunkId, index);
  });

  const segments: AnswerSegment[] = [];
  let cursor = 0;

  const pushText = (text: string) => {
    if (!text) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === "text") previous.text += text;
    else segments.push({ kind: "text", text });
  };

  for (const match of answer.matchAll(MARKER)) {
    const start = match.index ?? 0;
    pushText(answer.slice(cursor, start));
    cursor = start + match[0].length;

    for (const id of match[0].match(UUID) ?? []) {
      const position = indexByChunkId.get(id);
      if (position === undefined) continue;
      segments.push({
        kind: "citation",
        index: position + 1,
        citation: citations[position],
      });
    }
  }

  pushText(answer.slice(cursor));

  return segments;
}

/** True when the answer carries at least one resolvable marker. */
export function hasInlineCitations(
  answer: string,
  citations: Citation[],
): boolean {
  return segmentAnswer(answer, citations).some(
    (segment) => segment.kind === "citation",
  );
}

/**
 * A bracketed run of small numbers — "[1]", "[1, 3]" — the shape the model
 * falls back to when it numbers its own references instead of using chunk ids.
 *
 * One or two digits only: the citation limit is 20, and anything longer is
 * ordinary prose such as "[2021]".
 */
const NUMERIC_MARKER = /\[\s*\d{1,2}(?:\s*[,;]\s*\d{1,2})*\s*\]/;

/** Non-global copy — `.test` on a /g/ regex is stateful across calls. */
const ANY_ID_MARKER = new RegExp(MARKER.source);

/**
 * True when the answer refers to sources that were not returned with it.
 *
 * The live failure this guards: an answer written with reference markers —
 * numeric "[1] [3]" or chunk-id brackets — arriving with `citations: []`
 * because the backend validated every citation away. Rendering the usual
 * source UI would imply the numbers can be checked when nothing backs them,
 * so the caller shows a "sources unavailable" notice instead.
 *
 * Deliberately NOT triggered while any citation exists: an id marker that
 * fails to resolve against a non-empty list was rejected by the backend's
 * validator and is silently dropped by `segmentAnswer` — the remaining
 * sources are real and the source list stays the honest UI for them.
 */
export function hasOrphanedReferences(
  answer: string,
  citations: Citation[],
): boolean {
  if (citations.length > 0) return false;
  return ANY_ID_MARKER.test(answer) || NUMERIC_MARKER.test(answer);
}

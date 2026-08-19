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

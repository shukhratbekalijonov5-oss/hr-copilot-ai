import type { Citation } from "@/lib/types";

/**
 * Inline citation markers inside a generated answer.
 *
 * The AI service writes each supported claim with the chunk id it came from,
 * e.g. "…used PostgreSQL [a755cd78-43f3-5b3a-a9a1-…]". Rendering a 36-character
 * identifier mid-sentence is unreadable, so the marker is replaced with a short
 * numbered reference pointing at the same citation shown below the answer.
 *
 * Nothing about the claim is changed: the number and the citation are the same
 * passage the backend validated, so the grounding a reader can check is intact.
 */

/** Chunk ids are UUID-shaped; a narrow pattern avoids eating ordinary brackets. */
const MARKER =
  /\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/g;

export type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; index: number; citation: Citation };

/**
 * Splits an answer into text and citation references.
 *
 * A marker whose chunk id is not among the returned citations is dropped rather
 * than rendered as a dangling number — the backend already discarded citations
 * it could not verify, and pointing at one of those would invite a reader to
 * check a source that is not there.
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

  for (const match of answer.matchAll(MARKER)) {
    const start = match.index ?? 0;
    const position = indexByChunkId.get(match[1]);

    if (position === undefined) {
      // Unknown id: keep the surrounding prose, drop the marker itself.
      if (start > cursor) {
        segments.push({ kind: "text", text: answer.slice(cursor, start) });
      }
      cursor = start + match[0].length;
      continue;
    }

    if (start > cursor) {
      segments.push({ kind: "text", text: answer.slice(cursor, start) });
    }
    segments.push({
      kind: "citation",
      index: position + 1,
      citation: citations[position],
    });
    cursor = start + match[0].length;
  }

  if (cursor < answer.length) {
    segments.push({ kind: "text", text: answer.slice(cursor) });
  }

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

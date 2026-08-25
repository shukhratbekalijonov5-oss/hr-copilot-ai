import type { Citation, MatchEvidence } from "@/lib/types";

/**
 * One shape for the evidence drawer, whichever side opened it.
 *
 * ## Two contracts, one panel
 *
 * The recruiter's `Citation` and the candidate's `MatchEvidence` describe the
 * same thing — a passage from somebody's own document or link — but carry
 * different fields because they come from different endpoints. Normalising
 * here means the drawer has one implementation and neither side's shape
 * leaks into it.
 *
 * ## Nothing is invented on the way through
 *
 * Every field is copied or set to null. There is no derived page number, no
 * guessed section, no synthesised title: a drawer that filled in a plausible
 * page would send a reader to the wrong place while looking authoritative,
 * which is worse than saying nothing.
 *
 * ## Current evidence only
 *
 * Both inputs come from live reads of the candidate's CURRENT evidence. This
 * copies no text into storage and holds nothing across a request, so a
 * deleted file cannot reappear here — the drawer shows what the last response
 * said, and the next response says it is gone.
 */
export interface EvidenceView {
  /** 1-based marker matching the "[n]" in the prose that cited it. */
  index: number;
  /** Verbatim. Never translated, never re-wrapped, never summarised. */
  snippet: string;
  section: string | null;
  fileName: string | null;
  page: number | null;
  sourceType: "FILE" | "URL";
  sourceUrl: string | null;
}

export function fromCitation(citation: Citation, index: number): EvidenceView {
  return {
    index,
    snippet: citation.snippet,
    section: citation.section,
    fileName: citation.documentName,
    page: citation.page,
    sourceType: citation.sourceType === "URL" ? "URL" : "FILE",
    sourceUrl: citation.sourceUrl,
  };
}

export function fromMatchEvidence(
  evidence: MatchEvidence,
  index: number,
): EvidenceView {
  return {
    index,
    snippet: evidence.text,
    section: evidence.section,
    fileName: evidence.fileName,
    page: evidence.pageNumber,
    sourceType: evidence.sourceType === "URL" ? "URL" : "FILE",
    sourceUrl: evidence.sourceUrl,
  };
}

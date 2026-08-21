/**
 * The one vocabulary every layer uses to talk about candidate evidence.
 *
 * The product's central architectural claim is that the AI layer is
 * SOURCE-AGNOSTIC: a PDF and a portfolio page are ingested differently, but
 * once normalized they are both "a titled source made of sections of text",
 * and search, summary, evidence mapping, interview questions, Ask, Compare and
 * Job Match all consume that single shape. This file is that shape on the
 * TypeScript side; `app/models/schemas.py` mirrors it on the Python side.
 *
 * Note there is no database enum behind `EvidenceSourceType`. Nothing stores
 * it: it is derived from which table a row lives in, and a stored copy could
 * disagree with the row it describes.
 */

export const EVIDENCE_SOURCE_TYPES = ['FILE', 'URL'] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/**
 * One normalized section of evidence — the unit handed to the AI service for
 * chunking, whatever it was extracted from.
 *
 * `url` is set for URL sources (the exact page the text came from, which may
 * be a subpage of the submitted link) and null for files, where `pageNumber`
 * plays the same "where exactly" role.
 */
export interface EvidenceSectionInput {
  /** Canonical section name (summary/experience/projects/...), when known. */
  name: string | null;
  /** The heading as written in the source. */
  heading: string | null;
  text: string;
  url?: string | null;
}

/**
 * A source as recruiters and candidates see it, regardless of kind.
 *
 * Deliberately uniform: the UI renders one "Evidence Sources" list, and a
 * citation says "Portfolio Website · Projects" or "Resume.pdf · page 2"
 * without the caller branching on source kind to find a title.
 */
export interface EvidenceSourceSummary {
  id: string;
  sourceType: EvidenceSourceType;
  /** File name, or link title / hostname. Always human-readable. */
  title: string;
  /** Present only for URL sources. Already validated as public http(s). */
  url: string | null;
  /** Display-only classification for URL sources ("GITHUB", "WEBSITE", ...). */
  detectedType: string | null;
  /** Indexing lifecycle. Shared vocabulary with documents. */
  status: string;
  pageCount?: number | null;
  createdAt: Date;
}

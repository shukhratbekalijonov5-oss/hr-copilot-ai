import type { Prisma } from '../generated/prisma/client';
import type { AiEvidenceSection } from '../ai/ai-service.client';
import type { NormalizedSection } from './web-ingestion.service';

/**
 * Reading and writing normalized web sections as JSON columns.
 *
 * `CandidateLink.sections` and `ApplicationLinkSource.sections` both store the
 * same shape, and both are read back defensively: a JSON column makes no
 * promises about what is inside it, and this content came from the internet in
 * the first place. A malformed entry is dropped rather than propagated into
 * chunking, where it would become a citation pointing at nothing.
 */

export function toJsonSections(
  sections: NormalizedSection[],
): Prisma.InputJsonValue {
  return sections.map((section) => ({
    name: section.name,
    heading: section.heading,
    text: section.text,
    url: section.url,
  }));
}

export function fromJsonSections(value: unknown): NormalizedSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry as Record<string, unknown>;
    const text = typeof record?.text === 'string' ? record.text : '';
    if (!text.trim()) return [];
    return [
      {
        name: typeof record.name === 'string' ? record.name : null,
        heading: typeof record.heading === 'string' ? record.heading : null,
        text,
        url: typeof record.url === 'string' ? record.url : '',
      },
    ];
  });
}

/** Maps stored sections onto the AI service's ingestion contract. */
export function toAiSections(
  sections: NormalizedSection[],
): AiEvidenceSection[] {
  return sections.map((section) => ({
    name: section.name,
    heading: section.heading,
    text: section.text,
    url: section.url || null,
  }));
}

"use client";

import { CitationLink } from "@/components/evidence/CitationLink";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

interface CitationListProps {
  citations: Citation[];
  /** Moves the document viewer to the passage. Omit for read-only contexts. */
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
  /** Deep link used where there is no viewer on the page. */
  hrefFor?: (citation: Citation) => string;
  className?: string;
}

/**
 * The passages behind a generated claim.
 *
 * The snippet is rendered verbatim and is never translated: it is the
 * candidate's own words, and re-writing it would destroy the thing a citation
 * exists to provide. Only the chrome around it follows the reader's locale.
 */
export function CitationList({
  citations,
  onSelectCitation,
  activeCitationId,
  hrefFor,
  className,
}: CitationListProps) {
  const { d, p } = useI18n();

  if (citations.length === 0) {
    return (
      <p className={cn("text-[12.5px] text-ink-subtle", className)}>
        {d.ai.noCitations}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        {p(d.ai.citationsCount, citations.length)}
      </p>
      <ul className="flex flex-col gap-2.5">
        {citations.map((citation) => (
          <li key={citation.id} className="min-w-0">
            <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-muted">
              {citation.snippet}
            </blockquote>
            <div className="mt-1.5 pl-3">
              <CitationLink
                citation={citation}
                onSelect={onSelectCitation}
                href={hrefFor?.(citation)}
                active={activeCitationId === citation.id}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11.5px] leading-relaxed text-ink-subtle">
        {d.ai.citationSourceLanguageNote}
      </p>
    </div>
  );
}

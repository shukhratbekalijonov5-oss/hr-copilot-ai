"use client";

import { segmentAnswer } from "@/lib/ai/answer-citations";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

interface GroundedTextProps {
  text: string;
  citations: Citation[];
  /** Jumps the document viewer to the cited passage. */
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
  className?: string;
}

/**
 * Generated prose with its inline citations made clickable.
 *
 * The AI service marks each supported claim with the chunk id behind it. Those
 * ids are rendered as short numbered references that open the exact page the
 * claim came from — the same passage listed under the answer. The prose itself
 * is shown verbatim; only the markers are re-presented.
 */
export function GroundedText({
  text,
  citations,
  onSelectCitation,
  activeCitationId,
  className,
}: GroundedTextProps) {
  const { d, f } = useI18n();
  const segments = segmentAnswer(text, citations);

  return (
    <p
      className={cn(
        "whitespace-pre-line text-[13.5px] leading-relaxed text-ink",
        className,
      )}
    >
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={index}>{segment.text}</span>;
        }

        const { citation } = segment;
        const documentName = citation.documentName ?? d.search.sourceDocument;
        const title =
          citation.page !== null
            ? f(d.evidence.openAtPage, {
                name: documentName,
                page: citation.page,
              })
            : f(d.evidence.openDocument, { name: documentName });

        const label = `[${segment.index}]`;
        const active = activeCitationId === citation.id;

        if (!onSelectCitation) {
          return (
            <sup
              key={index}
              title={title}
              className="mx-0.5 text-[10.5px] font-semibold text-brand-ink"
            >
              {label}
            </sup>
          );
        }

        return (
          <button
            key={index}
            type="button"
            onClick={() => onSelectCitation(citation)}
            aria-pressed={active}
            title={title}
            className={cn(
              "mx-0.5 align-super rounded px-1 text-[10.5px] font-semibold transition-colors",
              active
                ? "bg-brand text-white"
                : "bg-brand-soft text-brand-ink hover:bg-brand hover:text-white",
            )}
          >
            {label}
          </button>
        );
      })}
    </p>
  );
}

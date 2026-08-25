"use client";

import { useId, useState } from "react";
import { EvidenceDrawer } from "@/components/workspace/EvidenceDrawer";
import { fromCitation } from "@/lib/workspace/evidence-view";
import { CitationLink } from "@/components/evidence/CitationLink";
import { Chip } from "@/components/ui/Badge";
import { AlertIcon, ChevronDownIcon } from "@/components/ui/icons";
import { hasOrphanedReferences } from "@/lib/ai/answer-citations";
import { evidencePreview, sectionKey } from "@/lib/ai/evidence-preview";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

interface CitationListProps {
  citations: Citation[];
  /**
   * The generated prose these citations belong to. When provided and the
   * citation list is empty, reference-shaped markers in the text ("[1]", a
   * bracketed chunk id) turn the empty state into an explicit "sources
   * unavailable" caution — an answer that points at sources nothing backs
   * must not look like one that simply has none.
   */
  answerText?: string;
  /** Moves the document viewer to the passage. Omit for read-only contexts. */
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
  /** Deep link used where there is no viewer on the page. */
  hrefFor?: (citation: Citation) => string;
  /** e.g. the vacancy this reading sits inside. Shown in the inspector. */
  contextLabel?: string;
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
  answerText,
  onSelectCitation,
  activeCitationId,
  hrefFor,
  contextLabel,
  className,
}: CitationListProps) {
  const { d, p } = useI18n();
  /*
   * The passage open in the inspector.
   *
   * Independent of `onSelectCitation`, which moves a document VIEWER to the
   * page. Both can be present: the viewer shows the file, the drawer shows
   * the exact quoted passage and its provenance next to the claim. Neither
   * replaces the other, so opening one must not disturb the other.
   */
  const [inspected, setInspected] = useState<number | null>(null);

  if (citations.length === 0) {
    // The dangerous empty state: the prose cites sources the backend did not
    // return. Never invent a mapping for the markers — say they cannot be
    // opened, and leave the claims to be checked against the documents.
    if (answerText && hasOrphanedReferences(answerText, citations)) {
      return (
        <p
          role="note"
          className={cn(
            "flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-muted",
            className,
          )}
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {d.ai.citationSourcesUnavailable}
        </p>
      );
    }

    return (
      <p className={cn("text-[12.5px] text-ink-subtle", className)}>
        {d.ai.noCitations}
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
        {p(d.ai.citationsCount, citations.length)}
      </p>
      <ul className="flex flex-col gap-2">
        {citations.map((citation, index) => (
          <SourceCard
            key={citation.id}
            index={index + 1}
            citation={citation}
            onSelect={onSelectCitation}
            onInspect={() => setInspected(index)}
            href={hrefFor?.(citation)}
            active={activeCitationId === citation.id}
          />
        ))}
      </ul>
      <p className="text-[11.5px] leading-relaxed text-ink-subtle">
        {d.ai.citationSourceLanguageNote}
      </p>

      <EvidenceDrawer
        evidence={
          inspected === null
            ? null
            : fromCitation(citations[inspected], inspected + 1)
        }
        contextLabel={contextLabel}
        onClose={() => setInspected(null)}
      />
    </div>
  );
}

/**
 * One source, as a structured evidence card.
 *
 * Top to bottom: the number matching the inline [n] reference beside a
 * section heading (a friendly localized label, never a raw internal value);
 * a readable preview — the source's own comma list as chips, or a short
 * prose excerpt; the provenance chip, always visible and still the click
 * target for the viewer jump; and the exact raw extraction behind "View
 * original evidence". The preview is derived deterministically from the
 * snippet and never adds a character the backend did not return — the raw
 * text stays one toggle away precisely so a reader can check that.
 */
function SourceCard({
  index,
  citation,
  onSelect,
  onInspect,
  href,
  active,
}: {
  index: number;
  citation: Citation;
  onSelect?: (citation: Citation) => void;
  /** Opens the inspector beside the claim, without leaving the answer. */
  onInspect: () => void;
  href?: string;
  active: boolean;
}) {
  const { d } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const originalId = useId();

  const preview = evidencePreview(citation.snippet);
  const section = sectionKey(citation.section);
  const heading = section
    ? d.ai.sectionLabels[section]
    : d.ai.supportingEvidence;

  return (
    <li
      className={cn(
        "min-w-0 rounded-lg border bg-surface-muted/40 p-3 transition-colors",
        active ? "border-brand" : "border-line",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-[11px] font-semibold tabular-nums text-brand-ink"
        >
          {index}
        </span>
        <span className="sr-only">{`[${index}]`}</span>
        <h4 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-ink">
          {heading}
        </h4>
        <button
          type="button"
          onClick={onInspect}
          aria-haspopup="dialog"
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-brand transition-colors duration-[var(--motion-fast)] hover:bg-brand-soft hover:text-brand-ink"
        >
          {d.ai.viewEvidenceAction}
        </button>
      </div>

      {preview.kind === "list" ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {preview.tokens.map((token, position) => (
            <Chip key={`${token}-${position}`}>{token}</Chip>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {preview.text}
        </p>
      )}

      <div className="mt-2.5">
        <CitationLink
          citation={citation}
          onSelect={onSelect}
          href={href}
          active={active}
          className="min-w-0"
        />
      </div>

      {preview.showOriginal ? (
        <>
          <button
            type="button"
            aria-expanded={showOriginal}
            aria-controls={originalId}
            onClick={() => setShowOriginal((value) => !value)}
            className="mt-2 inline-flex items-center gap-1 rounded text-[12px] font-medium text-brand-ink transition-colors hover:text-brand"
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                showOriginal && "rotate-180",
              )}
            />
            {showOriginal
              ? d.ai.hideOriginalEvidence
              : d.ai.viewOriginalEvidence}
          </button>
          {/* The backend's text, exactly as returned — spacing included. */}
          <blockquote
            id={originalId}
            hidden={!showOriginal}
            className="mt-1.5 whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink-subtle"
          >
            {citation.snippet}
          </blockquote>
        </>
      ) : null}
    </li>
  );
}

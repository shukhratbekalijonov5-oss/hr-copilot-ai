"use client";

import { useId, useState } from "react";
import { Chip } from "@/components/ui/Badge";
import { ChevronDownIcon, FileIcon } from "@/components/ui/icons";
import { evidencePreview, sectionKey } from "@/lib/ai/evidence-preview";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { MatchEvidence } from "@/lib/types";

/**
 * The candidate's own resume/profile passages behind a job match, in the same
 * structured evidence-card design as the recruiter-side citations: section
 * heading, deterministic readable preview, provenance, exact raw text behind
 * "View original evidence". The data shape differs (match evidence carries no
 * chunk ids to click through), so this is a sibling of CitationList's card
 * built on the same preview helpers — never a second design language.
 */
export function MatchEvidenceList({ evidence }: { evidence: MatchEvidence[] }) {
  const { d } = useI18n();

  if (evidence.length === 0) {
    return (
      <p className="text-[12.5px] text-ink-subtle">{d.ai.noCitations}</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {evidence.map((item, index) => (
        <EvidenceCard key={index} index={index + 1} evidence={item} />
      ))}
    </ul>
  );
}

function EvidenceCard({
  index,
  evidence,
}: {
  index: number;
  evidence: MatchEvidence;
}) {
  const { d } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const originalId = useId();

  const preview = evidencePreview(evidence.text);
  const section = sectionKey(evidence.section);
  const heading = section
    ? d.ai.sectionLabels[section]
    : d.ai.supportingEvidence;

  return (
    <li className="min-w-0 rounded-lg border border-line bg-surface-muted/40 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-[11px] font-semibold tabular-nums text-brand-ink"
        >
          {index}
        </span>
        <span className="sr-only">{`[${index}]`}</span>
        <h5 className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-ink">
          {heading}
        </h5>
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

      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-subtle">
        <FileIcon className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-ink-muted">
          {evidence.fileName ?? d.search.sourceDocument}
        </span>
        {evidence.pageNumber !== null ? (
          <span>
            · {d.common.page} {evidence.pageNumber}
          </span>
        ) : null}
      </p>

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
          <blockquote
            id={originalId}
            hidden={!showOriginal}
            className="mt-1.5 whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink-subtle"
          >
            {evidence.text}
          </blockquote>
        </>
      ) : null}
    </li>
  );
}

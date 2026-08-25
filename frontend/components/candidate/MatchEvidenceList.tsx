"use client";

import { useId, useState } from "react";
import { EvidenceDrawer } from "@/components/workspace/EvidenceDrawer";
import { fromMatchEvidence } from "@/lib/workspace/evidence-view";
import { Chip } from "@/components/ui/Badge";
import { ChevronDownIcon, FileIcon, GlobeIcon } from "@/components/ui/icons";
import { evidencePreview, sectionKey } from "@/lib/ai/evidence-preview";
import { useI18n } from "@/lib/i18n/context";
import { cn, displayUrl } from "@/lib/utils";
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
  /*
   * Which passage is open in the inspector.
   *
   * The card keeps its inline preview — the drawer is for reading the full
   * passage and its provenance beside the claim, not a replacement for
   * seeing at a glance what backed it.
   */
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (evidence.length === 0) {
    return (
      <p className="text-[12.5px] text-ink-subtle">{d.ai.noCitations}</p>
    );
  }

  const open = openIndex === null ? null : evidence[openIndex];

  return (
    <>
      <ul className="flex flex-col gap-2">
        {evidence.map((item, index) => (
          <EvidenceCard
            key={index}
            index={index + 1}
            evidence={item}
            onInspect={() => setOpenIndex(index)}
          />
        ))}
      </ul>

      <EvidenceDrawer
        evidence={
          open ? fromMatchEvidence(open, (openIndex ?? 0) + 1) : null
        }
        onClose={() => setOpenIndex(null)}
      />
    </>
  );
}

function EvidenceCard({
  index,
  evidence,
  onInspect,
}: {
  index: number;
  evidence: MatchEvidence;
  onInspect: () => void;
}) {
  const { d } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const originalId = useId();

  const isUrl = evidence.sourceType === "URL";
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
        <h5 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-ink">
          {heading}
        </h5>
        {/* Opens the inspector beside the claim rather than navigating away. */}
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

      {/*
        Provenance says WHICH of the candidate's own sources this came from.
        A skill shown only on a portfolio counts exactly as much as one on a
        CV — but the job seeker should know which of their sources is doing the
        work, so a link is labelled as a link and points at the page.
      */}
      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-subtle">
        {isUrl ? (
          <GlobeIcon className="size-3.5 shrink-0" />
        ) : (
          <FileIcon className="size-3.5 shrink-0" />
        )}
        <span className="truncate font-medium text-ink-muted">
          {evidence.fileName ??
            (isUrl ? d.search.sourceLink : d.search.sourceDocument)}
        </span>
        {isUrl && evidence.sourceUrl ? (
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noreferrer noopener nofollow"
            title={evidence.sourceUrl}
            className="truncate hover:text-brand hover:underline"
          >
            · {displayUrl(evidence.sourceUrl, 32)}
          </a>
        ) : null}
        {!isUrl && evidence.pageNumber !== null ? (
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

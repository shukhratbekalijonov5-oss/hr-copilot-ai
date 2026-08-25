"use client";

import { SideDrawer } from "@/components/workspace/SideDrawer";
import { Chip } from "@/components/ui/Badge";
import { FileIcon, GlobeIcon } from "@/components/ui/icons";
import { sectionKey } from "@/lib/ai/evidence-preview";
import { useI18n } from "@/lib/i18n/context";
import { displayUrl } from "@/lib/utils";
import type { EvidenceView } from "@/lib/workspace/evidence-view";

/**
 * The passage behind one generated claim.
 *
 * ## The snippet is verbatim, and visibly so
 *
 * It renders in the candidate's own words inside a quoted block, never
 * translated and never summarised — rewriting it would destroy the only
 * thing a citation exists to provide. Only the chrome around it follows the
 * reader's locale.
 *
 * ## Provenance is stated, and absence is stated too
 *
 * Section, file and page each appear only when the backend supplied them. A
 * missing page renders as nothing rather than as "page 1", because a reader
 * checking a source needs to know when we do not know.
 */
export function EvidenceDrawer({
  evidence,
  contextLabel,
  onClose,
}: {
  evidence: EvidenceView | null;
  /** e.g. the vacancy this reading sits inside. Optional. */
  contextLabel?: string;
  onClose: () => void;
}) {
  const { d, f } = useI18n();
  if (!evidence) return null;

  const section = sectionKey(evidence.section);
  const heading = section ? d.ai.sectionLabels[section] : d.ai.supportingEvidence;
  const isUrl = evidence.sourceType === "URL";

  return (
    <SideDrawer
      open
      title={d.ai.evidenceDrawerTitle}
      description={`[${evidence.index}] · ${heading}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>
            <span className="inline-flex items-center gap-1">
              {isUrl ? (
                <GlobeIcon className="size-3" />
              ) : (
                <FileIcon className="size-3" />
              )}
              {isUrl ? d.ai.sourceLink : d.ai.sourceFile}
            </span>
          </Chip>
          {contextLabel ? <Chip>{contextLabel}</Chip> : null}
        </div>

        <section className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">
            {d.ai.evidenceSnippet}
          </h3>
          {/*
            `whitespace-pre-wrap` keeps the document's own line breaks: a
            bulleted experience section collapses into unreadable prose
            without it.
          */}
          <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-[12px] border border-line bg-surface-muted/50 px-3.5 py-3 text-[13.5px] leading-relaxed text-ink">
            {evidence.snippet}
          </blockquote>
        </section>

        <section className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">
            {d.ai.evidenceSource}
          </h3>
          <dl className="mt-2 flex flex-col gap-1.5 text-[13px]">
            {evidence.fileName ? (
              <Row label={d.ai.evidenceFile} value={evidence.fileName} />
            ) : null}
            {/* Only when the backend reported one. Never computed here. */}
            {evidence.page !== null ? (
              <Row
                label={d.ai.evidencePage}
                value={f(d.common.pageNumber, { page: String(evidence.page) })}
              />
            ) : null}
            {evidence.sourceUrl ? (
              <Row
                label={d.ai.evidenceLink}
                value={displayUrl(evidence.sourceUrl)}
              />
            ) : null}
            {!evidence.fileName && !evidence.sourceUrl ? (
              <p className="text-[12.5px] text-ink-subtle">
                {d.ai.evidenceSourceUnknown}
              </p>
            ) : null}
          </dl>
        </section>
      </div>
    </SideDrawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ChevronDownIcon } from "@/components/ui/icons";
import { MatchEvidenceRefs } from "@/components/match/MatchEvidenceRefs";
import { useI18n } from "@/lib/i18n/context";
import {
  priorityPresentation,
  requirementStatusPresentation,
} from "@/lib/match/presentation";
import { cn } from "@/lib/utils";
import type { RequirementMatrixRow } from "@/lib/match/insight";

/**
 * Requirement · Priority · Status · Evidence.
 *
 * ## A grid, not a table element
 *
 * The four columns are a reading order, not tabular data a reader will sort
 * or scan numerically, and a real `<table>` at 390px either scrolls sideways
 * or squeezes the requirement text to two words per line. So each row is its
 * own card: stacked and labelled on a phone, aligned into columns from `sm`
 * up. Nothing is ever hidden at a smaller width, and the page never scrolls
 * horizontally — §17 mobile.
 *
 * ## Status never rides on colour
 *
 * Every status renders as glyph + word + tinted badge. Remove the colour and
 * the row still says "Missing"; remove the glyph and it still says it too.
 *
 * ## MISSING is about the documents
 *
 * The label is "Missing" and the sentence under it is the backend's own "no
 * current evidence found" phrasing. Neither this component nor the dictionary
 * may ever render it as a claim that the candidate lacks the skill.
 */
export function RequirementMatrix({ rows }: { rows: RequirementMatrixRow[] }) {
  const { d } = useI18n();
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="requirement-matrix-title" className="mt-4">
      <h4
        id="requirement-matrix-title"
        className="text-[13px] font-semibold tracking-tight text-ink"
      >
        {d.matchInsight.requirementMatrix}
      </h4>

      {/* Column headings exist only where there are columns. */}
      <div className="mt-2 hidden grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-line pb-1.5 sm:grid">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.matchInsight.requirement}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.matchInsight.priority}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.matchInsight.status}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.matchInsight.evidence}
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row, index) => (
          <MatrixRow key={row.requirementId ?? `${row.text}-${index}`} row={row} />
        ))}
      </ul>
    </section>
  );
}

function MatrixRow({ row }: { row: RequirementMatrixRow }) {
  const { d, f } = useI18n();
  const [open, setOpen] = useState(false);

  const status = requirementStatusPresentation(row.status);
  const priority = priorityPresentation(row.priority);
  const labels = d.matchInsight as unknown as Record<string, string>;
  // `blocked` collides between eligibility and status, so the status variant
  // is stored under its own key rather than reused.
  const statusLabel =
    row.status === "BLOCKED"
      ? d.matchInsight.statusBlocked
      : labels[status.labelKey];
  const priorityLabel = labels[priority.labelKey];

  const evidenceLabel =
    row.evidenceCount === 0
      ? d.matchInsight.noCurrentEvidence
      : row.evidenceCount === 1
        ? d.matchInsight.evidenceItem
        : f(d.matchInsight.evidenceItems, { count: row.evidenceCount });

  const expandable = row.evidenceRefs.length > 0 || row.reason.length > 0;

  return (
    <li className="py-2.5">
      <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-start sm:gap-3">
        <p className="text-[13px] leading-relaxed text-ink">{row.text}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={priority.tone}>
            <span aria-hidden>{priority.glyph}</span>
            {priorityLabel}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={status.tone}>
            <span aria-hidden>{status.glyph}</span>
            {statusLabel}
          </Badge>
          {/*
           * A transferable row is marked as such right beside its status, so
           * "Partial" is never mistaken for a direct match earned outright.
           */}
          {row.transferable ? (
            <Badge tone="info">{d.matchInsight.transferableTitle}</Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[12px]",
              row.evidenceCount === 0 ? "text-ink-subtle" : "text-ink-muted",
            )}
          >
            {evidenceLabel}
          </span>
          {expandable ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="rounded-md p-0.5 text-ink-subtle transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <span className="sr-only">{row.text}</span>
              <ChevronDownIcon
                className={cn("size-4 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-1.5">
          {row.reason ? (
            <p className="text-[12px] leading-relaxed text-ink-muted">{row.reason}</p>
          ) : null}
          {row.transferable ? (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-subtle">
              {row.transferable.sourceSkill} ·{" "}
              {f(d.matchInsight.transferableRelation, { target: row.text })}
            </p>
          ) : null}
          <MatchEvidenceRefs refs={row.evidenceRefs} />
        </div>
      ) : null}
    </li>
  );
}

"use client";

import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import {
  breakdownDimensionLabel,
  breakdownStatusTone,
} from "@/lib/ai/match-breakdown";
import type { MatchBreakdownDimension } from "@/lib/types";

/**
 * The breakdown, one dimension per row.
 *
 * ## Status is a WORD, and the colour is decoration on top of it
 *
 * Every row shows its status as text in a badge — "Strong", "Partial match",
 * "Gap", "Not enough information". The tint is redundant by design: a reader
 * who cannot distinguish the tints, or who is hearing this page, gets the
 * whole meaning from the label. That is also why there is no status icon
 * standing in for the word.
 *
 * ## No score, anywhere
 *
 * No ring, no bar, no percentage, no per-dimension rating, and no count of
 * strong-versus-gap presented as a tally. The card's number comes from the
 * deterministic ranker; a second figure assembled here from four statuses
 * would be a frontend-invented score sitting next to the real one, and a
 * reader would have no way to know which was which. Even a progress bar is a
 * number — it is a percentage drawn instead of written.
 *
 * ## Matched and missing render only when they exist
 *
 * Both lists are legitimately empty — an UNKNOWN dimension has neither, and a
 * STRONG one often has nothing missing. An empty "Missing" heading reads as a
 * section that failed to load rather than as good news, so the heading goes
 * with the list.
 */
export function AiDimensionList({
  dimensions,
  headingLevel = 4,
}: {
  dimensions: MatchBreakdownDimension[];
  headingLevel?: 3 | 4 | 5;
}) {
  const { d } = useI18n();
  if (dimensions.length === 0) return null;

  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5";

  return (
    <ul className="flex flex-col gap-2.5">
      {dimensions.map((dimension) => (
        <li
          key={dimension.key}
          className="rounded-lg border border-line bg-surface px-3 py-2.5"
        >
          {/*
            `flex-wrap` and `min-w-0`: a long Russian or Korean dimension label
            wraps to its own line rather than squeezing the badge into an
            unreadable sliver or pushing the card past the drawer's width.
          */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {/*
              Translated for the seven dimensions the backend actually emits,
              and the backend's own label for anything else. Without this a
              Korean reader got Korean prose under English row headings — the
              backend hardcodes these labels and has no translation layer for
              user-facing strings.
            */}
            <Heading className="min-w-0 break-words text-[13px] font-semibold text-ink">
              {breakdownDimensionLabel(dimension.key, dimension.label, d)}
            </Heading>
            <Badge tone={breakdownStatusTone(dimension.status)}>
              {d.matchBreakdown.status[dimension.status]}
            </Badge>
          </div>

          {dimension.matched.length > 0 ? (
            <DimensionItems
              label={d.matchBreakdown.matched}
              items={dimension.matched}
              tone="matched"
            />
          ) : null}

          {dimension.missing.length > 0 ? (
            <DimensionItems
              label={d.matchBreakdown.missing}
              items={dimension.missing}
              tone="missing"
            />
          ) : null}

          {dimension.explanation ? (
            <p className="mt-2 break-words text-[12.5px] leading-relaxed text-ink-muted">
              {dimension.explanation}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * One labelled list of evidence inside a dimension.
 *
 * A real `<ul>` under its own label, so a screen reader announces how many
 * items there are and can step through them — and so "Missing: Kubernetes"
 * cannot be heard as one run-on sentence with the explanation that follows.
 */
function DimensionItems({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "matched" | "missing";
}) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <li
            // Model output can repeat; the index keeps two identical strings
            // two entries.
            key={`${item}-${index}`}
            className={
              tone === "matched"
                ? "rounded-md bg-positive-soft px-1.5 py-0.5 text-[12px] text-positive"
                : "rounded-md bg-surface-muted px-1.5 py-0.5 text-[12px] text-ink-muted"
            }
          >
            {/* `break-words` so a long skill name wraps inside its chip. */}
            <span className="break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

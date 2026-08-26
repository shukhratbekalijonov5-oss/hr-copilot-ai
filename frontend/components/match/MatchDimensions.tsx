"use client";

import { useI18n } from "@/lib/i18n/context";
import { dimensionBarWidth } from "@/lib/match/presentation";
import type { MatchDimension } from "@/lib/match/insight";

/**
 * The score breakdown: one row per dimension the backend returned.
 *
 * ## The denominators are the backend's
 *
 * Each row prints `score / max` exactly as supplied. The frontend never
 * computes a max, never rescales a score to 100, and never sums the rows into
 * a total — the headline score is its own authoritative number and re-deriving
 * it here would eventually disagree with the backend.
 *
 * The bar is drawing, not scoring: it is `score/max` as a width, and the
 * numbers beside it remain the source of truth for anyone who cannot see it.
 *
 * ## Absent dimensions are absent
 *
 * Only what came back is drawn. A vacancy with no language requirement has no
 * language row, rather than a `0/5` that reads as a failure the candidate
 * caused — §"do not render an empty fake row".
 */
export function MatchDimensions({ dimensions }: { dimensions: MatchDimension[] }) {
  const { d } = useI18n();
  if (dimensions.length === 0) return null;

  return (
    <section aria-labelledby="match-dimensions-title" className="mt-4">
      <h4
        id="match-dimensions-title"
        className="text-[13px] font-semibold tracking-tight text-ink"
      >
        {d.matchInsight.scoreBreakdown}
      </h4>
      <ul className="mt-2 flex flex-col gap-2">
        {dimensions.map((dimension) => (
          <li key={dimension.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] text-ink-muted">
                {dimensionLabel(dimension, d)}
              </span>
              <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-ink">
                {dimension.score} / {dimension.max}
              </span>
            </div>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted"
              role="img"
              aria-label={`${dimensionLabel(dimension, d)}: ${dimension.score} / ${dimension.max}`}
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: dimensionBarWidth(dimension.score, dimension.max) }}
              />
            </div>
            {dimension.reason ? (
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
                {dimension.reason}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Resolves `match.dimension.<key>` against the dictionary.
 *
 * An unrecognised key falls back to the backend's own key text rather than
 * rendering blank: a new dimension shipped server-side should appear, plainly
 * labelled, instead of silently vanishing from the breakdown.
 */
function dimensionLabel(
  dimension: MatchDimension,
  d: ReturnType<typeof useI18n>["d"],
): string {
  const key = dimension.key.charAt(0).toUpperCase() + dimension.key.slice(1);
  const labels = d.matchInsight as unknown as Record<string, string>;
  return labels[`dimension${key}`] ?? dimension.key;
}

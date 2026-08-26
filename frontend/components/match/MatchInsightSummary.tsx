"use client";

import { Badge } from "@/components/ui/Badge";
import { HelpIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { eligibilityPresentation } from "@/lib/match/presentation";
import type { MatchInsight } from "@/lib/match/insight";

/**
 * The three headline facts: overall match, eligibility, evidence confidence.
 *
 * ## Why confidence sits beside the score rather than inside it
 *
 * They answer different questions and must not be averaged into one number.
 * "Match 82 / Confidence 43" is the useful reading — looks strong, on thin
 * evidence — and it only survives if both are shown at full size. The help
 * text says what confidence is NOT, because the obvious misreading of any
 * percentage next to a score is "chance of getting the job".
 *
 * ## Eligibility is stated, and its reasons are listed
 *
 * PARTIAL and BLOCKED are useless without the why, so the backend's neutral
 * reason sentences are rendered verbatim underneath. ELIGIBLE with no reasons
 * prints nothing extra — there is nothing to explain about a clean pass.
 */
export function MatchInsightSummary({
  score,
  band,
  insight,
}: {
  score: number;
  band: string;
  insight: MatchInsight;
}) {
  const { d } = useI18n();
  const eligibility = eligibilityPresentation(insight.eligibility);
  const eligibilityLabel =
    insight.eligibility === "ELIGIBLE"
      ? d.matchInsight.eligible
      : insight.eligibility === "PARTIAL"
        ? d.matchInsight.eligibilityPartial
        : d.matchInsight.blocked;

  return (
    <section
      aria-label={d.matchInsight.overallMatch}
      className="rounded-xl border border-line bg-surface-muted/35 p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label={d.matchInsight.overallMatch}>
          <span className="text-[22px] font-semibold tracking-tight text-ink">
            {score}
          </span>
          <span className="text-[13px] font-medium text-ink-muted">— {band}</span>
        </Figure>

        <Figure label={d.matchInsight.eligibility}>
          <Badge tone={eligibility.tone}>
            <span aria-hidden>{eligibility.glyph}</span>
            {eligibilityLabel}
          </Badge>
        </Figure>

        <Figure label={d.matchInsight.evidenceConfidence} help={d.matchInsight.confidenceHelp}>
          <span className="text-[22px] font-semibold tracking-tight text-ink">
            {insight.evidenceConfidence}%
          </span>
        </Figure>
      </div>

      {insight.eligibilityReasons.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 border-t border-line pt-2.5">
          {insight.eligibilityReasons.map((reason) => (
            <li
              key={reason.code}
              className="text-[12.5px] leading-relaxed text-ink-muted"
            >
              {reason.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {label}
        {help ? (
          /*
           * `title` plus an accessible label, rather than a custom popover:
           * the sentence is short, it must survive keyboard focus, and a
           * bespoke tooltip here would be a third overlay pattern in a drawer
           * that already has two.
           */
          <span tabIndex={0} title={help} aria-label={help} className="text-ink-subtle">
            <HelpIcon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">{children}</p>
    </div>
  );
}

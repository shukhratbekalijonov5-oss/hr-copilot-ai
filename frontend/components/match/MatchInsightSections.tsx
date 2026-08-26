"use client";

import { Badge } from "@/components/ui/Badge";
import { AlertIcon, ArrowRightIcon, SparkIcon } from "@/components/ui/icons";
import { MatchEvidenceRefs } from "@/components/match/MatchEvidenceRefs";
import { useI18n } from "@/lib/i18n/context";
import { deltaTone, formatDelta, trajectoryTone } from "@/lib/match/presentation";
import type {
  CareerTrajectory,
  ImprovementSuggestion,
  MatchContradiction,
  MatchScoreChange,
  TransferableSkillMatch,
} from "@/lib/match/insight";

/**
 * The smaller advanced sections. Each renders only when it has data.
 *
 * They share a file because they share one rule: an empty list draws nothing.
 * A drawer of headings above "None" teaches a reader to scroll past the whole
 * panel, so absence is expressed by absence — §"avoid empty decorative cards".
 */

/**
 * Transferable evidence.
 *
 * Deliberately NOT styled like a direct match: an `info` badge and a neutral
 * card, never the positive green the matrix uses for STRONG/MATCH. The arrow
 * line states the relationship in words ("Express → partial relevance to
 * NestJS") so the partial nature survives without the styling.
 */
export function TransferableSkills({
  skills,
}: {
  skills: TransferableSkillMatch[];
}) {
  const { d, f } = useI18n();
  if (skills.length === 0) return null;

  return (
    <section aria-labelledby="transferable-title" className="mt-4">
      <h4
        id="transferable-title"
        className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
      >
        {d.matchInsight.transferableTitle}
        <Badge tone="info">{d.matchInsight.partial}</Badge>
      </h4>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
        {d.matchInsight.transferableHint}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {skills.map((skill, index) => (
          <li
            key={`${skill.sourceSkill}-${index}`}
            className="rounded-lg border border-info/20 bg-info-soft/40 px-3 py-2"
          >
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink">
              <span className="font-medium">{skill.sourceSkill}</span>
              <ArrowRightIcon className="size-3.5 text-ink-subtle" aria-hidden />
              <span className="text-ink-muted">
                {f(d.matchInsight.transferableRelation, {
                  target: skill.targetSkill ?? skill.targetRequirement,
                })}
              </span>
            </p>
            {skill.reason ? (
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {skill.reason}
              </p>
            ) : null}
            <MatchEvidenceRefs refs={skill.evidenceRefs} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Conflicting evidence.
 *
 * `warning`, never `critical`, and the heading says "Conflicting evidence"
 * rather than anything about the person. Two sources disagreeing is most
 * often an outdated CV, so the copy — the backend's own neutral summary plus
 * both sources side by side — lets a reader judge instead of being told.
 */
export function MatchContradictions({
  contradictions,
}: {
  contradictions: MatchContradiction[];
}) {
  const { d } = useI18n();
  if (contradictions.length === 0) return null;

  return (
    <section aria-labelledby="contradictions-title" className="mt-4">
      <h4
        id="contradictions-title"
        className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
      >
        <AlertIcon className="size-4 text-warning" aria-hidden />
        {d.matchInsight.contradictionsTitle}
      </h4>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
        {d.matchInsight.contradictionsHint}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {contradictions.map((item, index) => (
          <li
            key={`${item.kind}-${index}`}
            className="rounded-lg border border-warning/20 bg-warning-soft/40 px-3 py-2"
          >
            <p className="text-[13px] leading-relaxed text-ink">{item.summary}</p>
            <dl className="mt-1.5 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">
                  {d.matchInsight.sourceA}
                </dt>
                <dd className="text-[12px] text-ink-muted">{item.sourceA}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-subtle">
                  {d.matchInsight.sourceB}
                </dt>
                <dd className="text-[12px] text-ink-muted">{item.sourceB}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Career trajectory. Hidden entirely when the backend could not read one. */
export function MatchTrajectory({
  trajectory,
}: {
  trajectory: CareerTrajectory;
}) {
  const { d } = useI18n();
  if (trajectory.status === "UNKNOWN") return null;

  const labels = d.matchInsight as unknown as Record<string, string>;

  return (
    <section aria-labelledby="trajectory-title" className="mt-4">
      <h4
        id="trajectory-title"
        className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
      >
        {d.matchInsight.trajectoryTitle}
        <Badge tone={trajectoryTone(trajectory.status)}>
          {labels[`trajectory${trajectory.status}`] ?? trajectory.status}
        </Badge>
      </h4>
      {trajectory.reasons.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {trajectory.reasons.map((reason, index) => (
            <li key={index} className="text-[12px] leading-relaxed text-ink-muted">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Score change against the previous ranking.
 *
 * Rendered only when the backend supplies one. A pair with no earlier run has
 * no history, and drawing "0 → 73 (+73)" would report a rise that never
 * happened — §"do not fabricate prior score".
 */
export function MatchScoreChangeSection({
  scoreChange,
}: {
  scoreChange: MatchScoreChange | null;
}) {
  const { d, f } = useI18n();
  if (!scoreChange) return null;

  return (
    <section aria-labelledby="score-change-title" className="mt-4">
      <h4
        id="score-change-title"
        className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
      >
        {d.matchInsight.scoreChangeTitle}
        <span className="font-normal tabular-nums text-ink-muted">
          {f(d.matchInsight.scoreChangeFrom, {
            previous: scoreChange.previous,
            current: scoreChange.current,
          })}
        </span>
        <Badge tone={deltaTone(scoreChange.delta)}>
          {formatDelta(scoreChange.delta)}
        </Badge>
      </h4>
      {scoreChange.reasons.length > 0 ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {scoreChange.reasons.map((reason, index) => (
            <li key={index} className="text-[12px] leading-relaxed text-ink-muted">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * "What would improve this match?" — candidate-facing only.
 *
 * Ordered by the backend's `impactRank`, and the hint says plainly that
 * acting on them does not guarantee a higher score. Anything stronger would
 * be a promise about a future ranking this page cannot make.
 */
export function ImprovementSuggestions({
  suggestions,
}: {
  suggestions: ImprovementSuggestion[];
}) {
  const { d } = useI18n();
  if (suggestions.length === 0) return null;

  return (
    <section aria-labelledby="improve-title" className="mt-4">
      <h4
        id="improve-title"
        className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink"
      >
        <SparkIcon className="size-4 text-brand" aria-hidden />
        {d.matchInsight.improveTitle}
      </h4>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-subtle">
        {d.matchInsight.improveHint}
      </p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {suggestions.map((suggestion, index) => (
          <li
            key={`${suggestion.type}-${index}`}
            className="flex gap-2 text-[12.5px] leading-relaxed text-ink-muted"
          >
            <span className="text-ink-subtle tabular-nums" aria-hidden>
              {index + 1}.
            </span>
            {suggestion.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

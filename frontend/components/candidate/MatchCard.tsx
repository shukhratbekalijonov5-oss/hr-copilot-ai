"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { MatchEvidenceList } from "@/components/candidate/MatchEvidenceList";
import { MatchInsightPanel } from "@/components/match/MatchInsightPanel";
import { hasAdvancedDetail } from "@/lib/match/insight";
import { SaveJobButton } from "@/components/jobs/SaveJobButton";
import { Badge, Chip, type BadgeTone } from "@/components/ui/Badge";
import { AiInsightPanel, CandidateCard } from "@/components/candidate/ui";
import {
  MatchBandChip,
  MatchScoreRing,
} from "@/components/candidate/ui/MatchScore";
import { bandFor } from "@/lib/candidate/dashboard";
import { ApplicationStatusBadge } from "@/components/ui/StatusBadge";
import {
  BriefcaseIcon,
  ChevronDownIcon,
  MapPinIcon,
  SparkIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { useSpotlight } from "@/lib/ui/use-spotlight";
import {
  formatMoneyRange,
  matchExplanation,
  topReasons,
  type ExplanationFact,
} from "@/lib/candidate/match-explanation";
import type {
  JobMatch,
  JobMatchStrength,
  MatchBand,
  MatchRequirement,
} from "@/lib/types";

/**
 * One matched vacancy.
 *
 * The STRONG/PARTIAL/WEAK badge is the backend's deterministic evidence-
 * coverage label, rendered as words — never converted into a percentage, a
 * star rating or a "you should apply". The explanation is shown verbatim (or
 * an honest note when generation was unavailable), the requirement breakdown
 * uses the backend's own three-way classification, and the actions reuse the
 * existing job flows: view/apply on the public job page, save through the
 * shared SaveJobButton. Vacancies are addressed only by public slug.
 */
export function MatchCard({
  match,
  pending,
}: {
  match: JobMatch;
  /** Prose for this page is still being written; not the same as failed. */
  pending: boolean;
}) {
  const { d } = useI18n();
  const onPointerMove = useSpotlight();
  const { vacancy } = match;
  // Deterministic, computed from facts the backend already sent. No model is
  // involved and nothing here recalculates a score or converts money.
  const explanation = matchExplanation(match, d);

  const open = vacancy.status === "OPEN";
  const employmentTypeLabel = vacancy.employmentType
    ? (d.employmentType[
        vacancy.employmentType as keyof typeof d.employmentType
      ] ?? vacancy.employmentType)
    : null;

  return (
    <CandidateCard
      interactive
      onPointerMove={onPointerMove}
      className={cn(
        "spotlight flex flex-col gap-4 p-4 sm:p-5",
        // Only STRONG is marked. If every band tinted its border the border
        // would stop being a signal and become decoration. The halo is what
        // carries this in dark mode, where an inset rail alone disappears.
        match.band === "STRONG" && "ai-halo border-brand/30",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <MatchBandBadge band={match.band} />
            {!open ? (
              <Badge tone="neutral">{d.savedJobs.closed}</Badge>
            ) : null}
          </div>
          <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-tight text-ink">
            <Link
              href={`/jobs/${vacancy.slug}`}
              className="break-words hover:text-brand"
            >
              {vacancy.title}
            </Link>
          </h3>
          <p className="mt-1 break-words text-[13.5px] text-ink-muted">
            {vacancy.organizationName}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
            {vacancy.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPinIcon className="size-3.5 shrink-0" />
                <span className="break-words">{vacancy.location}</span>
              </span>
            ) : null}
            {employmentTypeLabel ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <BriefcaseIcon className="size-3.5 shrink-0" />
                <span className="break-words">{employmentTypeLabel}</span>
              </span>
            ) : null}
          </p>
          <MatchSalary match={match} />
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <MatchScore match={match} />
        </div>
        <SaveJobButton
          slug={vacancy.slug}
          saved={match.saved}
          className="w-full justify-center sm:w-auto"
        />
      </div>

      {match.explanation ? (
        <AiInsightPanel title={d.jobMatch.whyMatches}>
          {match.explanation}
        </AiInsightPanel>
      ) : (
        <p className="flex items-start gap-2 rounded-lg border border-ai-line bg-ai-tint px-3 py-2 text-[12.5px] leading-relaxed text-ink-muted">
          <SparkIcon className="mt-px size-4 shrink-0 text-ai-ink" />
          {/*
            "Still being written" and "unavailable" look identical on a card
            and mean opposite things. The requirement breakdown below is
            complete and deterministic either way — the prose is the only part
            that waits.
          */}
          {pending
            ? d.jobMatch.explanationPending
            : d.jobMatch.explanationUnavailable}
        </p>
      )}

      <TopReasons match={match} />

      <div className="flex flex-col gap-1.5">
        <Disclosure label={d.jobMatch.whyMatches}>
          <ExplanationList facts={explanation.matches} empty={d.jobMatch.noPreferences} />
        </Disclosure>
        {explanation.notHigher.length > 0 ? (
          <Disclosure label={d.jobMatch.whyNotHigher}>
            <ExplanationList facts={explanation.notHigher} />
          </Disclosure>
        ) : null}
      </div>

      {/*
        The ADVANCED analysis, when the backend ran one.
        Placed above the legacy breakdown rather than replacing it: the older
        supported/unsupported/unclear lists are still the deterministic
        fallback for a row ranked before the advanced engine shipped, and a
        reader who has both should meet the richer one first.
      */}
      {match.insight && hasAdvancedDetail(match.insight) ? (
        <MatchInsightPanel
          score={match.score}
          band={match.band}
          insight={match.insight}
          showImprovements
        />
      ) : null}

      <RequirementBreakdown match={match} />

      <div className="flex flex-col gap-1.5">
        {match.evidence.length > 0 ? (
          <Disclosure
            label={`${d.jobMatch.viewEvidence} (${match.evidence.length})`}
          >
            <MatchEvidenceList evidence={match.evidence} />
          </Disclosure>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Link
          href={`/jobs/${vacancy.slug}`}
          className="inline-flex w-full items-center justify-center rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-[var(--motion-fast)] hover:border-line-strong hover:bg-surface-muted sm:w-auto"
        >
          {d.jobMatch.viewJob}
        </Link>
        {match.applicationState ? (
          <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
            <ApplicationStatusBadge status={match.applicationState} />
            <Link
              href="/my-applications"
              className="text-[12.5px] font-medium text-brand-ink hover:text-brand"
            >
              {d.nav.myApplications}
            </Link>
          </span>
        ) : open ? (
          // The apply flow itself (profile/resume checks, duplicate handling,
          // confirmation) lives on the job page — one implementation.
          <Link
            href={`/jobs/${vacancy.slug}`}
            className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white transition-colors duration-[var(--motion-fast)] hover:bg-brand-hover sm:w-auto"
          >
            {d.jobs.apply}
          </Link>
        ) : null}
      </div>
    </CandidateCard>
  );
}

/**
 * The band beside the score.
 *
 * A LOW badge is rendered exactly like the others and the card is shown in
 * full: a weak match is a real result on the last page, not something to hide.
 */
export function MatchBandBadge({ band }: { band: MatchBand }) {
  const { d } = useI18n();
  return (
    <MatchBandChip band={bandFor(band)}>{d.jobMatch.band[band]}</MatchBandChip>
  );
}

/**
 * The 0-100 canonical score.
 *
 * Labelled as a match score and nothing else — never a percentage of the job
 * the person can do, and never a probability of being hired.
 */
function MatchScore({ match }: { match: JobMatch }) {
  const { d, f } = useI18n();
  const percent = Math.round(match.score);

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      {/*
        The ring restates the number the label already gives, so it is marked
        as an image with the same sentence rather than read twice. Its colour
        follows the band, which is printed beside the title in words.
      */}
      <MatchScoreRing
        percent={percent}
        band={bandFor(match.band)}
        label={`${d.jobMatch.scoreLabel}: ${f(d.jobMatch.scoreValue, { score: match.score })}`}
      />
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
        {d.jobMatch.scoreLabel}
      </span>
    </div>
  );
}

/**
 * Pay, as the employer stated it — with the candidate's own currency beneath
 * it when a conversion actually happened.
 *
 * The original always comes first and is never replaced: the employer said
 * ₩40M, and the ≈ line is our arithmetic, clearly marked as approximate.
 */
function MatchSalary({ match }: { match: JobMatch }) {
  const { d } = useI18n();
  const { vacancy } = match;
  if (!vacancy.currency || (vacancy.salaryMin === null && vacancy.salaryMax === null)) {
    return null;
  }
  const original = formatMoneyRange(
    vacancy.salaryMin,
    vacancy.salaryMax,
    vacancy.currency,
    vacancy.payPeriod,
    d,
  );
  if (!original) return null;

  const salaryFact = match.alignments.find(
    (alignment) => alignment.dimension === "salary",
  );
  const converted =
    salaryFact?.salary?.convertedCurrency &&
    salaryFact.salary.convertedCurrency !== salaryFact.salary.originalCurrency
      ? formatMoneyRange(
          salaryFact.salary.convertedMin,
          salaryFact.salary.convertedMax,
          salaryFact.salary.convertedCurrency,
          salaryFact.salary.convertedPayPeriod,
          d,
        )
      : null;

  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
      <span className="font-medium text-ink">{original}</span>
      {converted ? (
        <span className="text-[12.5px] text-ink-muted">
          {d.jobMatch.approxSalary.replace("{amount}", converted)}
        </span>
      ) : null}
    </p>
  );
}

/** Two or three positives, shown without a click. */
function TopReasons({ match }: { match: JobMatch }) {
  const { d } = useI18n();
  const reasons = topReasons(match, d);
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((fact) => (
        <li
          key={fact.key}
          className="flex items-start gap-2 text-[13px] leading-relaxed text-ink"
        >
          <span aria-hidden className="mt-px text-positive-ink">
            ✓
          </span>
          <span className="min-w-0 break-words">{fact.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One explanation list. Tone decides the marker, never the wording. */
function ExplanationList({
  facts,
  empty,
}: {
  facts: ExplanationFact[];
  empty?: string;
}) {
  if (facts.length === 0) {
    return empty ? (
      <p className="text-[12.5px] leading-relaxed text-ink-muted">{empty}</p>
    ) : null;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {facts.map((fact) => (
        <li key={fact.key} className="flex items-start gap-2 text-[13px]">
          <span
            aria-hidden
            className={cn(
              "mt-px shrink-0",
              fact.tone === "positive" && "text-positive-ink",
              fact.tone === "negative" && "text-warning-ink",
              fact.tone === "neutral" && "text-ink-muted",
            )}
          >
            {fact.tone === "positive" ? "✓" : fact.tone === "negative" ? "△" : "·"}
          </span>
          <span className="min-w-0 break-words leading-relaxed text-ink">
            {fact.text}
            {fact.detail ? (
              <span className="block text-[12.5px] text-ink-muted">
                {fact.detail}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

const STRENGTH_TONES: Record<JobMatchStrength, BadgeTone> = {
  STRONG: "positive",
  PARTIAL: "warning",
  WEAK: "neutral",
};

/** Evidence-coverage label. Words, not numbers — and never a recommendation. */
export function MatchStrengthBadge({
  strength,
}: {
  strength: JobMatchStrength;
}) {
  const { d } = useI18n();
  return (
    <Badge
      tone={STRENGTH_TONES[strength]}
      className="px-2 py-1 text-[12px] font-semibold"
    >
      {d.jobMatch.strength[strength]}
    </Badge>
  );
}

function RequirementBreakdown({ match }: { match: JobMatch }) {
  const { d } = useI18n();
  const groups = [
    {
      key: "supported",
      label: d.jobMatch.supported,
      tone: "positive" as const,
      items: match.supportedRequirements,
    },
    {
      key: "missing",
      label: d.jobMatch.missing,
      tone: "warning" as const,
      items: match.unsupportedRequirements,
    },
    {
      key: "unclear",
      label: d.jobMatch.unclear,
      tone: "neutral" as const,
      items: match.unclearRequirements,
    },
  ];

  return (
    <section aria-label={d.jobMatch.requirementSummary} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {groups.map((group) => (
          <div
            key={group.key}
            className="min-w-0 rounded-lg border border-line bg-surface-muted/35 px-3 py-2"
          >
            <p className="flex min-w-0 items-center gap-2 text-[12.5px] font-medium text-ink">
              <Badge tone={group.tone}>{group.items.length}</Badge>
              <span className="min-w-0 break-words">{group.label}</span>
            </p>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-subtle">
              {group.items[0]?.text ?? d.jobMatch.noneInGroup}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {groups.map((group) =>
          group.items.length > 0 ? (
            <RequirementGroup
              key={group.key}
              label={group.label}
              tone={group.tone}
              items={group.items}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

function RequirementGroup({
  label,
  tone,
  items,
}: {
  label: string;
  tone: BadgeTone;
  items: MatchRequirement[];
}) {
  const { d } = useI18n();

  return (
    <Disclosure
      label={
        <span className="inline-flex min-w-0 items-center gap-2">
          <Badge tone={tone}>{items.length}</Badge>
          <span className="min-w-0 break-words">{label}</span>
        </span>
      }
    >
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="min-w-0 text-[13px] leading-relaxed">
            <p className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-ink">
              <span className="min-w-0 break-words">{item.text}</span>
              {item.required ? (
                <Chip className="text-[10.5px]">{d.jobMatch.required}</Chip>
              ) : null}
            </p>
            {item.reason ? (
              <p className="mt-0.5 break-words text-[12.5px] text-ink-muted">
                {item.reason}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** A compact accessible accordion row used for requirements and evidence. */
function Disclosure({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState(false);
  const contentId = useId();

  return (
    <div className="min-w-0 rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={openState}
        aria-controls={contentId}
        onClick={() => setOpenState((value) => !value)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-ink-subtle transition-transform",
            openState && "rotate-180",
          )}
        />
      </button>
      <div id={contentId} hidden={!openState} className="px-3 pb-3">
        {children}
      </div>
    </div>
  );
}

"use client";

import { Badge, Chip } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  ArrowRightIcon,
  CheckIcon,
  SparkIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { useSpotlight } from "@/lib/ui/use-spotlight";
import {
  PLANNED_SOURCING_SOURCES,
  RECRUITER_TIERS,
  type RecruiterTier,
} from "@/lib/plans/recruiter-preview";

/**
 * Where HR Copilot for recruiters is going — and nothing more.
 *
 * ## Every claim on this page is marked
 *
 * FREE lists what a recruiter can do today. PRO and MAX are labelled
 * "planned" on the tier, on every action, and on each named source. There is
 * no purchase control, no price for an unpriced tier, and no checkout code
 * imported here — the job seeker's billing lives in `PlansWorkspace` and this
 * file shares no code with it, only the visual language.
 *
 * ## The named sources are the sharpest edge
 *
 * LinkedIn, Saramin and JobKorea are not integrated. They are rendered as
 * plain-text chips carrying a "Planned" label, with a sentence underneath
 * saying none is connected. No logos: a mark would imply a partnership that
 * does not exist, and we do not have licence to use one.
 */
export function RecruiterPlansPreview() {
  const { d } = useI18n();
  const copy = d.recruiterPlans;

  return (
    <div className="ambient-hero mx-auto max-w-6xl">
      <header className="accent-panel relative mb-5 overflow-hidden rounded-[16px] border border-line p-5 sm:p-6">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-8 hidden text-brand/15 sm:block"
        >
          <UsersIcon className="size-40" />
        </span>

        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-brand-ink">
              {d.nav.sectionAccount}
            </p>
            <Badge tone="brand">{copy.comingSoon}</Badge>
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[32px]">
            {copy.title}
          </h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
            {copy.description}
          </p>
        </div>
      </header>

      {/*
        Stated before the cards, not after them: a reader should know nothing
        is purchasable before they read a feature list, not once they have
        started looking for a buy button.
      */}
      <p
        role="note"
        className="mb-5 rounded-[12px] border border-line bg-surface-muted px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted"
      >
        {copy.previewNotice}
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {RECRUITER_TIERS.map((tier) => (
          <TierCard key={tier.id} tier={tier} />
        ))}
      </div>

      <SourcingRoadmap />

      <section className="accent-panel ai-halo mt-5 overflow-hidden rounded-[16px] border border-ai-line p-5 sm:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
          {copy.roadmap.title}
        </h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
          {copy.roadmap.description}
        </p>
      </section>
    </div>
  );
}

function TierCard({ tier }: { tier: RecruiterTier }) {
  const { d } = useI18n();
  const onPointerMove = useSpotlight();
  const copy = d.recruiterPlans;
  const tierCopy = copy.tiers[tier.id];
  const planned = tier.availability === "planned";

  return (
    <article
      aria-labelledby={`recruiter-plan-${tier.id.toLowerCase()}`}
      onPointerMove={onPointerMove}
      className={cn(
        "card-interactive spotlight flex h-full flex-col gap-4 rounded-[16px] border bg-surface p-5",
        tier.emphasis === "strong" &&
          "ai-halo border-brand/30 bg-gradient-to-b from-brand-soft/50 to-surface",
        tier.emphasis === "accent" && "border-line-strong",
        tier.emphasis === "none" && "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={`recruiter-plan-${tier.id.toLowerCase()}`}
            className="text-[15.5px] font-semibold tracking-[-0.01em] text-ink"
          >
            {tierCopy.name}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {tierCopy.tagline}
          </p>
        </div>
        <Badge tone={planned ? "brand" : "neutral"}>
          {planned ? copy.comingSoon : copy.currentlyIncluded}
        </Badge>
      </div>

      {/*
        A tier with no approved price shows the words, not a number. Rendering
        "$0" for an unpriced future tier would be a commercial claim.
      */}
      {tier.monthlyUsd === null ? (
        <p className="text-[15px] font-medium text-ink-muted">
          {copy.pricingComingSoon}
        </p>
      ) : (
        <p className="flex items-baseline gap-1.5">
          <span className="text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-ink">
            {copy.free}
          </span>
          <span className="text-[12.5px] text-ink-muted">{copy.perMonth}</span>
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {tierCopy.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted"
          >
            <CheckIcon
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                planned ? "text-ink-subtle" : "text-positive",
              )}
              aria-hidden="true"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-1">
        {/*
          Disabled, always. There is no recruiter checkout to reach and no
          notification list to join — offering either would be a control that
          does nothing, which is worse than an honest label.
        */}
        <Button type="button" variant="secondary" size="sm" disabled>
          {planned ? copy.comingSoon : copy.currentlyIncluded}
        </Button>
      </div>
    </article>
  );
}

/** The planned flow, drawn as steps. Illustration only — nothing runs. */
function SourcingRoadmap() {
  const { d } = useI18n();
  const copy = d.recruiterPlans.sourcing;

  return (
    <section
      aria-labelledby="sourcing-roadmap-title"
      className="ai-edge mt-5 overflow-hidden rounded-[16px] border border-ai-line bg-ai-tint p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-[7px] bg-ai-ink/10 text-ai-ink">
          <SparkIcon className="size-3.5" aria-hidden="true" />
        </span>
        <h2
          id="sourcing-roadmap-title"
          className="text-[15.5px] font-semibold tracking-[-0.01em] text-ai-ink"
        >
          {copy.title}
        </h2>
      </div>

      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
        {copy.description}
      </p>

      <ol className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-stretch">
        {copy.steps.map((step, index) => (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0 flex-1 rounded-[10px] border border-ai-line bg-surface px-3 py-2.5">
              <p className="text-[11px] font-semibold tabular-nums text-ink-subtle">
                {index + 1}
              </p>
              <p className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">
                {step}
              </p>
            </div>
            {index < copy.steps.length - 1 ? (
              <ArrowRightIcon
                aria-hidden="true"
                className="hidden size-3.5 shrink-0 rotate-90 text-ink-subtle lg:block lg:rotate-0"
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-ai-line pt-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-subtle">
          {copy.sourcesTitle}
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {PLANNED_SOURCING_SOURCES.map((source) => (
            <li key={source}>
              {/*
                Plain text plus an explicit "Planned" label on every single
                chip. A bare product name beside an AI feature reads as an
                integration, which is exactly the claim we cannot make.
              */}
              <Chip>
                {source}
                <span className="ml-1.5 rounded-[4px] bg-surface-muted px-1 py-px text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">
                  {d.recruiterPlans.planned}
                </span>
              </Chip>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
          {copy.sourcesNote}
        </p>
      </div>
    </section>
  );
}

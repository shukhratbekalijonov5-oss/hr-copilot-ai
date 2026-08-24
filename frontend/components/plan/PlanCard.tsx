"use client";

import { cn } from "@/lib/utils";
import { useSpotlight } from "@/lib/ui/use-spotlight";
import { CheckIcon } from "@/components/ui/icons";
import { CurrentPlanBadge } from "@/components/plan/CurrentPlanBadge";
import { PlanActionButton } from "@/components/plan/PlanActionButton";
import { useI18n } from "@/lib/i18n/context";
import {
  capabilitiesForPlan,
  priceFor,
  type Plan,
} from "@/lib/entitlements/plan";

export function PlanCard({
  plan,
  currentPlan,
  startingPlan,
  busy,
  onCheckout,
}: {
  plan: Plan;
  currentPlan: Plan | null;
  /** The plan whose checkout is being created, if any. */
  startingPlan: Plan | null;
  /** True while ANY checkout is in flight — one session at a time. */
  busy: boolean;
  onCheckout: (target: Plan) => void;
}) {
  const { d, f } = useI18n();
  const onPointerMove = useSpotlight();
  const copy = d.plans.cards[plan];
  const isCurrent = currentPlan === plan;
  const capabilities = capabilitiesForPlan(plan);

  return (
    <article className="h-full" aria-labelledby={`plan-${plan.toLowerCase()}-title`}>
      {/*
        MAX carries a faint accent frame and PRO a slightly stronger border,
        so the paid tiers read as the offer without a "MOST POPULAR" ribbon.
        The current plan is marked by its badge, never by the frame — those
        are different facts and must not compete for the same visual slot.
      */}
      <div
        onPointerMove={onPointerMove}
        className={cn(
          "card-interactive spotlight flex h-full flex-col gap-4 rounded-[16px] border bg-surface p-5",
          plan === "MAX"
            ? "border-brand/30 bg-gradient-to-b from-brand-soft/50 to-surface"
            : plan === "PRO"
              ? "border-line-strong"
              : "border-line",
        )}
      >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2
            id={`plan-${plan.toLowerCase()}-title`}
            className="text-[15.5px] font-semibold tracking-tight text-ink"
          >
            {d.plans.names[plan]}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {copy.tagline}
          </p>
        </div>
        {isCurrent ? <CurrentPlanBadge /> : null}
      </div>

      <p className="text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-ink">
        {f(d.plans.priceMonthly, {
          amount: String(priceFor(plan).monthlyUsd),
        })}
      </p>

      <section className="space-y-2" aria-label={d.plans.capabilities}>
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.plans.capabilities}
        </p>
        <ul className="flex flex-col gap-1.5">
          {capabilities.length > 0 ? (
            capabilities.map((capability) => (
              <li
                key={capability}
                className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted"
              >
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-positive" aria-hidden="true" />
                <span>{d.plans.capabilityNames[capability]}</span>
              </li>
            ))
          ) : (
            <li className="text-[13px] leading-relaxed text-ink-muted">
              {d.plans.noPaidCapabilities}
            </li>
          )}
        </ul>
      </section>

      <section className="space-y-2" aria-label={d.plans.features}>
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.plans.features}
        </p>
        <ul className="flex flex-col gap-1.5">
          {copy.features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted"
            >
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-positive" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-auto pt-1">
        <PlanActionButton
          current={currentPlan}
          target={plan}
          pending={startingPlan === plan}
          busy={busy}
          onCheckout={onCheckout}
        />
      </div>
      </div>
    </article>
  );
}

import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/layout/PageHeader";
import { getTranslations } from "@/lib/i18n/server";
import { format } from "@/lib/i18n/format";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PLAN_PRICES, type CandidatePlan } from "@/lib/entitlements/plan";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.plans.title };
}

/**
 * What the three plans include.
 *
 * ## Deliberately not a billing screen
 *
 * There is no payment service yet, so there is no checkout here, no card form,
 * no "start trial" and no button that pretends to charge anything. Building a
 * purchase flow against a backend that cannot take money would produce a
 * screen whose only honest behaviour is to fail — and a half-built billing UI
 * is the hardest kind to delete later, because it looks finished.
 *
 * What this page owes the reader today is one thing: an accurate answer to
 * "what would I get, and what does it cost". It gives that and stops.
 *
 * ## The current plan is marked only when the backend says so
 *
 * On an API that does not report plans, nothing is marked current — rather
 * than marking Free, which would tell a paying customer they are on the free
 * tier. Absence of information is shown as absence of information.
 */
export default async function PlansPage() {
  const [{ workspace }, d] = await Promise.all([
    requirePersonalWorkspace(),
    getTranslations(),
  ]);
  const current = workspace.entitlements.plan;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={d.plans.title} description={d.plans.description} />

      {current ? (
        <p className="mb-4 text-[13px] text-ink-muted">
          {format(d.plans.currentPlanIs, { plan: d.plans.names[current] })}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLAN_PRICES.map(({ plan, monthlyUsd }) => (
          <PlanCard
            key={plan}
            plan={plan}
            monthlyUsd={monthlyUsd}
            isCurrent={current === plan}
            d={d}
          />
        ))}
      </div>

      <p className="mt-5 text-[12.5px] leading-relaxed text-ink-subtle">
        {d.plans.noCheckoutNote}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  monthlyUsd,
  isCurrent,
  d,
}: {
  plan: CandidatePlan;
  monthlyUsd: number;
  isCurrent: boolean;
  d: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const copy = d.plans.cards[plan];

  return (
    <Card className="flex h-full flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15.5px] font-semibold tracking-tight text-ink">
          {d.plans.names[plan]}
        </h2>
        {/* Words, not a highlight colour, so the marker survives a greyscale
            screen and a screen reader alike. */}
        {isCurrent ? <Badge tone="brand">{d.plans.currentPlan}</Badge> : null}
      </div>

      <p className="text-[22px] font-semibold leading-none tracking-tight text-ink">
        {format(d.plans.priceMonthly, { amount: String(monthlyUsd) })}
      </p>

      <p className="text-[13px] leading-relaxed text-ink-muted">
        {copy.tagline}
      </p>

      <ul className="mt-1 flex flex-col gap-1.5">
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
    </Card>
  );
}

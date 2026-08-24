"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import { LockIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { priceFor, type CandidatePlan, type PlanCapability } from "@/lib/entitlements/plan";

/**
 * What a candidate sees where a feature they do not have would be.
 *
 * ## It describes the product, it does not just refuse
 *
 * The alternative — hiding the surface entirely — is worse for everybody. A
 * person cannot want what they cannot see, and a navigation entry that
 * silently vanishes reads as a bug rather than as a tier. So the screen keeps
 * its own title, says plainly which plan includes it and what that plan costs,
 * and offers one way forward.
 *
 * ## It is not an error
 *
 * No alert tone, no "something went wrong", no retry button. Nothing failed
 * here: the reader is on a plan that does not include this, which is an
 * ordinary state of the world and reads as one. A retry button would be the
 * cruellest possible control — it cannot ever succeed.
 *
 * ## Heading, not a styled paragraph
 *
 * A real `<h2>` so the locked state is a landmark a screen-reader user can
 * jump to, and so the page keeps one coherent outline whether the feature is
 * unlocked or not.
 *
 * A client component so that BOTH entry points can render it: the server pages
 * that gate before fetching, and the client workspace that discovers the lock
 * from a 403 mid-session.
 */
export function PlanLockedCard({
  capability,
  requiredPlan,
}: {
  capability: PlanCapability;
  requiredPlan: CandidatePlan;
}) {
  const { d, f } = useI18n();
  const copy = d.plans.locked[capability];
  const planName = d.plans.names[requiredPlan];

  return (
    <Card className="p-6 sm:p-8">
      <div className="mx-auto flex max-w-lg flex-col items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-surface-muted text-ink-muted">
          <LockIcon className="size-4.5" aria-hidden="true" />
        </span>

        <h2 className="text-[17px] font-semibold tracking-tight text-ink">
          {copy.title}
        </h2>

        {/*
          The required plan is stated in words in its own line, not implied by
          a badge colour or hidden inside the button label — this is the one
          fact the reader needs in order to decide anything.
        */}
        <p className="text-[14px] font-medium text-ink">
          {f(d.plans.availableOn, { plan: planName })}
        </p>
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          {copy.description}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Link href="/plans" className={buttonStyles("primary", "md")}>
            {f(d.plans.upgradeTo, { plan: planName })}
          </Link>
          <span className="text-[12.5px] text-ink-subtle">
            {f(d.plans.priceMonthly, { amount: String(priceFor(requiredPlan).monthlyUsd) })}
          </span>
        </div>
      </div>
    </Card>
  );
}

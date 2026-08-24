"use client";

import { Button } from "@/components/ui/Button";
import { CurrentPlanBadge } from "@/components/plan/CurrentPlanBadge";
import { useI18n } from "@/lib/i18n/context";
import {
  canStartCheckout,
  isCheckoutPlan,
  KRW_CHECKOUT_CHARGE,
  planActionFor,
  priceFor,
  type Plan,
  type PlanActionKind,
} from "@/lib/entitlements/plan";

export function PlanActionButton({
  current,
  target,
  pending,
  busy,
  onCheckout,
}: {
  current: Plan | null;
  target: Plan;
  /** This plan's checkout is being created. */
  pending: boolean;
  /** Some checkout is being created — never offer a second one. */
  busy: boolean;
  onCheckout: (target: Plan) => void;
}) {
  const { d, f } = useI18n();
  const action = planActionFor(current, target);

  if (action === "current") return <CurrentPlanBadge />;

  const label = actionLabel(action, target, d, f);
  const hintId = `plan-action-${target.toLowerCase()}-hint`;
  const canCheckout = canStartCheckout(current, target);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        type="button"
        variant={canCheckout ? "primary" : "secondary"}
        size="sm"
        loading={pending}
        disabled={!canCheckout || busy}
        aria-describedby={hintId}
        onClick={canCheckout && !busy ? () => onCheckout(target) : undefined}
      >
        {label}
      </Button>
      {/*
        The charge is disclosed BEFORE the click, not on the provider's page:
        the price above is in dollars but Toss bills a fixed won amount, and a
        reader should see that without having to reach the payment screen.
      */}
      <p id={hintId} className="text-[11.5px] leading-relaxed text-ink-subtle">
        {canCheckout && isCheckoutPlan(target)
          ? f(d.plans.checkout.chargedAsKrw, {
              usd: String(priceFor(target).monthlyUsd),
              krw: KRW_CHECKOUT_CHARGE[target],
            })
          : action === "downgrade"
            ? d.plans.actions.downgradeUnavailable
            : d.plans.actions.freePlanNoCheckout}
      </p>
    </div>
  );
}

function actionLabel(
  action: PlanActionKind,
  target: Plan,
  d: ReturnType<typeof useI18n>["d"],
  f: ReturnType<typeof useI18n>["f"],
): string {
  if (action === "upgrade") {
    return f(d.plans.actions.upgradeTo, { plan: d.plans.names[target] });
  }
  if (action === "downgrade") {
    return f(d.plans.actions.downgradeTo, { plan: d.plans.names[target] });
  }
  return f(d.plans.actions.choosePlan, { plan: d.plans.names[target] });
}

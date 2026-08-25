"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createCheckoutAction,
  devSwitchPlanAction,
} from "@/app/(candidate)/plans/actions";
import { BillingStatus } from "@/components/plan/BillingStatus";
import { Button } from "@/components/ui/Button";
import { DemoCheckoutModal } from "@/components/plan/DemoCheckoutModal";
import { DeveloperPlanSwitch } from "@/components/plan/DeveloperPlanSwitch";
import { PlanCard } from "@/components/plan/PlanCard";
import type { BillingSummary } from "@/lib/billing/types";
import { useI18n } from "@/lib/i18n/context";
import {
  CANDIDATE_PLANS,
  CHECKOUT_PLANS,
  isCheckoutPlan,
  type CheckoutPlan,
  type Entitlements,
  type Plan,
} from "@/lib/entitlements/plan";

export function PlansWorkspace({
  initialEntitlements,
  initialBilling,
  initialBillingError,
  portfolioDemoEnabled,
}: {
  initialEntitlements: Entitlements;
  initialBilling: BillingSummary | null;
  initialBillingError: "billingUnavailable" | "unauthenticated" | "forbidden" | null;
  portfolioDemoEnabled: boolean;
}) {
  const router = useRouter();
  const { d, f } = useI18n();
  const [entitlements, setEntitlements] = useState(initialEntitlements);
  const [billing, setBilling] = useState<BillingSummary | null>(initialBilling);
  const [billingError, setBillingError] = useState(initialBillingError);
  // The REAL Toss checkout: which plan is being started, and why it failed.
  const [checkoutPending, setCheckoutPending] = useState<CheckoutPlan | null>(null);
  const [checkoutError, setCheckoutError] = useState<
    keyof typeof d.plans.checkout.errors | null
  >(null);
  // The DEMO dialog, kept in its own state so a demo failure can never
  // surface on the real upgrade buttons, or the reverse.
  const [demoPlan, setDemoPlan] = useState<CheckoutPlan | null>(null);
  const [demoError, setDemoError] = useState<
    keyof typeof d.plans.checkout.errors | null
  >(null);
  const [demoPending, setDemoPending] = useState(false);
  const [demoSucceeded, setDemoSucceeded] = useState(false);
  const [devSwitchPending, setDevSwitchPending] = useState(false);
  const [devSwitchError, setDevSwitchError] = useState<
    keyof typeof d.plans.devSwitch.errors | null
  >(null);
  const [devSwitchOutcome, setDevSwitchOutcome] = useState<
    "changed" | "unchanged" | null
  >(null);
  const currentPlan = billing?.plan ?? entitlements.plan;

  /**
   * THE upgrade path, for every environment.
   *
   * The Upgrade buttons go straight to the real Toss checkout: the action
   * asks the payment service for a session and answers a redirect URL, and
   * the browser follows it. Nothing about the charge is decided here — no
   * amount, no currency, no account id crosses; the KRW figure shown on the
   * card is display copy mirroring the server's own fixed price.
   *
   * `checkoutPending` holds the plan being started, which both drives the
   * button spinner and blocks a second call — a double click must not create
   * two payment sessions.
   */
  async function startCheckout(plan: Plan) {
    if (!isCheckoutPlan(plan) || checkoutPending) return;

    setCheckoutError(null);
    setCheckoutPending(plan);
    const result = await createCheckoutAction(plan);

    if (!result.ok) {
      setCheckoutError(result.reason);
      setCheckoutPending(null);
      return;
    }

    // Left pending on purpose: the page is navigating away, and re-enabling
    // the button first would offer a second checkout during the redirect.
    window.location.assign(result.redirectUrl);
  }

  /** Opens the branded demo dialog. Inert unless portfolio demo mode is on. */
  function openDemoCheckout(plan: CheckoutPlan) {
    if (!portfolioDemoEnabled) return;
    setDemoError(null);
    setDemoSucceeded(false);
    setDemoPlan(plan);
  }

  /**
   * The DEMO purchase. It reuses the existing plan switch rather than
   * inventing a payment call, so the plan that comes back is the server's,
   * refetched by the action — never a local guess about what the plan became.
   *
   * The card fields are not passed in, because they are not passed anywhere.
   */
  async function payWithDemoCard() {
    if (!demoPlan || demoPending) return;

    setDemoError(null);
    setDemoPending(true);
    const result = await devSwitchPlanAction(demoPlan);
    setDemoPending(false);

    if (!result.ok) {
      setDemoError(
        result.reason === "refreshFailed" || result.reason === "switchUnavailable"
          ? "checkoutUnavailable"
          : result.reason,
      );
      return;
    }

    setBilling(result.billing);
    setBillingError(null);
    setEntitlements(result.entitlements);
    setDemoSucceeded(true);
    router.refresh();
  }

  function closeDemoCheckout() {
    if (demoPending) return;
    setDemoPlan(null);
    setDemoError(null);
    setDemoSucceeded(false);
  }

  async function switchDeveloperPlan(plan: Plan) {
    if (devSwitchPending) return;

    setDevSwitchPending(true);
    setDevSwitchError(null);
    setDevSwitchOutcome(null);
    const result = await devSwitchPlanAction(plan);
    setDevSwitchPending(false);

    if (!result.ok) {
      setDevSwitchError(result.reason);
      return;
    }

    setBilling(result.billing);
    setBillingError(null);
    setEntitlements(result.entitlements);
    setDevSwitchOutcome(result.changed ? "changed" : "unchanged");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="current-plan-title" className="space-y-2">
        <h2
          id="current-plan-title"
          className="text-[17px] font-semibold tracking-tight text-ink"
        >
          {d.plans.currentPlan}
        </h2>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          {currentPlan
            ? f(d.plans.currentPlanIs, { plan: d.plans.names[currentPlan] })
            : d.plans.notReported}
        </p>
      </section>

      <BillingStatus billing={billing} error={billingError} />

      <section aria-labelledby="plan-options-title" className="space-y-3">
        <div>
          <h2
            id="plan-options-title"
            className="text-[17px] font-semibold tracking-tight text-ink"
          >
            {d.plans.planOptions}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {d.plans.planOptionsDescription}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CANDIDATE_PLANS.map((plan) => (
            <PlanCard
              key={plan}
              plan={plan}
              currentPlan={currentPlan}
              startingPlan={checkoutPending}
              busy={checkoutPending !== null}
              onCheckout={startCheckout}
            />
          ))}
        </div>
        {checkoutError ? (
          <p
            role="alert"
            className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-[13px] leading-relaxed text-critical"
          >
            {d.plans.checkout.errors[checkoutError]}
          </p>
        ) : null}
      </section>
      {portfolioDemoEnabled ? (
        <section
          aria-label={d.plans.demoCheckout.demoBadge}
          className="rounded-xl border border-dashed border-line bg-surface p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              {d.plans.demoCheckout.demoModeNote}
            </p>
            <p className="text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
              {d.plans.devSwitch.portfolioDemo}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHECKOUT_PLANS.map((plan) => (
              <Button
                key={plan}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openDemoCheckout(plan)}
              >
                {f(d.plans.demoCheckout.openDemo, { plan: d.plans.names[plan] })}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {portfolioDemoEnabled ? (
        <DeveloperPlanSwitch
          currentPlan={currentPlan}
          pending={devSwitchPending}
          error={
            devSwitchError ? d.plans.devSwitch.errors[devSwitchError] : null
          }
          outcome={devSwitchOutcome}
          onSwitch={switchDeveloperPlan}
        />
      ) : null}
      {demoPlan && portfolioDemoEnabled ? (
        <DemoCheckoutModal
          plan={demoPlan}
          /* Double-locked: the dialog cannot open, or pay, without this flag. */
          demoPaymentEnabled={portfolioDemoEnabled}
          pending={demoPending}
          succeeded={demoSucceeded}
          error={demoError ? d.plans.checkout.errors[demoError] : null}
          onClose={closeDemoCheckout}
          onPay={payWithDemoCard}
          onRealCheckout={() => startCheckout(demoPlan)}
        />
      ) : null}
    </div>
  );
}

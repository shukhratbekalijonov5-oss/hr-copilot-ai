"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CANDIDATE_PLANS, type Plan } from "@/lib/entitlements/plan";
import { useI18n } from "@/lib/i18n/context";

export function DeveloperPlanSwitch({
  currentPlan,
  pending,
  error,
  outcome,
  onSwitch,
}: {
  currentPlan: Plan | null;
  pending: boolean;
  error: string | null;
  outcome: "changed" | "unchanged" | null;
  onSwitch: (plan: Plan) => Promise<void>;
}) {
  const { d, f } = useI18n();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const titleId = "developer-plan-switch-title";
  const dialogTitleId = "developer-plan-switch-confirm-title";
  const dialogDescriptionId = "developer-plan-switch-confirm-description";

  useEffect(() => {
    if (!selectedPlan) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) setSelectedPlan(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, selectedPlan]);

  async function confirm() {
    if (!selectedPlan || pending) return;
    await onSwitch(selectedPlan);
    setSelectedPlan(null);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-dashed border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-ink">
            {d.plans.devSwitch.title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {d.plans.devSwitch.description}
          </p>
        </div>
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-subtle">
          {d.plans.devSwitch.devOnly}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-busy={pending}>
        {CANDIDATE_PLANS.map((plan) => (
          <Button
            key={plan}
            type="button"
            variant={currentPlan === plan ? "secondary" : "primary"}
            size="sm"
            disabled={pending}
            onClick={() => setSelectedPlan(plan)}
          >
            {f(d.plans.devSwitch.switchTo, { plan: d.plans.names[plan] })}
          </Button>
        ))}
      </div>

      {pending ? (
        <p role="status" className="mt-3 text-[13px] text-ink-muted">
          {d.plans.devSwitch.switching}
        </p>
      ) : null}
      {outcome ? (
        <p role="status" className="mt-3 text-[13px] text-positive">
          {outcome === "changed"
            ? d.plans.devSwitch.planUpdated
            : d.plans.devSwitch.alreadyOnThisPlan}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-critical">
          {error}
        </p>
      ) : null}

      {selectedPlan ? (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 py-6 backdrop-blur-[2px]"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            className="animate-pop-in w-full max-w-md rounded-[16px] border border-line bg-surface p-5 shadow-pop"
          >
            <h2
              id={dialogTitleId}
              className="text-[17px] font-semibold tracking-tight text-ink"
            >
              {f(d.plans.devSwitch.confirmTitle, {
                plan: d.plans.names[selectedPlan],
              })}
            </h2>
            <p
              id={dialogDescriptionId}
              className="mt-2 text-[13px] leading-relaxed text-ink-muted"
            >
              {d.plans.devSwitch.confirmDescription}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                autoFocus
                onClick={() => setSelectedPlan(null)}
              >
                {d.common.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                loading={pending}
                onClick={confirm}
              >
                {d.plans.devSwitch.confirm}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

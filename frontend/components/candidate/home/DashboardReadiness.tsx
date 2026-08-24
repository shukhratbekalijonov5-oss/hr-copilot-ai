"use client";

import { ProfileReadiness, type ReadinessStep } from "@/components/candidate/ui/ProfileReadiness";
import { useI18n } from "@/lib/i18n/context";

export function DashboardReadiness({ steps }: { steps: ReadinessStep[] }) {
  const { d, f } = useI18n();
  const done = steps.filter((step) => step.done).length;

  return (
    <ProfileReadiness
      steps={steps}
      title={d.home.readiness.title}
      summary={f(d.home.readiness.summary, {
        done: String(done),
        total: String(steps.length),
      })}
      completeLabel={d.home.readiness.complete}
    />
  );
}

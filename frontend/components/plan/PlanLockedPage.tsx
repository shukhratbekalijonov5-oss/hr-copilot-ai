import { PageHeader } from "@/components/layout/PageHeader";
import { AiJobSearchTabs } from "@/components/candidate/AiJobSearchTabs";
import { PlanLockedCard } from "@/components/plan/PlanLockedCard";
import { requiredPlanFor, type Entitlements, type PlanCapability } from "@/lib/entitlements/plan";
import type { CandidatePlan } from "@/lib/entitlements/plan";

/**
 * A gated AI job search page, in its locked form.
 *
 * The page keeps its own title and its own tab strip: the reader is still
 * somewhere, and can still cross to the other side of the product. Only the
 * body is replaced. Hiding the header too would make a locked feature look
 * like a routing accident.
 */
export function PlanLockedPage({
  capability,
  entitlements,
  current,
  title,
  description,
  requiredPlan = requiredPlanFor(capability),
}: {
  capability: PlanCapability;
  entitlements: Entitlements;
  current: "internal" | "external";
  title: string;
  description: string;
  /** The backend's stated requirement when a 403 named one; ours otherwise. */
  requiredPlan?: CandidatePlan;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={title} description={description} />
      <AiJobSearchTabs current={current} entitlements={entitlements} />
      <PlanLockedCard capability={capability} requiredPlan={requiredPlan} />
    </div>
  );
}

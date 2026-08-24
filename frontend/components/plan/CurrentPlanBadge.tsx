"use client";

import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

export function CurrentPlanBadge() {
  const { d } = useI18n();
  return (
    <Badge tone="brand" icon={<CheckIcon className="size-3" aria-hidden="true" />}>
      {d.plans.currentPlan}
    </Badge>
  );
}

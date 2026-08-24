"use client";

import { Badge } from "@/components/ui/Badge";
import { LockIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { CandidatePlan } from "@/lib/entitlements/plan";

/**
 * The plan name, as a badge.
 *
 * ## Colour is never the message
 *
 * A locked entry carries a lock GLYPH and the plan's NAME, and the tint is
 * decoration on top of both. Somebody who cannot distinguish the tints, or who
 * is reading this through a screen reader, still gets "Max" and still gets the
 * lock — which is the whole content of the signal.
 *
 * The lock is `aria-hidden` and the surrounding label carries the words
 * instead, so a reader hears "External AI Jobs, Max" rather than "External AI
 * Jobs, image, Max".
 */
export function PlanBadge({
  plan,
  locked = false,
  className,
}: {
  plan: CandidatePlan;
  /** Adds the lock glyph. The plan name shows either way. */
  locked?: boolean;
  className?: string;
}) {
  const { d } = useI18n();

  return (
    <Badge
      tone={locked ? "neutral" : "brand"}
      icon={locked ? <LockIcon className="size-3" aria-hidden="true" /> : undefined}
      className={className}
    >
      {d.plans.names[plan]}
    </Badge>
  );
}

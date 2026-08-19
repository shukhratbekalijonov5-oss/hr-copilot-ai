"use client";

import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import type { StreamStatus } from "@/lib/hooks/useProcessingStream";

const TONES = {
  connecting: "neutral",
  live: "positive",
  reconnecting: "warning",
  offline: "neutral",
} as const;

/**
 * Makes the realtime connection's state visible, so a stalled pipeline is
 * never mistaken for a lost connection (or the reverse).
 */
export function StreamStatusPill({ status }: { status: StreamStatus }) {
  const { d } = useI18n();

  return (
    <Badge tone={TONES[status]}>
      <span
        aria-hidden="true"
        className={
          status === "live"
            ? "size-1.5 rounded-full bg-positive"
            : "size-1.5 rounded-full bg-current opacity-60"
        }
      />
      {d.status.stream[status]}
    </Badge>
  );
}

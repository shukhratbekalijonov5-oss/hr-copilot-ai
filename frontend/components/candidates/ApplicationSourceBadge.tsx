"use client";

import { Badge } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import type { ApplicationSource } from "@/lib/types";

/**
 * Shows where an application came from.
 *
 * Renders nothing when the API did not report a source, which is the case for
 * every application today — an absent source is left absent rather than being
 * labelled "Direct" on the assumption that it probably was.
 */
export function ApplicationSourceBadge({
  source,
}: {
  source: ApplicationSource | undefined;
}) {
  const { d } = useI18n();
  if (!source) return null;
  return <Badge tone="neutral">{d.status.applicationSource[source]}</Badge>;
}

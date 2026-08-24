"use client";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import type { BillingSummary } from "@/lib/billing/types";
import { isPlanCapability } from "@/lib/entitlements/plan";

export function BillingStatus({
  billing,
  error,
}: {
  billing: BillingSummary | null;
  error: "billingUnavailable" | "unauthenticated" | "forbidden" | null;
}) {
  const { d, f, date } = useI18n();

  if (!billing) {
    return (
      <section
        aria-labelledby="billing-status-title"
        className="rounded-xl border border-line bg-surface p-4"
      >
        <h2
          id="billing-status-title"
          className="text-[15px] font-semibold tracking-tight text-ink"
        >
          {d.plans.billing.title}
        </h2>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] leading-relaxed text-critical">
            {d.plans.billing.errors[error]}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="billing-status-title"
      className="rounded-xl border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="billing-status-title"
            className="text-[15px] font-semibold tracking-tight text-ink"
          >
            {d.plans.billing.title}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {f(d.plans.currentPlanIs, {
              plan: d.plans.names[billing.plan],
            })}
          </p>
        </div>
        <Badge tone={toneForStatus(billing.subscriptionStatus)}>
          {statusLabel(billing.subscriptionStatus, d, f)}
        </Badge>
      </div>

      <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">{d.plans.billing.subscriptionStatus}</dt>
          <dd className="mt-1 text-ink-muted">
            {statusLabel(billing.subscriptionStatus, d, f)}
          </dd>
        </div>
        {billing.effectiveUntil ? (
          <div>
            <dt className="font-medium text-ink">{d.plans.billing.effectiveUntil}</dt>
            <dd className="mt-1 text-ink-muted">{date(billing.effectiveUntil)}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="font-medium text-ink">{d.plans.billing.backendCapabilities}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {billing.capabilities.length > 0 ? (
              billing.capabilities.map((capability) => (
                <Badge key={capability} tone="neutral">
                  {capabilityLabel(capability, d)}
                </Badge>
              ))
            ) : (
              <span className="text-ink-muted">{d.plans.noPaidCapabilities}</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function capabilityLabel(
  capability: string,
  d: ReturnType<typeof useI18n>["d"],
): string {
  return isPlanCapability(capability)
    ? d.plans.capabilityNames[capability]
    : capability;
}

function statusLabel(
  status: string,
  d: ReturnType<typeof useI18n>["d"],
  f: ReturnType<typeof useI18n>["f"],
): string {
  const labels = d.plans.billing.subscriptionStatuses;
  return status in labels
    ? labels[status as keyof typeof labels]
    : f(d.plans.billing.unknownStatus, { status });
}

function toneForStatus(status: string): BadgeTone {
  if (status === "ACTIVE") return "positive";
  if (status === "PENDING") return "info";
  if (status === "PAST_DUE" || status === "CANCEL_AT_PERIOD_END") {
    return "warning";
  }
  if (status === "CANCELLED" || status === "EXPIRED") return "critical";
  return "neutral";
}

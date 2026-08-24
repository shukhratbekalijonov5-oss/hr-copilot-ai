import "server-only";

import { ApiError } from "@/lib/api/errors";
import { apiFetch } from "@/lib/api/http";
import type {
  BillingSummary,
  CheckoutResponse,
  DevPlanSwitchResponse,
} from "@/lib/billing/types";
import {
  isCandidatePlan,
  isCheckoutPlan,
  type CandidatePlan,
  type CheckoutPlan,
} from "@/lib/entitlements/plan";

const BILLING_PATH = "/candidate-account/me/billing";
const CHECKOUT_PATH = `${BILLING_PATH}/checkout`;
const DEV_PLAN_SWITCH_PATH = `${BILLING_PATH}/dev-plan-switch`;

interface CheckoutWire {
  paymentId?: unknown;
  checkoutId?: unknown;
  redirectUrl?: unknown;
  reused?: unknown;
}

interface BillingSummaryWire {
  plan?: unknown;
  capabilities?: unknown;
  subscriptionStatus?: unknown;
  effectiveUntil?: unknown;
  version?: unknown;
}

interface DevPlanSwitchWire {
  plan?: unknown;
  changed?: unknown;
}

export async function createCheckout(plan: CheckoutPlan): Promise<CheckoutResponse> {
  if (!isCheckoutPlan(plan)) {
    throw new ApiError("Invalid checkout plan.", 400, "validation");
  }

  const response = await apiFetch<CheckoutWire>(CHECKOUT_PATH, {
    method: "POST",
    body: { plan },
  });

  if (
    typeof response.paymentId !== "string" ||
    typeof response.checkoutId !== "string" ||
    typeof response.redirectUrl !== "string" ||
    typeof response.reused !== "boolean" ||
    !isNavigableRedirect(response.redirectUrl)
  ) {
    throw new ApiError("Checkout returned an unreadable response.", 502, "server");
  }

  return {
    paymentId: response.paymentId,
    checkoutId: response.checkoutId,
    redirectUrl: response.redirectUrl,
    reused: response.reused,
  };
}

export async function getBillingSummary(): Promise<BillingSummary> {
  const response = await apiFetch<BillingSummaryWire>(BILLING_PATH);

  if (
    !isCandidatePlan(response.plan) ||
    !Array.isArray(response.capabilities) ||
    !response.capabilities.every((capability) => typeof capability === "string") ||
    typeof response.subscriptionStatus !== "string" ||
    !(typeof response.effectiveUntil === "string" || response.effectiveUntil === null) ||
    typeof response.version !== "number"
  ) {
    throw new ApiError("Billing returned an unreadable response.", 502, "server");
  }

  return {
    plan: response.plan,
    capabilities: response.capabilities,
    subscriptionStatus: response.subscriptionStatus,
    effectiveUntil: response.effectiveUntil,
    version: response.version,
  };
}

export async function devSwitchPlan(
  plan: CandidatePlan,
): Promise<DevPlanSwitchResponse> {
  if (!isCandidatePlan(plan)) {
    throw new ApiError("Invalid plan.", 400, "validation");
  }

  const response = await apiFetch<DevPlanSwitchWire>(DEV_PLAN_SWITCH_PATH, {
    method: "POST",
    body: { plan },
  });

  if (!isCandidatePlan(response.plan) || typeof response.changed !== "boolean") {
    throw new ApiError("Plan switch returned an unreadable response.", 502, "server");
  }

  return { plan: response.plan, changed: response.changed };
}

function isNavigableRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

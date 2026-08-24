"use server";

import { api, ApiError, toApiError } from "@/lib/api";
import type { BillingSummary } from "@/lib/billing/types";
import {
  isCheckoutPlan,
  type CandidatePlan,
  type Entitlements,
} from "@/lib/entitlements/plan";

type CheckoutErrorReason =
  | "invalidTransition"
  | "unauthenticated"
  | "forbidden"
  | "routeUnavailable"
  | "conflict"
  | "paymentUnavailable"
  | "checkoutUnavailable";

type DevSwitchErrorReason =
  | "invalidTransition"
  | "unauthenticated"
  | "forbidden"
  | "routeUnavailable"
  | "conflict"
  | "paymentUnavailable"
  | "refreshFailed"
  | "switchUnavailable";

export async function createCheckoutAction(plan: CandidatePlan): Promise<
  | { ok: true; redirectUrl: string; reused: boolean }
  | { ok: false; reason: CheckoutErrorReason }
> {
  if (!isCheckoutPlan(plan)) {
    return { ok: false, reason: "invalidTransition" };
  }

  try {
    const checkout = await api.createCheckout(plan);
    return {
      ok: true,
      redirectUrl: checkout.redirectUrl,
      reused: checkout.reused,
    };
  } catch (error) {
    return { ok: false, reason: checkoutReason(error) };
  }
}

function checkoutReason(error: unknown): CheckoutErrorReason {
  const apiError = error instanceof ApiError ? error : toApiError(error);

  if (apiError.status === 400 || apiError.status === 422) {
    return "invalidTransition";
  }
  if (apiError.status === 401) return "unauthenticated";
  if (apiError.status === 403) return "forbidden";
  if (apiError.status === 404) return "routeUnavailable";
  if (apiError.status === 409) return "conflict";
  if (apiError.status === 503 || apiError.kind === "unavailable") {
    return "paymentUnavailable";
  }
  return "checkoutUnavailable";
}

export async function devSwitchPlanAction(plan: CandidatePlan): Promise<
  | {
      ok: true;
      changed: boolean;
      billing: BillingSummary;
      entitlements: Entitlements;
    }
  | { ok: false; reason: DevSwitchErrorReason }
> {
  let switched: { changed: boolean };
  try {
    switched = await api.devSwitchPlan(plan);
  } catch (error) {
    return { ok: false, reason: devSwitchReason(error) };
  }

  try {
    const [billing, session] = await Promise.all([
      api.getBillingSummary(),
      api.getSession(),
    ]);
    return {
      ok: true,
      changed: switched.changed,
      billing,
      entitlements: session.entitlements,
    };
  } catch {
    return { ok: false, reason: "refreshFailed" };
  }
}

function devSwitchReason(error: unknown): DevSwitchErrorReason {
  const apiError = error instanceof ApiError ? error : toApiError(error);

  if (apiError.status === 400 || apiError.status === 422) {
    return "invalidTransition";
  }
  if (apiError.status === 401) return "unauthenticated";
  if (apiError.status === 403) return "forbidden";
  if (apiError.status === 404) return "routeUnavailable";
  if (apiError.status === 409) return "conflict";
  if (apiError.status === 503 || apiError.kind === "unavailable") {
    return "paymentUnavailable";
  }
  return "switchUnavailable";
}

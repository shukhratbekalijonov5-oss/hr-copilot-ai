import type { CandidatePlan } from "@/lib/entitlements/plan";

export type BillingSummary = {
  plan: CandidatePlan;
  capabilities: string[];
  subscriptionStatus: string;
  effectiveUntil: string | null;
  version: number;
};

export type CheckoutResponse = {
  paymentId: string;
  checkoutId: string;
  redirectUrl: string;
  reused: boolean;
};

export type DevPlanSwitchResponse = {
  plan: CandidatePlan;
  changed: boolean;
};

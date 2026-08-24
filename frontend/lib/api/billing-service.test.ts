import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { apiFetch } from "@/lib/api/http";
import {
  createCheckout,
  devSwitchPlan,
  getBillingSummary,
} from "@/lib/api/billing.service";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

describe("billing BFF adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates checkout through the candidate BFF route only", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      paymentId: "payment-1",
      checkoutId: "checkout-1",
      redirectUrl: "https://sandbox.example/checkout/checkout-1",
      reused: false,
    });

    const checkout = await createCheckout("PRO");

    expect(checkout.redirectUrl).toContain("checkout-1");
    expect(apiFetch).toHaveBeenCalledWith(
      "/candidate-account/me/billing/checkout",
      {
        method: "POST",
        body: { plan: "PRO" },
      },
    );
  });

  it("rejects FREE before making a checkout request", async () => {
    await expect(createCheckout("FREE" as never)).rejects.toBeInstanceOf(ApiError);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("requires the backend to return a redirect URL", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      paymentId: "payment-1",
      checkoutId: "checkout-1",
      reused: false,
    });

    await expect(createCheckout("MAX")).rejects.toBeInstanceOf(ApiError);
  });

  it("refuses an obviously unsafe redirect URL", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      paymentId: "payment-1",
      checkoutId: "checkout-1",
      redirectUrl: "javascript:alert(1)",
      reused: false,
    });

    await expect(createCheckout("MAX")).rejects.toBeInstanceOf(ApiError);
  });

  it("accepts reused checkout responses without inventing payment state", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      paymentId: "payment-1",
      checkoutId: "checkout-1",
      redirectUrl: "https://sandbox.example/checkout/checkout-1",
      reused: true,
    });

    await expect(createCheckout("MAX")).resolves.toMatchObject({
      reused: true,
      redirectUrl: "https://sandbox.example/checkout/checkout-1",
    });
  });

  it("keeps billing summary to the exact BFF fields", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      plan: "MAX",
      capabilities: ["INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH", "UNKNOWN"],
      subscriptionStatus: "ACTIVE",
      effectiveUntil: "2026-09-24T00:00:00.000Z",
      version: 7,
      pendingPlan: "PRO",
    });

    await expect(getBillingSummary()).resolves.toEqual({
      plan: "MAX",
      capabilities: ["INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH", "UNKNOWN"],
      subscriptionStatus: "ACTIVE",
      effectiveUntil: "2026-09-24T00:00:00.000Z",
      version: 7,
    });
    expect(apiFetch).toHaveBeenCalledWith("/candidate-account/me/billing");
  });

  it("rejects malformed billing summary instead of guessing", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      plan: "FREE",
      capabilities: [],
      subscriptionStatus: "ACTIVE",
      effectiveUntil: null,
      version: "7",
    });

    await expect(getBillingSummary()).rejects.toBeInstanceOf(ApiError);
  });

  it("switches plans through the dev/test BFF route", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      plan: "PRO",
      changed: true,
    });

    await expect(devSwitchPlan("PRO")).resolves.toEqual({
      plan: "PRO",
      changed: true,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/candidate-account/me/billing/dev-plan-switch",
      {
        method: "POST",
        body: { plan: "PRO" },
      },
    );
  });

  it("handles already-on-this-plan dev switch responses", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce({
      plan: "MAX",
      changed: false,
    });

    await expect(devSwitchPlan("MAX")).resolves.toEqual({
      plan: "MAX",
      changed: false,
    });
  });
});

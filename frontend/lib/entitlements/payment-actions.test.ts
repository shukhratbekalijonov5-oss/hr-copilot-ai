import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckoutAction,
  devSwitchPlanAction,
} from "@/app/(candidate)/plans/actions";
import { api, ApiError } from "@/lib/api";
import { resolveEntitlements } from "@/lib/entitlements/plan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", async () => {
  class MockApiError extends Error {
    readonly status: number;
    readonly kind: string;

    constructor(message: string, status = 500, kind = "server") {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.kind = kind;
    }
  }

  return {
    ApiError: MockApiError,
    toApiError: (error: unknown) =>
      error instanceof MockApiError
        ? error
        : new MockApiError("Server error", 500, "server"),
    api: {
      createCheckout: vi.fn(),
      devSwitchPlan: vi.fn(),
      getBillingSummary: vi.fn(),
      getSession: vi.fn(),
    },
  };
});

const apiMock = vi.mocked(api);

describe("payment plan server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never sends FREE as a checkout target", async () => {
    await expect(createCheckoutAction("FREE")).resolves.toEqual({
      ok: false,
      reason: "invalidTransition",
    });
    expect(apiMock.createCheckout).not.toHaveBeenCalled();
  });

  it("returns only the backend redirect URL after checkout succeeds", async () => {
    apiMock.createCheckout.mockResolvedValueOnce({
      paymentId: "pay-1",
      checkoutId: "co-1",
      redirectUrl: "https://sandbox.example/checkout/co-1",
      reused: true,
    });

    await expect(createCheckoutAction("PRO")).resolves.toEqual({
      ok: true,
      redirectUrl: "https://sandbox.example/checkout/co-1",
      reused: true,
    });
  });

  it.each([
    [422, "validation", "invalidTransition"],
    [404, "not_found", "routeUnavailable"],
    [503, "unavailable", "paymentUnavailable"],
  ] as const)("maps checkout status %s to %s", async (status, kind, reason) => {
    apiMock.createCheckout.mockRejectedValueOnce(
      new ApiError("Checkout failed", status, kind),
    );

    await expect(createCheckoutAction("MAX")).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it("refetches billing and auth after a successful dev switch", async () => {
    apiMock.devSwitchPlan.mockResolvedValueOnce({ plan: "PRO", changed: true });
    apiMock.getBillingSummary.mockResolvedValueOnce({
      plan: "PRO",
      capabilities: ["INTERNAL_AI_SEARCH"],
      subscriptionStatus: "ACTIVE",
      effectiveUntil: null,
      version: 2,
    });
    apiMock.getSession.mockResolvedValueOnce({
      id: "user-1",
      fullName: "Candidate",
      email: "candidate@example.com",
      accountType: "CANDIDATE",
      preferredLocale: "en",
      avatarUrl: null,
      hasCandidateAccount: true,
      entitlements: resolveEntitlements({
        plan: "PRO",
        capabilities: ["INTERNAL_AI_SEARCH"],
      }),
      activeOrganization: null,
      memberships: [],
    });

    const result = await devSwitchPlanAction("PRO");

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      billing: { plan: "PRO", version: 2 },
      entitlements: {
        plan: "PRO",
        canUseInternalAiJobs: true,
        canUseExternalAiJobs: false,
      },
    });
    expect(apiMock.devSwitchPlan).toHaveBeenCalledTimes(1);
    expect(apiMock.devSwitchPlan).toHaveBeenCalledWith("PRO");
    expect(apiMock.getBillingSummary).toHaveBeenCalledTimes(1);
    expect(apiMock.getSession).toHaveBeenCalledTimes(1);
  });

  it("handles changed:false after authoritative refetch", async () => {
    apiMock.devSwitchPlan.mockResolvedValueOnce({ plan: "MAX", changed: false });
    apiMock.getBillingSummary.mockResolvedValueOnce({
      plan: "MAX",
      capabilities: ["INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH"],
      subscriptionStatus: "ACTIVE",
      effectiveUntil: null,
      version: 3,
    });
    apiMock.getSession.mockResolvedValueOnce({
      id: "user-1",
      fullName: "Candidate",
      email: "candidate@example.com",
      accountType: "CANDIDATE",
      preferredLocale: "en",
      avatarUrl: null,
      hasCandidateAccount: true,
      entitlements: resolveEntitlements({
        plan: "MAX",
        capabilities: ["INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH"],
      }),
      activeOrganization: null,
      memberships: [],
    });

    await expect(devSwitchPlanAction("MAX")).resolves.toMatchObject({
      ok: true,
      changed: false,
      billing: { plan: "MAX" },
    });
  });

  it.each([
    [404, "not_found", "routeUnavailable"],
    [503, "unavailable", "paymentUnavailable"],
  ] as const)("maps dev switch status %s to %s", async (status, kind, reason) => {
    apiMock.devSwitchPlan.mockRejectedValueOnce(
      new ApiError("Switch failed", status, kind),
    );

    await expect(devSwitchPlanAction("PRO")).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it("does not claim success if authoritative refresh fails", async () => {
    apiMock.devSwitchPlan.mockResolvedValueOnce({ plan: "FREE", changed: true });
    apiMock.getBillingSummary.mockRejectedValueOnce(
      new ApiError("Billing failed", 503, "unavailable"),
    );
    apiMock.getSession.mockResolvedValueOnce({
      id: "user-1",
      fullName: "Candidate",
      email: "candidate@example.com",
      accountType: "CANDIDATE",
      preferredLocale: "en",
      avatarUrl: null,
      hasCandidateAccount: true,
      entitlements: resolveEntitlements({ plan: "FREE", capabilities: [] }),
      activeOrganization: null,
      memberships: [],
    });

    await expect(devSwitchPlanAction("FREE")).resolves.toEqual({
      ok: false,
      reason: "refreshFailed",
    });
  });
});

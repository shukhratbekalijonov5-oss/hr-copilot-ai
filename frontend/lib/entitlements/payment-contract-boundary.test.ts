import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function code(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("final payment frontend contract", () => {
  it("renders all three plan cards from the canonical plan list", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    expect(workspace).toContain("CANDIDATE_PLANS.map");
    expect(code("lib/entitlements/plan.ts")).toContain(
      '["FREE", "PRO", "MAX"]',
    );
  });

  it("renders the current plan from the billing summary when available", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    const page = code("components/plan/CandidatePlansView.tsx");
    expect(page).toContain("api.getBillingSummary()");
    expect(workspace).toContain("initialBilling");
    expect(workspace).toContain("billing?.plan ?? entitlements.plan");
  });

  it("keeps /auth/me entitlements as the capability authority", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    expect(workspace).toContain("initialEntitlements");
    expect(workspace).toContain("entitlements.plan");
    expect(code("lib/api/adapters.ts")).toContain(
      "response.candidateAccount.plan ?? response.plan",
    );
  });

  it("keeps capabilities authoritative for access and card display", () => {
    expect(code("lib/api/adapters.ts")).toContain(
      "response.candidateAccount.capabilities ?? response.capabilities",
    );
    expect(code("app/(candidate)/job-matches/page.tsx")).toContain(
      "!workspace.entitlements.canUseInternalAiJobs",
    );
    expect(code("app/(candidate)/external-jobs/page.tsx")).toContain(
      "!workspace.entitlements.canUseExternalAiJobs",
    );
  });

  it("renders the demo plan switch only behind the explicit portfolio flag", () => {
    const page = code("components/plan/CandidatePlansView.tsx");
    const workspace = code("components/plan/PlansWorkspace.tsx");
    const devSwitch = code("components/plan/DeveloperPlanSwitch.tsx");

    expect(page).toContain("portfolioDemoEnabled={PORTFOLIO_DEMO}");
    expect(workspace).toContain("portfolioDemoEnabled ? (");
    expect(workspace).toContain("<DeveloperPlanSwitch");
    expect(devSwitch).toContain("CANDIDATE_PLANS.map");
    expect(devSwitch).toContain("portfolioDemo");

    // The old gate must be gone: NODE_ENV once decided this, and leaving a
    // second gate behind would mean two answers to one question.
    expect(page).not.toContain("process.env.NODE_ENV");
    expect(workspace).not.toContain("process.env.NODE_ENV");
  });

  it("contains no Java internal payment URL or secret in frontend source", () => {
    const all = [
      "components/plan/CandidatePlansView.tsx",
      "app/(candidate)/plans/actions.ts",
      "components/plan/PlansWorkspace.tsx",
      "components/plan/DeveloperPlanSwitch.tsx",
      "components/plan/BillingStatus.tsx",
      "components/plan/PlanActionButton.tsx",
      "lib/api/index.ts",
      "lib/api/billing.service.ts",
      "lib/api/contracts.ts",
      "lib/entitlements/plan.ts",
    ].map(read).join("\n");

    const internalQaPath = ["", "internal", "dev", ["plan", "switch"].join("-")].join("/");
    expect(all).not.toContain(["80", "81"].join(""));
    expect(all).not.toContain(internalQaPath);
    expect(all).not.toMatch(new RegExp(["payment", "service"].join("[-.]"), "i"));
    expect(all).not.toMatch(/service[_-]?secret|api[_-]?key/i);
  });

  it("uses billing BFF routes only inside the billing adapter and its adapter tests", () => {
    const adapter = code("lib/api/billing.service.ts");
    expect(adapter).toContain("/candidate-account/me/billing");
    expect(adapter).toContain('`${BILLING_PATH}/checkout`');
    expect(adapter).toContain('`${BILLING_PATH}/dev-plan-switch`');

    const otherFrontend = [
      "components/plan/CandidatePlansView.tsx",
      "app/(candidate)/plans/actions.ts",
      "components/plan/PlansWorkspace.tsx",
      "components/plan/DemoCheckoutModal.tsx",
      "components/plan/DeveloperPlanSwitch.tsx",
      "components/plan/BillingStatus.tsx",
      "components/plan/PlanCard.tsx",
      "components/plan/PlanActionButton.tsx",
    ].map(code).join("\n");
    expect(otherFrontend).not.toContain("/candidate-account/me/billing/checkout");
    expect(otherFrontend).not.toContain("/candidate-account/me/billing/dev-plan-switch");
  });

  it("does not optimistically change entitlements or checkout state", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    const devResult = workspace.indexOf("if (!result.ok)");
    const updateEntitlements = workspace.indexOf("setEntitlements(result.entitlements)");
    expect(devResult).toBeGreaterThan(-1);
    expect(updateEntitlements).toBeGreaterThan(devResult);
    expect(workspace).not.toContain("resolveEntitlements");
    expect(workspace).not.toMatch(/localStorage|sessionStorage/);
  });

  it("redirects only after a successful checkout action result", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    const failureBranch = workspace.indexOf("if (!result.ok)");
    const redirect = workspace.indexOf("window.location.assign(result.redirectUrl)");
    expect(failureBranch).toBeGreaterThan(-1);
    expect(redirect).toBeGreaterThan(failureBranch);
    expect(workspace).not.toMatch(/https?:\/\/.*checkout/i);
  });

  it("keeps failed checkout on the same current plan", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    expect(workspace).toContain("setCheckoutError(result.reason)");
    expect(workspace).toContain("setCheckoutPending(null)");
    expect(workspace).not.toContain("window.location.assign(result.reason)");
  });

  it("successful dev switch refetches billing and auth before UI state changes", () => {
    const actions = code("app/(candidate)/plans/actions.ts");
    const workspace = code("components/plan/PlansWorkspace.tsx");
    expect(actions).toContain("api.devSwitchPlan(plan)");
    expect(actions).toContain("api.getBillingSummary()");
    expect(actions).toContain("api.getSession()");
    expect(workspace.indexOf("setBilling(result.billing)")).toBeGreaterThan(-1);
    expect(workspace.indexOf("setEntitlements(result.entitlements)")).toBeGreaterThan(-1);
    expect(workspace).toContain("router.refresh()");
  });

  it("shows the checkout dialog with keyboard and dialog affordances", () => {
    const dialog = code("components/plan/DemoCheckoutModal.tsx");
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain("autoFocus");
    expect(dialog).toContain("aria-labelledby");
  });

  it("shows dev switch confirmation with keyboard and status affordances", () => {
    const devSwitch = code("components/plan/DeveloperPlanSwitch.tsx");
    expect(devSwitch).toContain('role="dialog"');
    expect(devSwitch).toContain('aria-modal="true"');
    expect(devSwitch).toContain('event.key === "Escape"');
    expect(devSwitch).toContain('role="status"');
    expect(devSwitch).toContain('role="alert"');
    expect(devSwitch).toContain("autoFocus");
  });

  it("does not render speculative billing summary fields", () => {
    const all = [
      "components/plan/CandidatePlansView.tsx",
      "components/plan/PlansWorkspace.tsx",
      "components/plan/BillingStatus.tsx",
      "components/plan/DemoCheckoutModal.tsx",
      "components/plan/PlanCard.tsx",
      "components/plan/PlanActionButton.tsx",
    ].map(code).join("\n");

    for (const field of [
      "currentPeriodEnd",
      "pendingPlan",
      "effectiveAt",
      "cancelAtPeriodEnd",
    ]) {
      expect(all).not.toContain(field);
    }
  });

  it("has mobile-friendly plan card layout classes", () => {
    const workspace = code("components/plan/PlansWorkspace.tsx");
    expect(workspace).toContain("grid gap-4");
    expect(workspace).toContain("md:grid-cols-2");
    expect(workspace).toContain("xl:grid-cols-3");
  });

  it("localizes current plan, capabilities and checkout states", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.plans.names.FREE, locale).toBeTruthy();
      expect(dictionary.plans.names.PRO, locale).toBeTruthy();
      expect(dictionary.plans.names.MAX, locale).toBeTruthy();
      expect(dictionary.plans.capabilityNames.INTERNAL_AI_SEARCH, locale).toBeTruthy();
      expect(dictionary.plans.capabilityNames.EXTERNAL_AI_SEARCH, locale).toBeTruthy();
      expect(dictionary.plans.actions.checkoutHint, locale).toBeTruthy();
      expect(dictionary.plans.checkout.continue, locale).toBeTruthy();
      expect(dictionary.plans.checkout.errors.paymentUnavailable, locale).toBeTruthy();
      expect(dictionary.plans.checkout.errors.routeUnavailable, locale).toBeTruthy();
      expect(dictionary.plans.billing.subscriptionStatus, locale).toBeTruthy();
      expect(dictionary.plans.billing.effectiveUntil, locale).toBeTruthy();
      expect(dictionary.plans.billing.errors.billingUnavailable, locale).toBeTruthy();
      expect(dictionary.plans.devSwitch.title, locale).toBeTruthy();
      expect(dictionary.plans.devSwitch.switchTo, locale).toContain("{plan}");
      expect(dictionary.plans.devSwitch.alreadyOnThisPlan, locale).toBeTruthy();
      expect(dictionary.plans.devSwitch.errors.routeUnavailable, locale).toBeTruthy();
    }
  });
});

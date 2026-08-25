import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_CARD_FORM,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  isCardFormValid,
  validateCardForm,
} from "@/lib/billing/card-form";
import { KRW_CHECKOUT_CHARGE, priceFor } from "@/lib/entitlements/plan";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const VALID = {
  cardholder: "Alex Morgan",
  number: "4242 4242 4242 4242",
  expiry: "04/29",
  cvc: "123",
};

describe("demo checkout card form", () => {
  it("accepts a complete, well-shaped card", () => {
    expect(validateCardForm(VALID)).toEqual({});
    expect(isCardFormValid(VALID)).toBe(true);
  });

  it("blocks submission while anything is missing", () => {
    expect(validateCardForm(EMPTY_CARD_FORM)).toEqual({
      cardholder: "required",
      number: "required",
      expiry: "required",
      cvc: "required",
    });
    expect(isCardFormValid(EMPTY_CARD_FORM)).toBe(false);
  });

  it("rejects the shapes a demo form should still catch", () => {
    expect(validateCardForm({ ...VALID, number: "4242" }).number).toBe("invalid");
    expect(validateCardForm({ ...VALID, number: "4242-4242-4242" }).number).toBe(
      "invalid",
    );
    expect(validateCardForm({ ...VALID, expiry: "0429" }).expiry).toBe("invalid");
    expect(validateCardForm({ ...VALID, expiry: "13/29" }).expiry).toBe("invalid");
    expect(validateCardForm({ ...VALID, cvc: "12" }).cvc).toBe("invalid");
    expect(validateCardForm({ ...VALID, cvc: "12345" }).cvc).toBe("invalid");
  });

  it("formats input without inventing digits", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatCardNumber("42ab42")).toBe("4242");
    expect(formatExpiry("0429")).toBe("04/29");
    expect(formatExpiry("4")).toBe("4");
    expect(formatCvc("12a34567")).toBe("1234");
  });
});

describe("demo checkout modal wiring", () => {
  const workspace = code("components/plan/PlansWorkspace.tsx");
  const modal = code("components/plan/DemoCheckoutModal.tsx");

  it("sends the main Upgrade CTA to the real Toss checkout, not the modal", () => {
    expect(workspace).toContain("onCheckout={startCheckout}");
    expect(workspace).toContain("const result = await createCheckoutAction(plan);");
    // The plan grid must not be able to open the demo dialog.
    const start = workspace.slice(
      workspace.indexOf("async function startCheckout"),
      workspace.indexOf("function openDemoCheckout"),
    );
    expect(start).not.toContain("setDemoPlan");
    expect(start).toContain("window.location.assign(result.redirectUrl)");
    // Only the two paid plans reach checkout; FREE is filtered out.
    expect(workspace).toContain("if (!isCheckoutPlan(plan) || checkoutPending) return;");
  });

  it("uses the URL the checkout action returned, for PRO and for MAX", () => {
    const actions = code("app/(candidate)/plans/actions.ts");
    expect(actions).toContain("api.createCheckout(plan)");
    expect(actions).toContain("redirectUrl: checkout.redirectUrl");
    // One shared path — nothing branches on which paid plan it is.
    expect(workspace).not.toMatch(/createCheckoutAction\("(PRO|MAX)"\)/);
    expect(workspace).not.toMatch(/https?:\/\//);
  });

  it("cannot create two checkout sessions from a double click", () => {
    expect(workspace).toContain("setCheckoutPending(plan);");
    expect(workspace).toContain("busy={checkoutPending !== null}");
    expect(workspace).toContain("startingPlan={checkoutPending}");
    const button = code("components/plan/PlanActionButton.tsx");
    expect(button).toContain("disabled={!canCheckout || busy}");
    expect(button).toContain("onClick={canCheckout && !busy ? () => onCheckout(target) : undefined}");
    expect(button).toContain("loading={pending}");
  });

  it("discloses the won charge before the redirect", () => {
    const button = code("components/plan/PlanActionButton.tsx");
    expect(button).toContain("d.plans.checkout.chargedAsKrw");
    expect(button).toContain("KRW_CHECKOUT_CHARGE[target]");
    expect(button).toContain("priceFor(target).monthlyUsd");
    expect(KRW_CHECKOUT_CHARGE.PRO).toBe("9,900");
    expect(KRW_CHECKOUT_CHARGE.MAX).toBe("16,900");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const line = dictionary.plans.checkout.chargedAsKrw;
      expect(line, locale).toContain("{usd}");
      expect(line, locale).toContain("{krw}");
    }
  });

  it("never lets the browser state an amount, currency or account", () => {
    const actions = code("app/(candidate)/plans/actions.ts");
    expect(actions).toContain("api.createCheckout(plan)");
    for (const file of [workspace, code("components/plan/PlanActionButton.tsx"), actions]) {
      expect(file).not.toMatch(/amount:|currency|userId|accountId|9900|16900/);
    }
  });

  it("opens the branded demo dialog only from the flagged action", () => {
    expect(workspace).toContain("DemoCheckoutModal");
    expect(workspace).toContain("onClick={() => openDemoCheckout(plan)}");
    expect(workspace).toContain("d.plans.demoCheckout.openDemo");
    expect(workspace).toContain("if (!portfolioDemoEnabled) return;");
    expect(workspace).not.toContain("CheckoutConfirmation");
  });

  it("hides the demo action and the dialog unless the flag is on", () => {
    // Rendered only under the flag, AND the dialog re-checks it.
    expect(workspace).toContain("{demoPlan && portfolioDemoEnabled ? (");
    expect(workspace).toContain("demoPaymentEnabled={portfolioDemoEnabled}");
    expect(code("components/plan/CandidatePlansView.tsx")).toContain(
      "portfolioDemoEnabled={PORTFOLIO_DEMO}",
    );
  });

  it("prices each plan and labels the demo CTA from the same source", () => {
    expect(priceFor("PRO").monthlyUsd).toBe(7);
    expect(priceFor("MAX").monthlyUsd).toBe(12);
    // The modal derives the amount rather than hardcoding 7 or 12.
    expect(modal).toContain("priceFor(plan).monthlyUsd");
    expect(modal).toContain("f(copy.pay, { amount })");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.plans.demoCheckout.pay, locale).toContain("{amount}");
    }
  });

  it("does not submit while the form is invalid", () => {
    expect(modal).toContain("const found = validateCardForm(card);");
    expect(modal).toContain("if (Object.keys(found).length > 0) {");
    // The early return sits before the pay call, not after it.
    expect(modal.indexOf("setFormError(true);")).toBeLessThan(
      modal.indexOf("onPay();"),
    );
  });

  it("pays the demo through the existing dev plan switch, never a new API", () => {
    expect(workspace).toContain("const result = await devSwitchPlanAction(demoPlan);");
    expect(workspace).not.toMatch(/fetch\(|\/api\/(payment|checkout)/);
    const actions = code("app/(candidate)/plans/actions.ts");
    expect(actions).toContain("api.devSwitchPlan(plan)");
  });

  it("sends no card value anywhere", () => {
    // `onPay` takes no argument, so there is no channel to leak through.
    expect(modal).toContain("onPay: () => void;");
    expect(modal).toContain("onPay();");
    expect(modal).not.toMatch(/onPay\(\s*(card|values|\{)/);
    // ...and the workspace never even names a card field.
    for (const field of ["cardholder", "cvc", "expiry", "cardNumber", "card."]) {
      expect(workspace, field).not.toContain(field);
    }
  });

  it("never persists or logs card values", () => {
    for (const file of [modal, code("lib/billing/card-form.ts"), workspace]) {
      expect(file).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      expect(file).not.toMatch(/console\.(log|info|warn|error)/);
    }
    expect(modal).toContain('autoComplete="off"');
  });

  it("refetches authoritative state instead of asserting the new plan locally", () => {
    expect(workspace).toContain("setBilling(result.billing)");
    expect(workspace).toContain("setEntitlements(result.entitlements)");
    expect(workspace).toContain("router.refresh()");
    // Success is flagged only after the server's own values are applied.
    expect(workspace.indexOf("setEntitlements(result.entitlements);")).toBeLessThan(
      workspace.indexOf("setDemoSucceeded(true);"),
    );
  });

  it("clears every card field on close and on success", () => {
    // Card values live only in PaymentForm, which is unmounted by BOTH exits:
    // the success panel replaces it, and closing unmounts the whole dialog.
    expect(modal).toContain("const [card, setCard] = useState<CardFormValues>(EMPTY_CARD_FORM);");
    expect(modal).toContain("function PaymentForm({");
    expect(modal).toContain("succeeded ? (");
    expect(modal).toContain("<PaymentForm");
    // The shell that survives a success holds no card state of its own.
    const shell = modal.slice(
      modal.indexOf("export function DemoCheckoutModal"),
      modal.indexOf("function CardArt("),
    );
    expect(shell).not.toContain("setCard");
    expect(shell).not.toContain("card.");
    expect(workspace).toContain("setDemoPlan(null);");
  });

  it("keeps the real Toss path intact as the only way money moves", () => {
    expect(modal).toContain("demoPaymentEnabled ? (");
    expect(modal).toContain("onRealCheckout");
    expect(workspace).toContain("createCheckoutAction(plan)");
    expect(workspace).toContain("window.location.assign(result.redirectUrl)");
  });

  it("localizes the checkout in all four languages", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const copy = dictionary.plans.demoCheckout;
      for (const key of [
        "title",
        "paymentDetails",
        "cardholder",
        "cardNumber",
        "expiry",
        "cvc",
        "saveCard",
        "totalDueToday",
        "successTitle",
        "demoNote",
      ] as const) {
        expect(copy[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});

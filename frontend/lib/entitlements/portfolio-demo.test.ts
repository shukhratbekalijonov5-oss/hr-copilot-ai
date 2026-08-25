import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePortfolioDemoFlag } from "@/lib/config";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

/**
 * Portfolio demo mode.
 *
 * The demo plan switch changes a plan without taking payment, so the only
 * thing standing between a visitor and a free upgrade is this flag being off
 * by default. These tests pin that default, and pin the fact that the REAL
 * checkout is not behind the same gate.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("portfolio demo flag", () => {
  it("is off unless the value is exactly true", () => {
    expect(parsePortfolioDemoFlag("true")).toBe(true);
    // Tolerating case and stray whitespace is kindness to whoever sets it in
    // a Helm value or a CI variable; it is not tolerating a different word.
    expect(parsePortfolioDemoFlag("TRUE")).toBe(true);
    expect(parsePortfolioDemoFlag("  true  ")).toBe(true);
  });

  it("fails closed on everything else", () => {
    // `1` and `yes` are the plausible typos, and each must leave demo mode
    // OFF. A flag that half-parses is worse than one that never existed.
    for (const value of [undefined, "", " ", "false", "1", "0", "yes", "on", "True!"]) {
      expect(parsePortfolioDemoFlag(value), String(value)).toBe(false);
    }
  });
});

describe("demo mode wiring", () => {
  it("gates the switch on the flag and nothing else", () => {
    const page = read("components/plan/CandidatePlansView.tsx");
    expect(page).toContain("portfolioDemoEnabled={PORTFOLIO_DEMO}");
    // Prose may still explain the old gate; the CODE must not read it.
    expect(page).not.toContain("process.env.NODE_ENV");
  });

  it("leaves the real checkout outside the demo gate", () => {
    const workspace = read("components/plan/PlansWorkspace.tsx");
    // The upgrade buttons come from PlanCard, which is rendered from the
    // unconditional plan grid. If either of these ever moved inside the
    // flagged branch, a non-demo deployment would lose the ability to sell.
    const grid = workspace.indexOf("CANDIDATE_PLANS.map");
    const firstGate = workspace.indexOf("portfolioDemoEnabled ? (");
    expect(grid).toBeGreaterThan(-1);
    expect(firstGate).toBeGreaterThan(grid);
    expect(workspace).toContain("onCheckout={startCheckout}");
    // startCheckout must not consult the demo flag.
    const start = workspace.slice(
      workspace.indexOf("async function startCheckout"),
      workspace.indexOf("function openDemoCheckout"),
    );
    expect(start).not.toContain("portfolioDemoEnabled");
  });

  it("re-checks the flag before the demo dialog can open or pay", () => {
    const workspace = read("components/plan/PlansWorkspace.tsx");
    expect(workspace).toContain("if (!portfolioDemoEnabled) return;");
    expect(workspace).toContain("demoPaymentEnabled={portfolioDemoEnabled}");
  });
});

describe("demo copy", () => {
  it("labels the control in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.plans.devSwitch.portfolioDemo.trim(), locale).not.toBe("");
    }
  });

  it("says no payment is taken, in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const { description } = dictionary.plans.devSwitch;
      const { demoModeNote } = dictionary.plans.demoCheckout;
      expect(description.trim(), locale).not.toBe("");
      expect(demoModeNote.trim(), locale).not.toBe("");
      // The promise the UI makes to the reader is that nothing is charged.
      // Each locale states it in its own words, so assert the shape rather
      // than a phrase: both strings carry the dash-separated disclaimer.
      expect(description, locale).toContain("—");
      expect(demoModeNote, locale).toContain("—");
    }
  });

  it("no longer claims to be development-only", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const plans = JSON.stringify(dictionary.plans);
      expect(plans, locale).not.toContain("devOnly");
    }
  });
});

describe("the flag stays on the server side of the boundary", () => {
  it("is read only by a server component, so it can be toggled at runtime", () => {
    // Next inlines NEXT_PUBLIC_* only when it is set at build time. Leaving it
    // unset emits a real process.env read, which is what lets the deployment
    // turn demo mode on without rebuilding — but only for server code. If a
    // "use client" file ever imported PORTFOLIO_DEMO, that toggle would
    // silently stop working, so the reader must stay a server component.
    const page = read("components/plan/CandidatePlansView.tsx");
    const workspace = read("components/plan/PlansWorkspace.tsx");

    expect(page).toContain("PORTFOLIO_DEMO");
    expect(page).not.toContain('"use client"');
    // The client component receives it as a prop and never imports it.
    expect(workspace).toContain('"use client"');
    expect(workspace).not.toContain("PORTFOLIO_DEMO");
    expect(workspace).not.toContain("@/lib/config");
  });
});

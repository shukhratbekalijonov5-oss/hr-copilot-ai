import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANNED_SOURCING_SOURCES,
  RECRUITER_TIERS,
} from "@/lib/plans/recruiter-preview";
import {
  ORGANIZATION_NAV,
  ORGANIZATION_SECONDARY_NAV,
  groupNavItems,
} from "@/lib/workspace/navigation";
import {
  isRouteAllowedForAccountType,
} from "@/lib/auth/routing";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("recruiter plans are a preview, not a product", () => {
  const view = code("components/plan/RecruiterPlansPreview.tsx");

  it("prices only the tier that actually exists", () => {
    const byId = new Map(RECRUITER_TIERS.map((tier) => [tier.id, tier]));
    expect(byId.get("FREE")?.monthlyUsd).toBe(0);
    // No approved recruiter pricing exists, so there is no number to show.
    expect(byId.get("PRO")?.monthlyUsd).toBeNull();
    expect(byId.get("MAX")?.monthlyUsd).toBeNull();
    // And never the job seeker's prices, which are a different product.
    // Checked against the COPY, not the component: a class like `text-[12px]`
    // is not a price claim and would make this assertion meaningless.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const copy = JSON.stringify(dictionary.recruiterPlans);
      expect(copy, locale).not.toMatch(/\$7\b|\$12\b|9,900|16,900/);
    }
  });

  it("marks both future tiers as planned", () => {
    const planned = RECRUITER_TIERS.filter((t) => t.availability === "planned");
    expect(planned.map((t) => t.id)).toEqual(["PRO", "MAX"]);
    expect(view).toContain("copy.comingSoon");
  });

  it("offers no way to buy anything", () => {
    // No checkout action, no billing read, no payment component is imported.
    expect(view).not.toMatch(
      /createCheckoutAction|devSwitchPlanAction|getBillingSummary|PlansWorkspace|DemoCheckoutModal/,
    );
    expect(view).not.toMatch(/redirectUrl|toss|checkout/i);
    // The only control is disabled.
    expect(view).toContain("disabled");
    expect(view).not.toMatch(/onClick=\{/);
  });

  it("shares no code with the candidate billing surface", () => {
    const candidate = code("components/plan/CandidatePlansView.tsx");
    expect(candidate).toContain("PlansWorkspace");
    expect(candidate).toContain("requirePersonalWorkspace()");
    // The job seeker's page still reads live billing; the preview never does.
    expect(candidate).toContain("api.getBillingSummary()");
  });

  it("states unavailability before the feature lists", () => {
    expect(view.indexOf("copy.previewNotice")).toBeLessThan(
      view.indexOf("RECRUITER_TIERS.map"),
    );
  });
});

describe("planned sources are never claimed as integrations", () => {
  const view = code("components/plan/RecruiterPlansPreview.tsx");
  const model = code("lib/plans/recruiter-preview.ts");

  it("names the three sources as data, with no connected state", () => {
    expect([...PLANNED_SOURCING_SOURCES]).toEqual([
      "LinkedIn",
      "Saramin",
      "JobKorea",
    ]);
    // The type cannot express "connected", so no edit can quietly claim it.
    expect(model).not.toMatch(/connected|integrated|enabled: true/i);
  });

  it("labels every chip planned and says none is connected", () => {
    expect(view).toContain("d.recruiterPlans.planned");
    expect(view).toContain("copy.sourcesNote");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.recruiterPlans.planned, locale).toBeTruthy();
      expect(dictionary.recruiterPlans.sourcing.sourcesNote, locale).toBeTruthy();
    }
  });

  it("uses no logo assets for any source", () => {
    expect(view).not.toMatch(/\.svg|\.png|<img|next\/image/);
  });

  it("never says a planned source is live in any locale", () => {
    const forbidden = [
      /\bintegrated\b/i,
      /\bconnected\b/i,
      /\bsearch now\b/i,
      /\bavailable now\b/i,
      /\bis live\b/i,
    ];
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const copy = JSON.stringify(dictionary.recruiterPlans);
      for (const pattern of forbidden) {
        expect(copy, `${locale} ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("promises no release date", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const copy = JSON.stringify(dictionary.recruiterPlans);
      expect(copy, locale).not.toMatch(/20\d\d|Q[1-4]\b/);
    }
  });
});

describe("one /plans route, two products", () => {
  const page = code("app/(settings)/plans/page.tsx");

  it("branches on the account type the session states", () => {
    expect(page).toContain("requireSession()");
    expect(page).toContain('session.accountType === "CANDIDATE"');
    expect(page).toContain("CandidatePlansView");
    expect(page).toContain("RecruiterPlansPreview");
  });

  it("leaves no duplicate route behind", () => {
    expect(existsSync(join(ROOT, "app/(candidate)/plans/page.tsx"))).toBe(false);
    // The candidate's server actions stay where they were.
    expect(existsSync(join(ROOT, "app/(candidate)/plans/actions.ts"))).toBe(true);
  });

  it("is reachable by both account types", () => {
    expect(isRouteAllowedForAccountType("/plans", "CANDIDATE")).toBe(true);
    expect(isRouteAllowedForAccountType("/plans", "ORGANIZATION")).toBe(true);
  });
});

describe("recruiter shell", () => {
  it("keeps every existing route and adds only Plans", () => {
    const hrefs = ORGANIZATION_NAV.map((item) => item.href);
    expect(hrefs).toEqual([
      "/dashboard",
      "/vacancies",
      "/candidates",
      "/interview-chats",
      "/search",
      "/compare",
      "/processing",
    ]);
    expect(ORGANIZATION_SECONDARY_NAV.map((item) => item.href)).toEqual([
      "/plans",
      "/settings",
    ]);
  });

  it("groups the recruiter nav into named areas", () => {
    const groups = groupNavItems(ORGANIZATION_NAV);
    expect(groups.map((group) => group.labelKey)).toEqual([
      "sectionWorkspace",
      "sectionHiring",
      "sectionAiTools",
    ]);
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.nav.sectionHiring, locale).toBeTruthy();
      expect(dictionary.nav.sectionAiTools, locale).toBeTruthy();
    }
  });

  it("shares one theme system with the job-seeker side", () => {
    const header = code("components/layout/Header.tsx");
    expect(header).toContain("<ThemeToggle />");
    // One header serves both sides, so there is only one preference.
    expect(code("components/layout/AppShell.tsx")).toContain("<Header");
  });
});

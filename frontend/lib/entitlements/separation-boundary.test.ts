import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSONAL_NAV, groupNavItems } from "@/lib/workspace/navigation";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { CANDIDATE_PLANS, PLAN_CAPABILITIES } from "@/lib/entitlements/plan";

/**
 * The structural half of the internal/external separation.
 *
 * Three of the rules in this task cannot be checked by testing a pure
 * function, because breaking each one looks like a tidy-up:
 *
 *   1. Fetching protected results and then rendering a paywall over them.
 *      Cheaper to write than gating first, indistinguishable on screen, and
 *      it spends a backend's ranking pass on output nobody may read.
 *   2. Blending the two universes into one ranked list. One list is simpler
 *      than two — and it would need a single Apply button over two different
 *      promises, so half its rows would lie about what pressing it does.
 *   3. Scattering `plan === "MAX"` through components. Each one is a line;
 *      together they are a pricing model nobody can find or change.
 *
 * So these read the source. Blunt on purpose: a failure sends the next
 * reviewer here to read why.
 */

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function code(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* -------------------------------------------------------------------------- */

const GATED_PAGES = [
  {
    page: "app/(candidate)/external-jobs/page.tsx",
    gate: "canUseExternalAiJobs",
    call: "api.searchExternalJobs",
  },
  {
    page: "app/(candidate)/external-jobs/saved/page.tsx",
    gate: "canUseExternalAiJobs",
    call: "api.getSavedExternalJobs",
  },
  {
    page: "app/(candidate)/external-jobs/applications/page.tsx",
    gate: "canUseExternalAiJobs",
    call: "api.getExternalApplications",
  },
];

describe("a locked reader never causes a protected fetch", () => {
  it.each(GATED_PAGES)("$page gates before it calls $call", ({ page, gate, call }) => {
    const source = code(page);
    const gateAt = source.indexOf(`!workspace.entitlements.${gate}`);
    const callAt = source.indexOf(call);

    expect(gateAt, `${page} has no plan gate`).toBeGreaterThan(-1);
    expect(callAt, `${page} no longer calls ${call}`).toBeGreaterThan(-1);
    // Ordering is the whole guarantee: a gate after the call is "fetch and
    // hide", which is exactly what this test exists to prevent.
    expect(gateAt).toBeLessThan(callAt);
  });

  it("the internal AI page renders the paywall INSTEAD of the workspace", () => {
    const source = code("app/(candidate)/job-matches/page.tsx");
    const gateAt = source.indexOf("!workspace.entitlements.canUseInternalAiJobs");
    const workspaceAt = source.indexOf("<JobMatchWorkspace");

    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(workspaceAt);
    // The locked branch returns, so the matching component is never mounted
    // and its explicit "find matches" call cannot be made.
    expect(source.slice(gateAt, workspaceAt)).toContain("PlanLockedPage");
  });

  it("every gated page reaches the same paywall on a backend 403", () => {
    for (const { page } of GATED_PAGES) {
      expect(code(page), page).toContain("planUpgradeFrom");
      expect(code(page), page).toContain("PlanLockedPage");
    }
  });
});

describe("the internal AI 403 is a paywall, not an error", () => {
  it("the action maps a plan refusal to its own reason", () => {
    // The session carries no plan today, so for internal AI search this 403 is
    // the ONLY signal the frontend gets. Letting it fall into the generic
    // branch would show "Something went wrong" beside a Retry button that can
    // never succeed.
    const action = code("app/(candidate)/actions.ts");
    const mapAt = action.indexOf("isPlanUpgradeError(error)");
    const genericAt = action.indexOf('return { ok: false, reason: "error" };', mapAt);

    expect(mapAt).toBeGreaterThan(-1);
    expect(action).toContain('reason: "plan_required"');
    expect(mapAt).toBeLessThan(genericAt);
  });

  it("the workspace renders the paywall before any retry branch", () => {
    const workspace = code("components/candidate/JobMatchWorkspace.tsx");
    const planAt = workspace.indexOf('reason === "plan_required"');
    expect(planAt).toBeGreaterThan(-1);
    expect(workspace.indexOf("PlanLockedCard")).toBeGreaterThan(-1);
    // Every other branch offers a retry; this one must come first and return.
    expect(planAt).toBeLessThan(workspace.indexOf('reason === "unavailable"'));
    // And it must not itself offer one.
    const branch = workspace.slice(planAt, workspace.indexOf('reason === "unavailable"'));
    expect(branch).not.toContain("onRetry");
  });
});

/* -------------------------------------------------------------------------- */

describe("the two universes are never blended", () => {
  it("the AI tab strip points at two different routes", () => {
    const source = code("components/candidate/AiJobSearchTabs.tsx");
    expect(source).toContain('href: "/job-matches"');
    expect(source).toContain('href: "/external-jobs"');
  });

  it("no external component reaches the internal job-match service", () => {
    for (const file of [
      "components/external/ExternalJobsWorkspace.tsx",
      "components/external/SavedExternalJobsView.tsx",
      "components/external/ExternalApplicationsView.tsx",
      "components/external/ExternalJobCard.tsx",
    ]) {
      const source = code(file);
      expect(source, file).not.toMatch(/job-match/i);
      expect(source, file).not.toMatch(/getJobMatches|matchJobs/);
    }
  });

  it("the internal match surface reaches nothing external", () => {
    for (const file of [
      "components/candidate/JobMatchWorkspace.tsx",
      "components/candidate/MatchCard.tsx",
    ]) {
      const source = code(file);
      expect(source, file).not.toMatch(/external-jobs/);
      expect(source, file).not.toMatch(/ExternalJob/);
    }
  });

  it("the internal page renders no external results and vice versa", () => {
    const internal = code("app/(candidate)/job-matches/page.tsx");
    expect(internal).not.toContain("searchExternalJobs");
    expect(internal).toContain('universe="internal"');

    const external = code("app/(candidate)/external-jobs/page.tsx");
    expect(external).not.toMatch(/getJobMatches|matchJobs/);
    expect(external).toContain('universe="external"');
  });
});

/* -------------------------------------------------------------------------- */

describe("plan checks live in one place", () => {
  const SURFACES = [
    "components/candidate/AiJobSearchTabs.tsx",
    "components/candidate/JobUniverseNote.tsx",
    "components/external/ExternalJobsWorkspace.tsx",
    "components/external/SavedExternalJobsView.tsx",
    "components/external/ExternalApplicationsView.tsx",
    "components/layout/Sidebar.tsx",
    "components/plan/PlanBadge.tsx",
    "components/plan/PlanLockedCard.tsx",
    "app/(candidate)/external-jobs/page.tsx",
    "app/(candidate)/external-jobs/saved/page.tsx",
    "app/(candidate)/external-jobs/applications/page.tsx",
    "app/(candidate)/job-matches/page.tsx",
    "app/(candidate)/plans/page.tsx",
  ];

  it.each(SURFACES)("%s compares no plan to a literal", (file) => {
    const source = code(file);
    for (const plan of CANDIDATE_PLANS) {
      // `plan === "MAX"` anywhere but the entitlement module is a second
      // pricing model, and the two will disagree the first time either moves.
      expect(source, `${file} hard-codes ${plan}`).not.toMatch(
        new RegExp(`[=!]==\\s*["']${plan}["']`),
      );
    }
  });

  it("never reads a plan from a client-controlled store", () => {
    for (const file of SURFACES) {
      const source = code(file);
      expect(source, file).not.toMatch(/localStorage|sessionStorage/);
    }
    // Nor does the resolver itself — it takes what the backend said, only.
    expect(code("lib/entitlements/plan.ts")).not.toMatch(
      /localStorage|sessionStorage|document\.cookie|searchParams/,
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("navigation keeps the product legible", () => {
  it("puts the two AI searches adjacent, under their own heading", () => {
    const groups = groupNavItems(PERSONAL_NAV);
    const ai = groups.find((group) => group.labelKey === "sectionAiJobSearch");

    expect(ai?.items.map((item) => item.href)).toEqual([
      "/job-matches",
      "/external-jobs",
    ]);
    // Normal job search is NOT in that group: it is not AI and it is not
    // gated, and filing it there would imply both.
    expect(groups[0].items.map((item) => item.href)).toEqual(["/jobs"]);
  });

  it("marks each AI entry with the capability it needs, and /jobs with none", () => {
    const byHref = new Map(PERSONAL_NAV.map((item) => [item.href, item]));
    expect(byHref.get("/job-matches")?.capability).toBe("INTERNAL_AI_SEARCH");
    expect(byHref.get("/external-jobs")?.capability).toBe("EXTERNAL_AI_SEARCH");
    // Ordinary job search stays available on every plan, so it carries no
    // capability at all rather than one that happens to be granted.
    expect(byHref.get("/jobs")?.capability).toBeUndefined();
  });

  it("keeps the internal and external record lists apart", () => {
    const hrefs = PERSONAL_NAV.map((item) => item.href);
    // `/my-applications` is the internal history; the external tracker lives
    // under `/external-jobs/applications` and is reached from that strip.
    expect(hrefs).toContain("/my-applications");
    expect(hrefs).not.toContain("/external-jobs/applications");
    expect(code("components/external/ExternalJobsTabs.tsx")).not.toContain(
      '"/my-applications"',
    );
    expect(code("components/external/ExternalJobsTabs.tsx")).not.toContain(
      '"/saved-jobs"',
    );
  });

  it("still offers a locked entry as a real link", () => {
    // Hiding it would make a purchasable feature invisible to the person who
    // might buy it; disabling it would swallow the click without explaining.
    const sidebar = code("components/layout/Sidebar.tsx");
    expect(sidebar).toContain("<Link");
    expect(sidebar).not.toMatch(/locked\s*\?\s*null/);
    expect(sidebar).not.toMatch(/disabled=\{locked/);
  });
});

/* -------------------------------------------------------------------------- */

describe("every new string exists in all four locales", () => {
  it("names all three plans", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const plan of CANDIDATE_PLANS) {
        expect(dictionary.plans.names[plan], `${locale}.plans.names.${plan}`).toBeTruthy();
      }
    }
  });

  it("describes every gated capability", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const capability of PLAN_CAPABILITIES) {
        const copy = dictionary.plans.locked[capability];
        expect(copy.title, `${locale}.${capability}.title`).toBeTruthy();
        expect(copy.description, `${locale}.${capability}.description`).toBeTruthy();
      }
    }
  });

  it("keeps the placeholders a template needs", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      // A locale that drops `{plan}` renders "Upgrade to" and leaves the
      // reader guessing which plan — the one fact the sentence exists for.
      expect(dictionary.plans.availableOn, locale).toContain("{plan}");
      expect(dictionary.plans.upgradeTo, locale).toContain("{plan}");
      expect(dictionary.plans.currentPlanIs, locale).toContain("{plan}");
      expect(dictionary.plans.priceMonthly, locale).toContain("{amount}");
      expect(dictionary.aiJobSearch.lockedTabLabel, locale).toContain("{tab}");
      expect(dictionary.aiJobSearch.lockedTabLabel, locale).toContain("{plan}");
    }
  });

  it("names both sources and says what applying to each one means", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const universe of ["internal", "external"] as const) {
        const copy = dictionary.aiJobSearch[universe];
        expect(copy.sourceName, `${locale}.${universe}.sourceName`).toBeTruthy();
        expect(copy.applyMeaning, `${locale}.${universe}.applyMeaning`).toBeTruthy();
      }
      // The two must not read identically, or the distinction the whole task
      // is about disappears in that locale.
      expect(dictionary.aiJobSearch.internal.sourceName, locale).not.toBe(
        dictionary.aiJobSearch.external.sourceName,
      );
      expect(dictionary.aiJobSearch.internal.applyMeaning, locale).not.toBe(
        dictionary.aiJobSearch.external.applyMeaning,
      );
    }
  });

  it("lists features on every plan card", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const plan of CANDIDATE_PLANS) {
        const card = dictionary.plans.cards[plan];
        expect(card.tagline, `${locale}.${plan}.tagline`).toBeTruthy();
        expect(card.features.length, `${locale}.${plan}.features`).toBeGreaterThan(0);
        for (const feature of card.features) expect(feature).toBeTruthy();
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the tab strip is usable by keyboard and on a narrow screen", () => {
  const tabs = code("components/candidate/AiJobSearchTabs.tsx");

  it("uses real links, so focus and Enter work without a handler", () => {
    expect(tabs).toContain("<Link");
    expect(tabs).not.toMatch(/onKeyDown|onClick|role="tab"/);
  });

  it("carries the position for a screen reader, not just a tint", () => {
    expect(tabs).toContain('aria-current="page"');
    expect(tabs).toContain("aria-label");
  });

  it("says the plan in words as well as in a badge", () => {
    // Colour alone must never be the message: the locked tab has a lock glyph
    // and an accessible name that spells out the plan.
    expect(tabs).toContain("lockedTabLabel");
    expect(tabs).toContain("LockIcon");
  });

  it("scrolls sideways rather than wrapping at 320px", () => {
    expect(tabs).toContain("overflow-x-auto");
    expect(tabs).toContain("whitespace-nowrap");
  });

  it("keeps a visible focus ring", () => {
    expect(tabs).toContain("focus-visible:");
  });
});

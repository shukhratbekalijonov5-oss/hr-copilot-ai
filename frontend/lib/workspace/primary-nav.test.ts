import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_TABS,
  CANDIDATE_SECTIONS,
  RECRUITER_TABS,
  RECRUITER_SECTIONS,
  activeNavTab,
  pageTitleFor,
  navSectionsFor,
  primaryTabsFor,
} from "@/lib/workspace/primary-nav";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import en from "@/lib/i18n/dictionaries/en";
import type { OrganizationWorkspace, PersonalWorkspace } from "@/lib/workspace/types";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const personal: PersonalWorkspace = { kind: "personal", id: "personal", name: "Aziza" };
const org: OrganizationWorkspace = {
  kind: "organization",
  id: "o",
  name: "Northwind",
  slug: "nw",
  role: "OWNER",
};

describe("candidate primary navigation", () => {
  it("is exactly Home / Career / AI Search / Chats / More", () => {
    expect(CANDIDATE_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "career",
      "aiSearch",
      "chats",
      "more",
    ]);
    expect(primaryTabsFor(personal)).toBe(CANDIDATE_TABS);
  });

  it("uses the short tab words, not the longer page titles", () => {
    const labels = CANDIDATE_TABS.map((tab) => en.nav[tab.labelKey]);
    expect(labels).toEqual(["Home", "Career", "AI Search", "Chats", "More"]);

    const hr = RECRUITER_TABS.map((tab) => en.nav[tab.labelKey]);
    expect(hr).toEqual(["Home", "Hiring", "AI Search", "Chats", "More"]);
  });

  it("routes Home and Chats directly, and opens sheets for the rest", () => {
    const byId = new Map(CANDIDATE_TABS.map((tab) => [tab.id, tab]));
    expect(byId.get("home")?.href).toBe("/home");
    // Chats is a direct destination, not a sheet — it is one page.
    expect(byId.get("chats")?.href).toBe("/my-interview-chats");
    for (const id of ["career", "aiSearch", "more"]) {
      expect(byId.get(id)?.href, id).toBeUndefined();
      expect(byId.get(id)?.section, id).toBeTruthy();
    }
  });

  it("puts the three career pages behind the Career sheet", () => {
    expect(CANDIDATE_SECTIONS.career.map((link) => link.href)).toEqual([
      "/jobs",
      "/saved-jobs",
      "/my-applications",
    ]);
  });

  it("puts both AI universes behind the AI Search sheet, with their plans", () => {
    expect(CANDIDATE_SECTIONS.aiSearch.map((link) => link.href)).toEqual([
      "/job-matches",
      "/external-jobs",
    ]);
    expect(CANDIDATE_SECTIONS.aiSearch.map((link) => link.capability)).toEqual([
      "INTERNAL_AI_SEARCH",
      "EXTERNAL_AI_SEARCH",
    ]);
  });

  it("puts profile, preferences, plans, settings and notifications under More", () => {
    const more = CANDIDATE_SECTIONS.more;
    expect(more.map((link) => link.href)).toEqual([
      "/my-profile",
      "/job-preferences",
      "/plans",
      "/settings",
      // Notifications has no page on the web; it opens the bell instead.
      undefined,
    ]);
    expect(more.at(-1)?.opensNotifications).toBe(true);
  });

  it("never offers a recruiting destination", () => {
    const hrefs = [
      ...CANDIDATE_TABS.map((tab) => tab.href),
      ...Object.values(CANDIDATE_SECTIONS).flatMap((links) =>
        links.map((link) => link.href),
      ),
    ].filter(Boolean);

    for (const forbidden of ["/vacancies", "/candidates", "/compare", "/dashboard"]) {
      expect(hrefs, forbidden).not.toContain(forbidden);
    }
  });
});

describe("recruiter primary navigation", () => {
  it("is exactly Home / Hiring / AI Search / Chats / More", () => {
    expect(RECRUITER_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "hiring",
      "aiSearch",
      "chats",
      "more",
    ]);
    expect(navSectionsFor(org)).toBe(RECRUITER_SECTIONS);
  });

  it("puts vacancies, candidates and compare behind the Hiring sheet", () => {
    expect(RECRUITER_SECTIONS.hiring.map((link) => link.href)).toEqual([
      "/vacancies",
      "/candidates",
      "/compare",
    ]);
  });

  it("never makes candidate detail a tab", () => {
    const hrefs = [
      ...RECRUITER_TABS.map((tab) => tab.href),
      ...Object.values(RECRUITER_SECTIONS).flatMap((links) =>
        links.map((link) => link.href),
      ),
    ];
    // Detail is reached from the candidates list, never from the bar.
    expect(hrefs.some((href) => href?.includes("/candidates/"))).toBe(false);
  });

  it("marks external candidate search as coming soon, not as a feature", () => {
    const external = RECRUITER_SECTIONS.aiSearch.at(-1);
    expect(external?.comingSoon).toBe(true);
    // No route exists, so it points at the plans page where the roadmap is.
    expect(external?.href).toBe("/plans");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.primaryNav.comingSoon, locale).toBeTruthy();
    }
  });

  it("routes Chats to the recruiter conversation list", () => {
    const chats = RECRUITER_TABS.find((tab) => tab.id === "chats");
    expect(chats?.href).toBe("/interview-chats");
  });
});

describe("route-aware active tab", () => {
  it("lights Career for all three of its pages", () => {
    for (const path of ["/jobs", "/saved-jobs", "/my-applications"]) {
      expect(activeNavTab(CANDIDATE_TABS, path), path).toBe("career");
    }
  });

  it("lights AI Search for both universes, including nested routes", () => {
    expect(activeNavTab(CANDIDATE_TABS, "/job-matches")).toBe("aiSearch");
    expect(activeNavTab(CANDIDATE_TABS, "/external-jobs/saved")).toBe(
      "aiSearch",
    );
  });

  it("lights More for the account pages", () => {
    for (const path of ["/my-profile", "/job-preferences", "/plans", "/settings"]) {
      expect(activeNavTab(CANDIDATE_TABS, path), path).toBe("more");
    }
  });

  it("lights Hiring for the recruiter's hiring pages, detail included", () => {
    for (const path of ["/vacancies", "/candidates", "/candidates/abc", "/compare"]) {
      expect(activeNavTab(RECRUITER_TABS, path), path).toBe("hiring");
    }
  });

  it("does not let a shorter route capture a longer one", () => {
    // `/jobs` must not claim `/job-matches`, which belongs to AI Search.
    expect(activeNavTab(CANDIDATE_TABS, "/job-matches")).not.toBe("career");
    expect(activeNavTab(CANDIDATE_TABS, "/job-preferences")).toBe("more");
  });

  it("returns null for a route outside the bar", () => {
    expect(activeNavTab(CANDIDATE_TABS, "/workspaces")).toBeNull();
  });
});

describe("mobile page title", () => {
  it("names the current page, not the tab that opened it", () => {
    expect(pageTitleFor("/saved-jobs", en)).toBe(en.savedJobs.title);
    expect(pageTitleFor("/my-applications", en)).toBe(en.applications.title);
    expect(pageTitleFor("/vacancies", en)).toBe(en.vacancies.title);
    expect(pageTitleFor("/compare", en)).toBe(en.compare.title);
  });

  it("resolves the longer route first", () => {
    expect(pageTitleFor("/job-matches", en)).toBe(en.jobMatch.title);
    expect(pageTitleFor("/job-preferences", en)).toBe(en.jobPreferences.title);
    expect(pageTitleFor("/external-jobs/saved", en)).toBe(
      en.externalJobs.savedTitle,
    );
  });

  it("resolves a non-empty title in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const path of ["/home", "/dashboard", "/vacancies", "/saved-jobs"]) {
        expect(pageTitleFor(path, dictionary), `${locale} ${path}`).toBeTruthy();
      }
    }
  });
});

describe("breakpoint split", () => {
  const shell = code("components/layout/AppShell.tsx");

  it("mounts the top bar only on desktop and the bottom bar only on mobile", () => {
    expect(code("components/layout/TopNav.tsx")).toContain("hidden");
    expect(code("components/layout/TopNav.tsx")).toContain("lg:flex");
    expect(code("components/layout/BottomNav.tsx")).toContain("lg:hidden");
  });

  it("has no mobile drawer or hamburger left", () => {
    // Primary navigation on a phone is the bar, not a hidden desktop rail.
    expect(shell).not.toContain("sidebarOpen");
    expect(shell).not.toContain("onOpenSidebar");
    expect(code("components/layout/Header.tsx")).not.toContain("MenuIcon");
  });

  it("leaves room so the fixed bar never covers content", () => {
    expect(shell).toContain("pb-24");
    expect(shell).toContain("lg:pb-10");
  });

  it("respects the safe-area inset on both the bar and the sheet", () => {
    expect(code("components/layout/BottomNav.tsx")).toContain(
      "pb-[env(safe-area-inset-bottom)]",
    );
    expect(code("components/layout/MobileSheet.tsx")).toContain(
      "pb-[env(safe-area-inset-bottom)]",
    );
  });

  it("shows the page title on mobile and the navigation on desktop", () => {
    const header = code("components/layout/Header.tsx");
    expect(header).toContain("pageTitleFor(pathname, d)");
    expect(header).toContain("lg:hidden");
    expect(header).toContain("<TopNav");
  });
});

describe("bottom nav and sheet affordances", () => {
  const bar = code("components/layout/BottomNav.tsx");
  const sheet = code("components/layout/MobileSheet.tsx");

  it("marks the active tab for assistive tech, not by colour alone", () => {
    // BOTH kinds of tab: the sheet triggers are buttons, and three of the
    // five tabs are sheet triggers.
    expect(
      bar.match(/aria-current=\{selected \? "page" : undefined\}/g),
    ).toHaveLength(2);
    expect(bar).toContain("selected && \"bg-brand-soft\"");
  });

  it("announces the sheet triggers as dialog openers", () => {
    expect(bar).toContain('aria-haspopup="dialog"');
    expect(bar).toContain("aria-expanded={openSheet === tab.section}");
    expect(bar).toContain("aria-label={d.primaryNav.label}");
  });

  it("keeps every target comfortably tappable", () => {
    expect(bar).toContain("min-h-[56px]");
    expect(sheet).toContain("min-h-[56px]");
  });

  it("closes the sheet by backdrop, Escape and a labelled button", () => {
    expect(sheet).toContain('event.key === "Escape"');
    expect(sheet).toContain("aria-label={d.primaryNav.close}");
    expect(sheet).toContain('role="dialog"');
    expect(sheet).toContain('aria-modal="true"');
  });

  it("moves focus into the sheet and returns it on close", () => {
    expect(sheet).toContain("panelRef.current?.focus()");
    expect(sheet).toContain("openerRef.current?.focus?.()");
  });
});

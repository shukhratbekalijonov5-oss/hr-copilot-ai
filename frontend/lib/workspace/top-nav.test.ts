import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_SECTIONS,
  CANDIDATE_TABS,
  RECRUITER_SECTIONS,
  RECRUITER_TABS,
  activeNavTab,
  navSectionsFor,
  primaryTabsFor,
} from "@/lib/workspace/primary-nav";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import en from "@/lib/i18n/dictionaries/en";
import type { OrganizationWorkspace, PersonalWorkspace } from "@/lib/workspace/types";

/**
 * The desktop top navigation.
 *
 * These tests exist because the bar's correctness is mostly structural: which
 * areas exist, where they lead, what lights up, and what is NOT in the tree
 * any more. Every assertion here is about the source or the shared model, so
 * none of them needs a DOM — what they cannot see is spacing and colour,
 * which is what the browser pass is for.
 */

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

const topNav = code("components/layout/TopNav.tsx");
const menu = code("components/layout/TopNavMenu.tsx");
const header = code("components/layout/Header.tsx");
const shell = code("components/layout/AppShell.tsx");

/* -------------------------------------------------------------------------- */

describe("the top bar renders the shared model", () => {
  it("renders for a candidate and for a recruiter from one component", () => {
    // Not two bars with two definitions: one component, handed a workspace.
    expect(topNav).toContain("primaryTabsFor(workspace)");
    expect(topNav).toContain("navSectionsFor(workspace)");
    expect(header).toContain("<TopNav");
    expect(header).toContain("workspace={workspace.active}");
  });

  it("gives the candidate exactly five areas", () => {
    expect(primaryTabsFor(personal)).toHaveLength(5);
    expect(CANDIDATE_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Career",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("gives the recruiter exactly five areas", () => {
    expect(primaryTabsFor(org)).toHaveLength(5);
    expect(RECRUITER_TABS.map((tab) => en.nav[tab.labelKey])).toEqual([
      "Home",
      "Hiring",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("is the same model the bottom bar renders, not a copy of it", () => {
    const bottom = code("components/layout/BottomNav.tsx");
    for (const source of [topNav, bottom]) {
      expect(source).toContain("@/lib/workspace/primary-nav");
      expect(source).toContain("activeNavTab");
    }
    // A second hard-coded list is exactly how the two bars would drift apart.
    for (const route of ["/saved-jobs", "/job-matches", "/vacancies"]) {
      expect(topNav, route).not.toContain(`"${route}"`);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("what each area opens", () => {
  it("routes Home and Chats directly on both sides", () => {
    const candidate = new Map(CANDIDATE_TABS.map((tab) => [tab.id, tab]));
    expect(candidate.get("home")?.href).toBe("/home");
    expect(candidate.get("chats")?.href).toBe("/my-interview-chats");
    expect(candidate.get("chats")?.section).toBeUndefined();

    const recruiter = new Map(RECRUITER_TABS.map((tab) => [tab.id, tab]));
    expect(recruiter.get("home")?.href).toBe("/dashboard");
    expect(recruiter.get("chats")?.href).toBe("/interview-chats");
    // One page behind it, so a dropdown would be a menu with a single row.
    expect(recruiter.get("chats")?.section).toBeUndefined();
  });

  it("opens Career on the three real career routes", () => {
    expect(navSectionsFor(personal).career.map((link) => link.href)).toEqual([
      "/jobs",
      "/saved-jobs",
      "/my-applications",
    ]);
    // Career itself is a menu, never a landing page invented to hold links.
    expect(CANDIDATE_TABS.find((tab) => tab.id === "career")?.href).toBeUndefined();
  });

  it("opens Hiring on vacancies, candidates and compare", () => {
    expect(navSectionsFor(org).hiring.map((link) => link.href)).toEqual([
      "/vacancies",
      "/candidates",
      "/compare",
    ]);
    // Candidate detail is reached from the list, never from the bar.
    const hrefs = [
      ...RECRUITER_TABS.map((tab) => tab.href),
      ...Object.values(RECRUITER_SECTIONS).flatMap((links) =>
        links.map((link) => link.href),
      ),
    ];
    expect(hrefs.some((href) => href?.includes("/candidates/"))).toBe(false);
  });

  it("opens AI Search on both universes, each wearing the plan it needs", () => {
    const ai = navSectionsFor(personal).aiSearch;
    expect(ai.map((link) => link.href)).toEqual(["/job-matches", "/external-jobs"]);
    expect(ai.map((link) => link.capability)).toEqual([
      "INTERNAL_AI_SEARCH",
      "EXTERNAL_AI_SEARCH",
    ]);
    // The badge is presentation. The backend is the entitlement authority,
    // so the menu must never decide access for itself.
    expect(menu).toContain("requiredPlanFor(link.capability)");
    expect(menu).not.toMatch(/localStorage|sessionStorage/);
  });

  it("keeps recruiter external sourcing marked as a future feature", () => {
    const external = RECRUITER_SECTIONS.aiSearch.at(-1);
    expect(external?.comingSoon).toBe(true);
    expect(menu).toContain("d.primaryNav.comingSoon");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.primaryNav.comingSoon, locale).toBeTruthy();
    }
  });

  it("opens More on the account pages, notifications included", () => {
    expect(CANDIDATE_SECTIONS.more.map((link) => link.href)).toEqual([
      "/my-profile",
      "/job-preferences",
      "/plans",
      "/settings",
      // The web has no notifications page; this row opens the bell.
      undefined,
    ]);
    expect(RECRUITER_SECTIONS.more.map((link) => link.href)).toEqual([
      "/plans",
      "/settings",
      undefined,
    ]);
    expect(menu).toContain("openNotifications()");
  });

  it("gives every menu row a description, in all four locales", () => {
    const rows = [
      ...Object.values(CANDIDATE_SECTIONS).flat(),
      ...Object.values(RECRUITER_SECTIONS).flat(),
    ];
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const row of rows) {
        expect(
          dictionary.primaryNav.hints[row.hintKey],
          `${locale}.${row.hintKey}`,
        ).toBeTruthy();
      }
    }
    expect(menu).toContain("d.primaryNav.hints[link.hintKey]");
  });
});

/* -------------------------------------------------------------------------- */

describe("route-aware active area", () => {
  it("lights the parent area for every child route", () => {
    const cases: [string, string][] = [
      ["/home", "home"],
      ["/jobs", "career"],
      ["/saved-jobs", "career"],
      ["/my-applications", "career"],
      ["/job-matches", "aiSearch"],
      ["/external-jobs/saved", "aiSearch"],
      ["/my-interview-chats", "chats"],
      ["/my-profile", "more"],
      ["/plans", "more"],
    ];
    for (const [path, id] of cases) {
      expect(activeNavTab(CANDIDATE_TABS, path), path).toBe(id);
    }
  });

  it("lights Hiring for the recruiter's hiring pages, detail included", () => {
    for (const path of ["/vacancies", "/candidates", "/candidates/abc", "/compare"]) {
      expect(activeNavTab(RECRUITER_TABS, path), path).toBe("hiring");
    }
    expect(activeNavTab(RECRUITER_TABS, "/search")).toBe("aiSearch");
    expect(activeNavTab(RECRUITER_TABS, "/dashboard")).toBe("home");
  });

  it("marks the active area for assistive tech, on links and menus alike", () => {
    // Four of the five areas are menu buttons, so marking only links would
    // leave most of the bar with no announced state at all.
    expect(topNav).toContain('aria-current={selected ? "page" : undefined}');
    expect(menu).toContain('aria-current={active ? "page" : undefined}');
    // And not by colour alone: a 2px rule carries it structurally.
    expect(topNav).toContain('selected ? "bg-brand" : "bg-transparent"');
  });
});

/* -------------------------------------------------------------------------- */

describe("role isolation", () => {
  it("never offers a recruiting destination to a candidate", () => {
    const hrefs = [
      ...CANDIDATE_TABS.map((tab) => tab.href),
      ...Object.values(CANDIDATE_SECTIONS).flatMap((links) =>
        links.map((link) => link.href),
      ),
    ].filter(Boolean);

    for (const forbidden of ["/vacancies", "/candidates", "/compare", "/dashboard", "/search"]) {
      expect(hrefs, forbidden).not.toContain(forbidden);
    }
  });

  it("never offers a job-seeker destination to a recruiter", () => {
    const hrefs = [
      ...RECRUITER_TABS.map((tab) => tab.href),
      ...Object.values(RECRUITER_SECTIONS).flatMap((links) =>
        links.map((link) => link.href),
      ),
    ].filter(Boolean);

    for (const forbidden of ["/home", "/jobs", "/saved-jobs", "/my-profile", "/job-matches"]) {
      expect(hrefs, forbidden).not.toContain(forbidden);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("keyboard and screen-reader affordances", () => {
  it("announces each menu trigger as a menu, with its state", () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain("aria-expanded={open}");
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
    expect(topNav).toContain("aria-label={d.primaryNav.label}");
  });

  it("opens on the keyboard, not on hover alone", () => {
    expect(menu).toContain('event.key === "ArrowDown"');
    expect(menu).toContain('event.key === "Enter"');
    // Hover is a shortcut layered on a real button, never the mechanism.
    expect(menu).toContain("onMouseEnter={onOpen}");
    expect(menu).toContain("<button");
    expect(menu).toContain("onClick={onToggle}");
  });

  it("closes on Escape and hands focus back to the trigger", () => {
    expect(menu).toContain('event.key === "Escape"');
    expect(menu).toContain("triggerRef.current?.focus()");
    // Tabbing out of the last row leaves it open behind the reader otherwise.
    expect(menu).toContain('event.key === "Tab"');
  });

  it("moves focus between rows with the arrow keys", () => {
    expect(menu).toContain('querySelectorAll<HTMLElement>(\'[role="menuitem"]\')');
    expect(menu).toContain("focusRow(current + 1)");
    expect(menu).toContain("focusRow(current - 1)");
  });

  it("keeps a visible focus ring on every bar item", () => {
    expect(topNav).toContain("focus-visible:ring-2");
    expect(menu).toContain("focus-visible:bg-surface-muted");
  });
});

/* -------------------------------------------------------------------------- */

describe("the desktop rail is gone", () => {
  it("has no sidebar component, module or stylesheet left", () => {
    for (const path of [
      "components/layout/Sidebar.tsx",
      "lib/ui/sidebar.ts",
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(false);
    }
    expect(readFileSync(join(ROOT, "app/globals.css"), "utf8")).not.toContain(
      "--sidebar-w",
    );
  });

  it("leaves no offset column where the rail used to be", () => {
    // A leftover `padding-left` would read as a rendering bug, not a layout.
    expect(shell).not.toContain("sidebar-offset");
    expect(shell).not.toContain("sidebar-rail");
    expect(shell).not.toContain("<Sidebar");
  });

  it("drops the boot script that sized it before paint", () => {
    const layout = code("app/layout.tsx");
    expect(layout).not.toContain("SIDEBAR_BOOT_SCRIPT");
    // The theme script stays: it is the one legitimate pre-paint difference.
    expect(layout).toContain("THEME_BOOT_SCRIPT");
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("gives the reclaimed width to the page, but caps it", () => {
    expect(shell).toContain("max-w-[1600px]");
    expect(shell).toContain("mx-auto");
    // The header shares the measure so the brand lines up with the content.
    expect(header).toContain("max-w-[1600px]");
  });
});

/* -------------------------------------------------------------------------- */

describe("every destination in the bar renders the bar", () => {
  /**
   * Walks up from a page file looking for the layout that mounts `AppShell`.
   *
   * This exists because `/plans` did not have one. It sat in a shared route
   * group whose only layout was pinned to `/settings`, so it rendered with no
   * header, no navigation and no bottom bar — survivable while nothing linked
   * to it, and a dead end the moment it became a row in the More menu.
   */
  function shellFor(href: string): string | null {
    const segments = href.split("/").filter(Boolean);
    const groups = ["(app)", "(candidate)", "(settings)"];

    for (const group of groups) {
      const page = join(ROOT, "app", group, ...segments, "page.tsx");
      if (!existsSync(page)) continue;

      // Up from the page directory to `app/`, taking the first layout found.
      const parts = [group, ...segments];
      for (let depth = parts.length; depth >= 0; depth -= 1) {
        const layout = join(ROOT, "app", ...parts.slice(0, depth), "layout.tsx");
        if (!existsSync(layout)) continue;
        return readFileSync(layout, "utf8").includes("AppShell") ? layout : null;
      }
      return null;
    }
    return null;
  }

  const destinations = [
    ...CANDIDATE_TABS,
    ...RECRUITER_TABS,
  ]
    .map((tab) => tab.href)
    .concat(
      [
        ...Object.values(CANDIDATE_SECTIONS).flat(),
        ...Object.values(RECRUITER_SECTIONS).flat(),
      ].map((link) => link.href),
    )
    .filter((href): href is string => Boolean(href));

  it.each([...new Set(destinations)])("%s keeps the navigation", (href) => {
    expect(shellFor(href), `${href} renders without AppShell`).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */

describe("mobile is untouched", () => {
  it("still navigates by the bottom bar, with no hamburger", () => {
    const bottom = code("components/layout/BottomNav.tsx");
    expect(bottom).toContain("lg:hidden");
    expect(bottom).toContain("min-h-[56px]");
    expect(shell).toContain("<BottomNav");
    expect(header).not.toContain("MenuIcon");
  });

  it("keeps the top bar off the phone and the bottom bar off the desktop", () => {
    expect(topNav).toContain("lg:flex");
    expect(code("components/layout/MobileSheet.tsx")).toContain("lg:hidden");
    // Still room for the fixed bar at the end of a scrolling page.
    expect(shell).toContain("pb-24");
  });

  it("still shows the current page's name in the phone's header", () => {
    expect(header).toContain("pageTitleFor(pathname, d)");
    expect(header).toContain("lg:hidden");
  });
});

/* -------------------------------------------------------------------------- */

describe("header utilities stay visible", () => {
  it("keeps search, language, theme, notifications and the account menu out of More", () => {
    for (const marker of [
      "openCommandPalette",
      "<LocaleSwitcher />",
      "<ThemeToggle />",
      "<NotificationBell",
      "logoutAction",
    ]) {
      expect(header, marker).toContain(marker);
    }
    // They act on wherever the reader is; they are not places to navigate to.
    const moreRows = [...CANDIDATE_SECTIONS.more, ...RECRUITER_SECTIONS.more];
    expect(moreRows.some((row) => row.labelKey === "settings")).toBe(true);
    expect(moreRows.some((row) => row.hintKey === "internalAiJobs")).toBe(false);
  });

  it("opens the existing palette rather than adding a second search", () => {
    expect(header).toContain("openCommandPalette");
    expect(header).not.toContain("useState<string>");
    expect(shell).toContain("<CommandPalette");
  });

  it("stays sticky and compact", () => {
    expect(header).toContain("sticky top-0");
    expect(header).toContain("border-b border-line");
    // 56px on a phone, 72px on a desktop.
    expect(header).toContain("h-14");
    expect(header).toContain("lg:h-[72px]");
    // A heavier blur repaints on every scroll frame for no legibility gain.
    expect(header).toContain("backdrop-blur-md");
    expect(header).not.toContain("backdrop-blur-xl");
  });
});

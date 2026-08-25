import type { Dictionary } from "@/lib/i18n/index";
import type { SheetId } from "@/stores/ui";

/**
 * The bottom navigation, for both roles.
 *
 * ## Exactly five, and the same five shapes on both sides
 *
 * Home, a domain sheet, AI Search, Chats, More. Five is the ceiling where
 * labels stay readable and targets stay thumb-sized; the desktop sidebar's
 * eleven entries are reached through the sheets instead. Chats earns a tab
 * of its own on both sides because it is the highest-frequency action —
 * Profile does not, which is why it lives under More.
 *
 * ## A tab either routes or opens a sheet, never both
 *
 * `kind` makes that explicit so the tab bar has no special cases: `route`
 * navigates, `sheet` opens the matching sheet. That is what keeps Career and
 * Hiring from needing a placeholder screen nobody ever sees.
 */
export type TabKind = "route" | "sheet";

export interface TabDefinition {
  id: string;
  kind: TabKind;
  href?: string;
  sheet?: Exclude<SheetId, null>;
  labelOf: (d: Dictionary) => string;
  icon: "home" | "briefcase" | "spark" | "message" | "more" | "users";
  /** Route fragments that should light this tab up. */
  activeFor: string[];
}

export const CANDIDATE_TABS: TabDefinition[] = [
  { id: "home", kind: "route", href: "/(candidate)/home", labelOf: (d) => d.nav.home, icon: "home", activeFor: ["/home"] },
  { id: "career", kind: "sheet", sheet: "career", labelOf: (d) => d.nav.career, icon: "briefcase", activeFor: ["/jobs", "/saved-jobs", "/applications"] },
  { id: "aiSearch", kind: "sheet", sheet: "aiSearch", labelOf: (d) => d.nav.aiSearch, icon: "spark", activeFor: ["/job-matches", "/external-jobs"] },
  { id: "chats", kind: "route", href: "/(candidate)/chats", labelOf: (d) => d.nav.chats, icon: "message", activeFor: ["/chats"] },
  { id: "more", kind: "sheet", sheet: "more", labelOf: (d) => d.nav.more, icon: "more", activeFor: ["/profile", "/plans", "/settings", "/notifications", "/job-preferences"] },
];

export const RECRUITER_TABS: TabDefinition[] = [
  { id: "home", kind: "route", href: "/(recruiter)/home", labelOf: (d) => d.nav.home, icon: "home", activeFor: ["/home"] },
  { id: "hiring", kind: "sheet", sheet: "hiring", labelOf: (d) => d.nav.hiring, icon: "users", activeFor: ["/vacancies", "/candidates", "/compare"] },
  { id: "aiSearch", kind: "sheet", sheet: "aiSearch", labelOf: (d) => d.nav.aiSearch, icon: "spark", activeFor: ["/search", "/external-search"] },
  { id: "chats", kind: "route", href: "/(recruiter)/chats", labelOf: (d) => d.nav.chats, icon: "message", activeFor: ["/chats"] },
  { id: "more", kind: "sheet", sheet: "more", labelOf: (d) => d.nav.more, icon: "more", activeFor: ["/plans", "/settings", "/notifications"] },
];

export function activeTabId(tabs: TabDefinition[], pathname: string): string | null {
  for (const tab of tabs) {
    if (tab.activeFor.some((fragment) => pathname.includes(fragment))) return tab.id;
  }
  return null;
}

/**
 * The header title for a route.
 *
 * The title must name the CURRENT page — "Saved Jobs", not a fixed "Home" —
 * so it is derived from the path rather than from the active tab, which for
 * a sheet-opened screen would say "Career" on all three of its pages.
 *
 * Order matters: `/job-matches` must not be captured by `/jobs`, and
 * `/external-search` must not be captured by `/search`, so the more specific
 * fragments are tested first.
 */
export function titleForPath(pathname: string, d: Dictionary): string {
  const map: [string, string][] = [
    ["/job-preferences", d.titles.jobPreferences],
    ["/job-matches", d.titles.internalAiJobs],
    ["/external-jobs", d.titles.externalAiJobs],
    ["/external-search", d.titles.externalAiSearch],
    ["/saved-jobs", d.titles.savedJobs],
    ["/applications", d.titles.myApplications],
    ["/notifications", d.titles.notifications],
    ["/candidates", d.titles.candidates],
    ["/vacancies", d.titles.vacancies],
    ["/compare", d.titles.compare],
    ["/settings", d.titles.settings],
    ["/profile", d.titles.myProfile],
    ["/search", d.titles.internalAiSearch],
    ["/plans", d.titles.plans],
    ["/chats", d.titles.interviewChats],
    ["/jobs", d.titles.normalJobSearch],
    ["/home", d.titles.dashboard],
  ];

  for (const [fragment, title] of map) {
    if (pathname.includes(fragment)) return title;
  }
  return d.titles.dashboard;
}

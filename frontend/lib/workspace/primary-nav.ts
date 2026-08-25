import type { ComponentType } from "react";
import {
  BellIcon,
  BookmarkIcon,
  BriefcaseIcon,
  CompareIcon,
  DashboardIcon,
  FilterIcon,
  GlobeIcon,
  LockIcon,
  MessageIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { PlanCapability } from "@/lib/entitlements/plan";
import type { Workspace } from "@/lib/workspace/types";

/**
 * The primary navigation: five areas, and the sections behind three of them.
 *
 * ## One information architecture, two bars
 *
 * The bottom bar on a phone and the top bar on a desktop render THIS list.
 * They differ in where they sit and how a section opens — a sheet from the
 * bottom edge, a dropdown under its trigger — and in nothing else. Stating
 * the areas twice would let the two drift the first time either moved, and
 * the whole point of matching them is that a reader who learns the product on
 * one device already knows it on the other.
 *
 * ## Why this is not `navigationFor` filtered down
 *
 * That list is eleven flat entries under five headings, which is a shape that
 * only ever worked in a tall rail. Five is the ceiling for a bottom bar with
 * readable labels and thumb-sized targets, and it is also about the ceiling
 * for a horizontal bar that must not wrap. So the headings became the areas
 * and their contents moved one level down. `navigationFor` is still the
 * definition the command palette and the route guards read; this is the same
 * routes, arranged for a bar rather than a column.
 *
 * ## An area either routes or opens a section — never both
 *
 * Home and Chats are single pages, so they are links. Career, Hiring, AI
 * Search and More hold several, so they open. Keeping that a property rather
 * than a special case is what lets Career avoid a placeholder landing page
 * whose only content would be the links already in the menu.
 */
export type NavSectionId = "career" | "hiring" | "aiSearch" | "more";

export interface NavSectionLink {
  /** `href` navigates. Omitted for the one row that opens the bell instead. */
  href?: string;
  labelKey: keyof Dictionary["nav"];
  hintKey: keyof Dictionary["primaryNav"]["hints"];
  icon: ComponentType<IconProps>;
  /** Draws the plan badge when the account lacks it. Presentation only. */
  capability?: PlanCapability;
  /** Marks a destination that describes a future feature, not a working one. */
  comingSoon?: boolean;
  /** Opens the header's notification dropdown; the web has no such route. */
  opensNotifications?: boolean;
}

export interface NavTab {
  id: string;
  labelKey: keyof Dictionary["nav"];
  icon: ComponentType<IconProps>;
  /** Present when the tab navigates. */
  href?: string;
  /** Present when the area opens a section — a sheet on mobile, a menu on desktop. */
  section?: NavSectionId;
  /** Route fragments that light this tab up. */
  activeFor: string[];
}

export const CANDIDATE_TABS: NavTab[] = [
  { id: "home", labelKey: "sectionHome", icon: DashboardIcon, href: "/home", activeFor: ["/home"] },
  {
    id: "career",
    labelKey: "sectionCareer",
    icon: BriefcaseIcon,
    section: "career",
    activeFor: ["/jobs", "/saved-jobs", "/my-applications"],
  },
  {
    id: "aiSearch",
    labelKey: "aiSearch",
    icon: SparkIcon,
    section: "aiSearch",
    activeFor: ["/job-matches", "/external-jobs"],
  },
  {
    id: "chats",
    labelKey: "chats",
    icon: MessageIcon,
    href: "/my-interview-chats",
    activeFor: ["/my-interview-chats"],
  },
  {
    id: "more",
    labelKey: "more",
    icon: SettingsIcon,
    section: "more",
    activeFor: ["/my-profile", "/job-preferences", "/plans", "/settings"],
  },
];

export const RECRUITER_TABS: NavTab[] = [
  { id: "home", labelKey: "sectionHome", icon: DashboardIcon, href: "/dashboard", activeFor: ["/dashboard"] },
  {
    id: "hiring",
    labelKey: "sectionHiring",
    icon: UsersIcon,
    section: "hiring",
    activeFor: ["/vacancies", "/candidates", "/compare"],
  },
  {
    id: "aiSearch",
    labelKey: "aiSearch",
    icon: SparkIcon,
    section: "aiSearch",
    activeFor: ["/search", "/processing"],
  },
  {
    id: "chats",
    labelKey: "chats",
    icon: MessageIcon,
    href: "/interview-chats",
    activeFor: ["/interview-chats"],
  },
  {
    id: "more",
    labelKey: "more",
    icon: SettingsIcon,
    section: "more",
    activeFor: ["/plans", "/settings"],
  },
];

export const CANDIDATE_SECTIONS: Record<NavSectionId, NavSectionLink[]> = {
  career: [
    { href: "/jobs", labelKey: "findJobs", hintKey: "findJobs", icon: SearchIcon },
    { href: "/saved-jobs", labelKey: "savedJobs", hintKey: "savedJobs", icon: BookmarkIcon },
    { href: "/my-applications", labelKey: "myApplications", hintKey: "myApplications", icon: BriefcaseIcon },
  ],
  aiSearch: [
    {
      href: "/job-matches",
      labelKey: "internalAiJobs",
      hintKey: "internalAiJobs",
      icon: SparkIcon,
      capability: "INTERNAL_AI_SEARCH",
    },
    {
      href: "/external-jobs",
      labelKey: "externalAiJobs",
      hintKey: "externalAiJobs",
      icon: GlobeIcon,
      capability: "EXTERNAL_AI_SEARCH",
    },
  ],
  more: [
    { href: "/my-profile", labelKey: "myProfile", hintKey: "myProfile", icon: UserIcon },
    { href: "/job-preferences", labelKey: "jobPreferences", hintKey: "jobPreferences", icon: FilterIcon },
    { href: "/plans", labelKey: "plans", hintKey: "plans", icon: SparkIcon },
    { href: "/settings", labelKey: "settings", hintKey: "settings", icon: SettingsIcon },
    // The web has no notifications PAGE — the bell is the surface — so this
    // row opens it rather than routing somewhere that does not exist.
    { labelKey: "notifications", hintKey: "notifications", icon: BellIcon, opensNotifications: true },
  ],
  hiring: [],
};

export const RECRUITER_SECTIONS: Record<NavSectionId, NavSectionLink[]> = {
  hiring: [
    { href: "/vacancies", labelKey: "vacancies", hintKey: "vacancies", icon: BriefcaseIcon },
    { href: "/candidates", labelKey: "candidates", hintKey: "candidates", icon: UsersIcon },
    { href: "/compare", labelKey: "compare", hintKey: "compare", icon: CompareIcon },
  ],
  aiSearch: [
    { href: "/search", labelKey: "aiSearch", hintKey: "internalAiSearch", icon: SearchIcon },
    /*
     * External recruiter sourcing does not exist. There is no route to send
     * anyone to, so this row is marked "coming soon" and opens the recruiter
     * plans page, which is where the roadmap for it actually lives. Inventing
     * a screen would be worse than the honest detour.
     */
    {
      href: "/plans",
      labelKey: "externalAiJobs",
      hintKey: "externalAiSearch",
      icon: LockIcon,
      comingSoon: true,
    },
  ],
  more: [
    { href: "/plans", labelKey: "plans", hintKey: "plans", icon: SparkIcon },
    { href: "/settings", labelKey: "settings", hintKey: "settings", icon: SettingsIcon },
    { labelKey: "notifications", hintKey: "notifications", icon: BellIcon, opensNotifications: true },
  ],
  career: [],
};

export function primaryTabsFor(workspace: Workspace): NavTab[] {
  return workspace.kind === "personal"
    ? CANDIDATE_TABS
    : RECRUITER_TABS;
}

export function navSectionsFor(
  workspace: Workspace,
): Record<NavSectionId, NavSectionLink[]> {
  return workspace.kind === "personal" ? CANDIDATE_SECTIONS : RECRUITER_SECTIONS;
}

/**
 * Which tab the current path belongs to.
 *
 * Longest fragment first, so `/jobs` cannot claim `/job-matches` and
 * `/search` cannot claim a future `/external-search`.
 */
export function activeNavTab(
  tabs: NavTab[],
  pathname: string,
): string | null {
  const candidates = tabs.flatMap((tab) =>
    tab.activeFor.map((fragment) => ({ id: tab.id, fragment })),
  );
  candidates.sort((a, b) => b.fragment.length - a.fragment.length);

  for (const { id, fragment } of candidates) {
    if (pathname === fragment || pathname.startsWith(`${fragment}/`)) return id;
  }
  return null;
}

/**
 * The header's title on mobile: the CURRENT page, not the area that holds it.
 *
 * A fixed "Home" would be useless and the area name would be worse — it names
 * where the reader came from rather than where they are. Desktop has no need
 * of this: the top bar shows the area and each page renders its own heading.
 * Ordering is longest-first for the same reason as above.
 */
export function pageTitleFor(pathname: string, d: Dictionary): string {
  const map: [string, string][] = [
    ["/external-jobs/applications", d.externalApplications.title],
    ["/external-jobs/saved", d.externalJobs.savedTitle],
    ["/my-interview-chats", d.chat.title],
    ["/job-preferences", d.jobPreferences.title],
    ["/interview-chats", d.chat.title],
    ["/my-applications", d.applications.title],
    ["/external-jobs", d.externalJobs.title],
    ["/job-matches", d.jobMatch.title],
    ["/saved-jobs", d.savedJobs.title],
    ["/my-profile", d.nav.myProfile],
    ["/candidates", d.candidates.title],
    ["/vacancies", d.vacancies.title],
    ["/processing", d.processing.title],
    ["/dashboard", d.dashboard.title],
    ["/workspaces", d.nav.organizations],
    ["/settings", d.settings.title],
    ["/compare", d.compare.title],
    ["/search", d.search.title],
    ["/plans", d.plans.title],
    ["/jobs", d.jobs.title],
    ["/home", d.home.title],
  ];

  for (const [fragment, title] of map) {
    if (pathname === fragment || pathname.startsWith(`${fragment}/`)) return title;
  }
  return d.meta.appName;
}

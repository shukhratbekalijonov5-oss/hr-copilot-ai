import type { ComponentType } from "react";
import {
  ActivityIcon,
  BriefcaseIcon,
  CompareIcon,
  DashboardIcon,
  FileIcon,
  FilterIcon,
  GlobeIcon,
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
import type { Role } from "@/lib/types";
import type { Workspace } from "@/lib/workspace/types";

export interface NavItem {
  href: string;
  /**
   * Key into the dictionary's `nav` section rather than a literal label — the
   * navigation is defined once and rendered in whichever locale is active.
   */
  labelKey: keyof Dictionary["nav"];
  icon: ComponentType<IconProps>;
  /**
   * Roles this item is shown to. Presence in the sidebar is a usability
   * decision only — the backend is the authorization boundary, and every one of
   * these routes is independently guarded there. Hiding a link never makes an
   * action safe.
   */
  roles?: Role[];
  /** Rendered but not navigable, with a reason, when the backend cannot serve it. */
  unavailable?: boolean;
  /**
   * Which heading this item sits under.
   *
   * Grouping is how the sidebar says that Internal and External AI Jobs are
   * two doors into one product area while Find jobs is a different one. Items
   * with the same key must be adjacent — the sidebar renders a heading each
   * time the key changes rather than sorting, so the list order stays the
   * single definition of order.
   */
  groupKey?: keyof Dictionary["nav"];
  /**
   * The plan capability this surface needs, if any.
   *
   * A locked item is still RENDERED and still NAVIGABLE. Hiding it would leave
   * a paying decision invisible to the person who might make it, and the page
   * behind it explains the plan rather than failing. Nothing here is a
   * security boundary: the backend guards every one of these routes.
   */
  capability?: PlanCapability;
}

const ALL_ROLES: Role[] = ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"];
const ADMINS: Role[] = ["OWNER", "HR_ADMIN"];
const HIRING: Role[] = ["OWNER", "HR_ADMIN", "RECRUITER"];

/** Recruiting side. */
export const ORGANIZATION_NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: DashboardIcon, roles: ALL_ROLES },
  { href: "/vacancies", labelKey: "vacancies", icon: BriefcaseIcon, roles: HIRING },
  { href: "/candidates", labelKey: "candidates", icon: UsersIcon, roles: ALL_ROLES },
  { href: "/interview-chats", labelKey: "interviewChats", icon: MessageIcon, roles: ALL_ROLES },
  { href: "/search", labelKey: "aiSearch", icon: SparkIcon, roles: ALL_ROLES },
  { href: "/compare", labelKey: "compare", icon: CompareIcon, roles: HIRING },
  { href: "/processing", labelKey: "processing", icon: ActivityIcon, roles: HIRING },
];

export const ORGANIZATION_SECONDARY_NAV: NavItem[] = [
  { href: "/settings", labelKey: "settings", icon: SettingsIcon, roles: ADMINS },
];

/**
 * Job-seeking side, in three groups.
 *
 * ## Why AI job search is its own section
 *
 * Ordinary search and AI search answer the same question by different means,
 * and only one of them costs money. Filing them side by side in one flat list
 * made "AI Job Match" look like a sibling of "Saved jobs" — a screen, rather
 * than the paid half of the product. The heading is what lets a reader see
 * that Internal and External are two universes inside ONE feature, and that
 * the feature is where the plans differ.
 *
 * ## The two AI entries are never merged
 *
 * Internal ranks HR Copilot vacancies, where applying happens here and the
 * employer is a customer of ours. External ranks jobs published elsewhere,
 * where applying happens on the employer's site and we never learn the
 * outcome. A single blended ranking would have to pick one Apply button for
 * two different promises, so there are two entries and two result lists.
 */
export const PERSONAL_NAV: NavItem[] = [
  { href: "/jobs", labelKey: "findJobs", icon: SearchIcon, groupKey: "sectionFindJobs" },

  {
    href: "/job-matches",
    labelKey: "internalAiJobs",
    icon: SparkIcon,
    groupKey: "sectionAiJobSearch",
    capability: "INTERNAL_AI_SEARCH",
  },
  {
    href: "/external-jobs",
    labelKey: "externalAiJobs",
    icon: GlobeIcon,
    groupKey: "sectionAiJobSearch",
    capability: "EXTERNAL_AI_SEARCH",
  },

  { href: "/job-preferences", labelKey: "jobPreferences", icon: FilterIcon, groupKey: "sectionYourSearch" },
  { href: "/my-applications", labelKey: "myApplications", icon: BriefcaseIcon, groupKey: "sectionYourSearch" },
  { href: "/my-interview-chats", labelKey: "interviewChats", icon: MessageIcon, groupKey: "sectionYourSearch" },
  { href: "/saved-jobs", labelKey: "savedJobs", icon: FileIcon, groupKey: "sectionYourSearch" },
  { href: "/my-profile", labelKey: "myProfile", icon: UserIcon, groupKey: "sectionYourSearch" },
  { href: "/plans", labelKey: "plans", icon: SparkIcon, groupKey: "sectionYourSearch" },
];

export const PERSONAL_SECONDARY_NAV: NavItem[] = [];

export function navigationFor(workspace: Workspace): {
  primary: NavItem[];
  secondary: NavItem[];
} {
  if (workspace.kind === "personal") {
    return { primary: PERSONAL_NAV, secondary: PERSONAL_SECONDARY_NAV };
  }

  const visible = (item: NavItem) =>
    !item.roles || item.roles.includes(workspace.role);

  return {
    primary: ORGANIZATION_NAV.filter(visible),
    secondary: ORGANIZATION_SECONDARY_NAV.filter(visible),
  };
}

/** Route prefixes that belong to the personal (job-seeker) workspace. */
export const PERSONAL_ROUTE_PREFIXES = [
  "/jobs",
  "/external-jobs",
  "/job-matches",
  "/job-preferences",
  "/plans",
  "/my-applications",
  "/my-interview-chats",
  "/my-profile",
  "/my-resume",
  "/saved-jobs",
] as const;

export function isPersonalRoute(pathname: string): boolean {
  return PERSONAL_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Splits a nav list into rendered sections.
 *
 * Consecutive items sharing a `groupKey` form one group; an item without one
 * starts an unlabelled group. Order is never rearranged — the arrays above are
 * the only statement of order, and a grouping function that sorted would make
 * two places responsible for it.
 */
export interface NavGroup {
  labelKey: keyof Dictionary["nav"] | null;
  items: NavItem[];
}

export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];

  for (const item of items) {
    const labelKey = item.groupKey ?? null;
    const last = groups[groups.length - 1];
    if (last && last.labelKey === labelKey) last.items.push(item);
    else groups.push({ labelKey, items: [item] });
  }

  return groups;
}

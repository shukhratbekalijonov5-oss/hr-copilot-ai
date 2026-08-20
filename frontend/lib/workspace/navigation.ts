import type { ComponentType } from "react";
import {
  ActivityIcon,
  BriefcaseIcon,
  CompareIcon,
  DashboardIcon,
  FileIcon,
  MessageIcon,
  SearchIcon,
  SettingsIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
  type IconProps,
} from "@/components/ui/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
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

/** Job-seeking side. */
export const PERSONAL_NAV: NavItem[] = [
  { href: "/jobs", labelKey: "findJobs", icon: SearchIcon },
  { href: "/job-matches", labelKey: "aiJobMatch", icon: SparkIcon },
  { href: "/my-applications", labelKey: "myApplications", icon: BriefcaseIcon },
  { href: "/my-interview-chats", labelKey: "interviewChats", icon: MessageIcon },
  { href: "/saved-jobs", labelKey: "savedJobs", icon: FileIcon },
  { href: "/my-profile", labelKey: "myProfile", icon: UserIcon },
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
  "/job-matches",
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

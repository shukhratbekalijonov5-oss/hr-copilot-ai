import type { ComponentType } from "react";
import {
  ActivityIcon,
  BriefcaseIcon,
  CompareIcon,
  DashboardIcon,
  SettingsIcon,
  SparkIcon,
  UsersIcon,
  type IconProps,
} from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
}

export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/vacancies", label: "Vacancies", icon: BriefcaseIcon },
  { href: "/candidates", label: "Candidates", icon: UsersIcon },
  { href: "/search", label: "AI Search", icon: SparkIcon },
  { href: "/compare", label: "Compare", icon: CompareIcon },
  { href: "/processing", label: "Processing", icon: ActivityIcon },
];

export const SECONDARY_NAV: NavItem[] = [
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

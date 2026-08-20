import type { AccountType } from "@/lib/types";
import { isPersonalRoute } from "@/lib/workspace/navigation";

const ORGANIZATION_ROUTE_PREFIXES = [
  "/dashboard",
  "/search",
  "/vacancies",
  "/candidates",
  "/interview-chats",
  "/compare",
  "/processing",
  "/settings",
  "/workspaces",
] as const;

export function defaultRouteForAccountType(
  accountType: AccountType,
  hasActiveOrganization = false,
): string {
  if (accountType === "CANDIDATE") return "/jobs";
  return hasActiveOrganization ? "/dashboard" : "/workspaces";
}

export function isOrganizationRoute(pathname: string): boolean {
  return ORGANIZATION_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isRouteAllowedForAccountType(
  pathname: string,
  accountType: AccountType,
): boolean {
  if (accountType === "CANDIDATE") return isPersonalRoute(pathname);
  return isOrganizationRoute(pathname);
}

export function safeReturnToForAccountType(
  next: string | undefined,
  accountType: AccountType,
  hasActiveOrganization = false,
): string {
  const fallback = defaultRouteForAccountType(accountType, hasActiveOrganization);
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (!isRouteAllowedForAccountType(next, accountType)) return fallback;
  return next;
}

export function loginRouteForAccountType(accountType: AccountType): string {
  return accountType === "CANDIDATE"
    ? "/login/candidate"
    : "/login/organization";
}

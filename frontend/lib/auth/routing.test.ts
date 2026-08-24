import { describe, expect, it } from "vitest";
import {
  defaultRouteForAccountType,
  isOrganizationRoute,
  isRouteAllowedForAccountType,
  loginRouteForAccountType,
  safeReturnToForAccountType,
} from "@/lib/auth/routing";

describe("account-type auth routing", () => {
  it("routes candidates directly to the candidate workspace", () => {
    expect(defaultRouteForAccountType("CANDIDATE")).toBe("/home");
  });

  it("routes organization accounts to dashboard or organization picker", () => {
    expect(defaultRouteForAccountType("ORGANIZATION", true)).toBe("/dashboard");
    expect(defaultRouteForAccountType("ORGANIZATION", false)).toBe("/workspaces");
  });

  it("keeps candidate and organization protected routes separate", () => {
    expect(isRouteAllowedForAccountType("/job-matches", "CANDIDATE")).toBe(true);
    expect(isRouteAllowedForAccountType("/settings", "CANDIDATE")).toBe(true);
    expect(isRouteAllowedForAccountType("/dashboard", "CANDIDATE")).toBe(false);
    expect(isRouteAllowedForAccountType("/search", "ORGANIZATION")).toBe(true);
    expect(isRouteAllowedForAccountType("/settings", "ORGANIZATION")).toBe(true);
    expect(isRouteAllowedForAccountType("/saved-jobs", "ORGANIZATION")).toBe(
      false,
    );
  });

  it("rejects prefix collisions", () => {
    expect(isOrganizationRoute("/dashboarding")).toBe(false);
    expect(isRouteAllowedForAccountType("/jobs-admin", "CANDIDATE")).toBe(false);
  });

  it("only preserves same-type safe return paths", () => {
    expect(safeReturnToForAccountType("/job-matches", "CANDIDATE")).toBe(
      "/job-matches",
    );
    expect(safeReturnToForAccountType("/settings", "CANDIDATE")).toBe(
      "/settings",
    );
    expect(safeReturnToForAccountType("/dashboard", "CANDIDATE")).toBe("/home");
    expect(safeReturnToForAccountType("/search", "ORGANIZATION", true)).toBe(
      "/search",
    );
    expect(safeReturnToForAccountType("/settings", "ORGANIZATION", true)).toBe(
      "/settings",
    );
    expect(safeReturnToForAccountType("/saved-jobs", "ORGANIZATION", true)).toBe(
      "/dashboard",
    );
    expect(safeReturnToForAccountType("https://bad.test", "CANDIDATE")).toBe(
      "/home",
    );
  });

  it("names the explicit sign-in doors", () => {
    expect(loginRouteForAccountType("CANDIDATE")).toBe("/login/candidate");
    expect(loginRouteForAccountType("ORGANIZATION")).toBe("/login/organization");
  });
});

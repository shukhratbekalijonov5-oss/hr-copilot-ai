import { describe, expect, it } from "vitest";
import {
  organizationsFromSession,
  personalFromSession,
  type OrganizationWorkspace,
  type PersonalWorkspace,
} from "@/lib/workspace/types";
import {
  ORGANIZATION_NAV,
  isNavItemActive,
  isPersonalRoute,
  navigationFor,
} from "@/lib/workspace/navigation";
import { resolveEntitlements } from "@/lib/entitlements/plan";
import type { Role, SessionUser } from "@/lib/types";

const NORTHWIND = { id: "o1", name: "Northwind Talent", slug: "northwind" };

function session(role: Role): SessionUser {
  return {
    id: "u1",
    fullName: "Aziza Rakhimova",
    email: "aziza@northwind.example",
    accountType: "ORGANIZATION",
    preferredLocale: "en",
    avatarUrl: null,
    hasCandidateAccount: false,
    entitlements: resolveEntitlements(null),
    activeOrganization: { ...NORTHWIND, role },
    memberships: [{ organization: NORTHWIND, role, joinedAt: "2026-01-01T00:00:00.000Z" }],
  };
}

const personal: PersonalWorkspace = {
  kind: "personal",
  id: "personal",
  name: "Aziza Rakhimova",
};

function orgWorkspace(role: Role): OrganizationWorkspace {
  return {
    kind: "organization",
    id: "o1",
    name: "Northwind Talent",
    slug: "northwind",
    role,
  };
}

describe("workspace derivation", () => {
  it("derives the organization workspace with the caller's role in it", () => {
    const [organization] = organizationsFromSession(session("RECRUITER"));
    expect(organization.kind).toBe("organization");
    expect(organization.id).toBe("o1");
    expect(organization.role).toBe("RECRUITER");
  });

  it("returns a list, so multi-organization membership needs no shape change", () => {
    expect(Array.isArray(organizationsFromSession(session("OWNER")))).toBe(true);
  });

  it("derives the personal workspace from the person, not the organization", () => {
    expect(personalFromSession(session("OWNER"))).toEqual(personal);
  });
});

describe("navigationFor — organization workspace", () => {
  it("gives organization users the account settings link", () => {
    for (const role of ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"] as const) {
      const nav = navigationFor(orgWorkspace(role));
      const hrefs = nav.primary.map((item) => item.href);
      if (role !== "INTERVIEWER") {
        expect(hrefs).toContain("/vacancies");
        expect(hrefs).toContain("/processing");
      }
      expect(hrefs).toContain("/settings");
    }
  });

  it("lets recruiters run hiring and open account settings", () => {
    const nav = navigationFor(orgWorkspace("RECRUITER"));
    expect(nav.primary.map((item) => item.href)).toContain("/vacancies");
    expect(nav.primary.map((item) => item.href)).toContain("/settings");
  });

  it("gives interviewers a narrow surface, plus account settings", () => {
    const nav = navigationFor(orgWorkspace("INTERVIEWER"));
    const hrefs = nav.primary.map((item) => item.href);

    expect(hrefs).toContain("/candidates");
    expect(hrefs).toContain("/search");
    expect(hrefs).not.toContain("/vacancies");
    expect(hrefs).not.toContain("/compare");
    expect(hrefs).not.toContain("/processing");
    expect(nav.primary.map((item) => item.href)).toContain("/plans");
    expect(nav.primary.map((item) => item.href)).toContain("/settings");
    // Every entry now carries a heading, so the unlabelled tail is empty.
    expect(nav.secondary).toEqual([]);
  });

  it("never shows an interviewer more than an owner", () => {
    const owner = navigationFor(orgWorkspace("OWNER"));
    const interviewer = navigationFor(orgWorkspace("INTERVIEWER"));
    const ownerHrefs = new Set([
      ...owner.primary.map((i) => i.href),
      ...owner.secondary.map((i) => i.href),
    ]);

    for (const item of [...interviewer.primary, ...interviewer.secondary]) {
      expect(ownerHrefs.has(item.href)).toBe(true);
    }
  });

  it("never leaks candidate-only routes into the recruiting navigation", () => {
    // `/settings` and `/plans` are served to BOTH account types by the
    // shared authenticated group, so neither is a candidate-only leak.
    const sharedRoutes = new Set(["/settings", "/plans"]);
    for (const role of ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"] as const) {
      const nav = navigationFor(orgWorkspace(role));
      for (const item of [...nav.primary, ...nav.secondary]) {
        if (!sharedRoutes.has(item.href)) {
          expect(isPersonalRoute(item.href)).toBe(false);
        }
      }
    }
  });
});

describe("navigationFor — personal workspace", () => {
  it("shows job-seeking navigation only", () => {
    const nav = navigationFor(personal);
    const hrefs = nav.primary.map((item) => item.href);

    expect(hrefs).toContain("/jobs");
    expect(hrefs).toContain("/my-applications");
    expect(hrefs).toContain("/saved-jobs");
    expect(hrefs).toContain("/my-profile");
    expect(hrefs).toContain("/settings");
  });

  it("never exposes a recruiting route to the job-seeker side", () => {
    // `/settings` and `/plans` are served to BOTH account types by the shared
    // authenticated route group, so neither is a recruiting-only leak.
    const shared = new Set(["/settings", "/plans"]);
    const recruiting = new Set(
      ORGANIZATION_NAV.map((item) => item.href).filter((href) => !shared.has(href)),
    );
    for (const item of navigationFor(personal).primary) {
      expect(recruiting.has(item.href)).toBe(false);
    }
  });

  it("does not depend on an organization role", () => {
    // The personal workspace has no role, so navigation must not read one.
    expect(() => navigationFor(personal)).not.toThrow();
  });
});

describe("route classification", () => {
  it("recognises personal routes and their children", () => {
    expect(isPersonalRoute("/jobs")).toBe(true);
    expect(isPersonalRoute("/jobs/abc")).toBe(true);
    expect(isPersonalRoute("/my-applications/xyz")).toBe(true);
    expect(isPersonalRoute("/settings")).toBe(true);
  });

  it("does not classify recruiting routes as personal", () => {
    for (const route of [
      "/dashboard",
      "/vacancies",
      "/candidates",
      "/processing",
      "/compare",
      "/search",
    ]) {
      expect(isPersonalRoute(route)).toBe(false);
    }
  });

  it("does not treat a prefix collision as a match", () => {
    expect(isPersonalRoute("/jobsomething")).toBe(false);
  });

  it("marks a nav item active for its own subtree only", () => {
    expect(isNavItemActive("/vacancies/123", "/vacancies")).toBe(true);
    expect(isNavItemActive("/candidates", "/vacancies")).toBe(false);
  });
});

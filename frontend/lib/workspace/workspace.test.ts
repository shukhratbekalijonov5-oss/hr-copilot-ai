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
import type { Role, SessionUser } from "@/lib/types";

const NORTHWIND = { id: "o1", name: "Northwind Talent", slug: "northwind" };

function session(role: Role): SessionUser {
  return {
    id: "u1",
    fullName: "Aziza Rakhimova",
    email: "aziza@northwind.example",
    preferredLocale: "en",
    hasCandidateAccount: false,
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
  it("gives owners and HR admins the full workspace including settings", () => {
    for (const role of ["OWNER", "HR_ADMIN"] as const) {
      const nav = navigationFor(orgWorkspace(role));
      const hrefs = nav.primary.map((item) => item.href);
      expect(hrefs).toContain("/vacancies");
      expect(hrefs).toContain("/processing");
      expect(nav.secondary.map((item) => item.href)).toContain("/settings");
    }
  });

  it("lets recruiters run hiring but not organization settings", () => {
    const nav = navigationFor(orgWorkspace("RECRUITER"));
    expect(nav.primary.map((item) => item.href)).toContain("/vacancies");
    expect(nav.secondary.map((item) => item.href)).not.toContain("/settings");
  });

  it("gives interviewers a narrow surface: no vacancies, compare, processing or settings", () => {
    const nav = navigationFor(orgWorkspace("INTERVIEWER"));
    const hrefs = nav.primary.map((item) => item.href);

    expect(hrefs).toContain("/candidates");
    expect(hrefs).toContain("/search");
    expect(hrefs).not.toContain("/vacancies");
    expect(hrefs).not.toContain("/compare");
    expect(hrefs).not.toContain("/processing");
    expect(nav.secondary).toHaveLength(0);
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

  it("never leaks candidate-side routes into the recruiting sidebar", () => {
    for (const role of ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"] as const) {
      const nav = navigationFor(orgWorkspace(role));
      for (const item of [...nav.primary, ...nav.secondary]) {
        expect(isPersonalRoute(item.href)).toBe(false);
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
  });

  it("never exposes a recruiting route to the job-seeker side", () => {
    const recruiting = new Set(ORGANIZATION_NAV.map((item) => item.href));
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
  });

  it("does not classify recruiting routes as personal", () => {
    for (const route of [
      "/dashboard",
      "/vacancies",
      "/candidates",
      "/processing",
      "/settings",
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

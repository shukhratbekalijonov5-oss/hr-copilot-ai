import { describe, expect, it } from "vitest";
import {
  activeOrganizationWorkspace,
  buildWorkspaceContext,
  organizationsFromSession,
  personalFromSession,
} from "@/lib/workspace/types";
import { navigationFor } from "@/lib/workspace/navigation";
import type { SessionUser } from "@/lib/types";

const NORTHWIND = { id: "org-1", name: "Northwind Labs", slug: "northwind" };
const ACME = { id: "org-2", name: "Acme Rival", slug: "acme" };

/** A user who is a job seeker AND holds two memberships with different roles. */
function dualIdentity(activeId: string | null = NORTHWIND.id): SessionUser {
  const memberships = [
    { organization: NORTHWIND, role: "RECRUITER" as const, joinedAt: "2026-01-01T00:00:00.000Z" },
    { organization: ACME, role: "INTERVIEWER" as const, joinedAt: "2026-02-01T00:00:00.000Z" },
  ];
  const active = memberships.find((m) => m.organization.id === activeId);

  return {
    id: "u1",
    fullName: "Seo Yuna",
    email: "yuna@example.test",
    preferredLocale: "ko",
    hasCandidateAccount: true,
    activeOrganization: active
      ? { ...active.organization, role: active.role }
      : null,
    memberships,
  };
}

function jobSeeker(): SessionUser {
  return {
    id: "u2",
    fullName: "Jasur Toshmatov",
    email: "jasur@example.test",
    preferredLocale: "uz",
    hasCandidateAccount: true,
    activeOrganization: null,
    memberships: [],
  };
}

describe("multi-organization membership", () => {
  it("lists every organization with the role held in that one", () => {
    const organizations = organizationsFromSession(dualIdentity());
    expect(organizations.map((o) => [o.name, o.role])).toEqual([
      ["Northwind Labs", "RECRUITER"],
      ["Acme Rival", "INTERVIEWER"],
    ]);
  });

  it("derives the active workspace from the backend, not from position", () => {
    // Being second in the list must not stop Acme from being the active one.
    const active = activeOrganizationWorkspace(dualIdentity(ACME.id));
    expect(active?.id).toBe(ACME.id);
    expect(active?.role).toBe("INTERVIEWER");
  });

  it("reports no active organization when the claim is stale", () => {
    expect(activeOrganizationWorkspace(dualIdentity(null))).toBeNull();
  });

  it("gives a job seeker no organizations at all", () => {
    expect(organizationsFromSession(jobSeeker())).toEqual([]);
    expect(activeOrganizationWorkspace(jobSeeker())).toBeNull();
  });
});

describe("role-sensitive navigation follows the active organization", () => {
  it("shows recruiter navigation in one workspace and interviewer in the other", () => {
    const asRecruiter = activeOrganizationWorkspace(dualIdentity(NORTHWIND.id))!;
    const asInterviewer = activeOrganizationWorkspace(dualIdentity(ACME.id))!;

    const recruiterHrefs = navigationFor(asRecruiter).primary.map((i) => i.href);
    const interviewerHrefs = navigationFor(asInterviewer).primary.map((i) => i.href);

    expect(recruiterHrefs).toContain("/vacancies");
    expect(recruiterHrefs).toContain("/compare");
    // The same person, a different organization, a narrower surface.
    expect(interviewerHrefs).not.toContain("/vacancies");
    expect(interviewerHrefs).not.toContain("/compare");
  });

  it("never derives navigation from a user-level role", () => {
    // There is no such field to read; navigation takes a workspace.
    const session = dualIdentity() as unknown as Record<string, unknown>;
    expect(session.role).toBeUndefined();
  });
});

describe("workspace context", () => {
  it("keeps the candidate workspace independent of any organization role", () => {
    const session = dualIdentity();
    const context = buildWorkspaceContext(session, personalFromSession(session));

    expect(context.active.kind).toBe("personal");
    // The personal workspace carries no role, even for a user who has two.
    expect("role" in context.active).toBe(false);
    expect(context.organizations).toHaveLength(2);
    expect(context.hasCandidateAccount).toBe(true);
  });

  it("reports which organization the token actually points at", () => {
    const session = dualIdentity(ACME.id);
    const active = activeOrganizationWorkspace(session)!;
    const context = buildWorkspaceContext(session, active);

    expect(context.activeOrganizationId).toBe(ACME.id);
  });

  it("reports no active organization for a job seeker in their own workspace", () => {
    const session = jobSeeker();
    const context = buildWorkspaceContext(session, personalFromSession(session));

    expect(context.activeOrganizationId).toBeNull();
    expect(context.organizations).toEqual([]);
  });

  it("names the candidate workspace after the person, not an organization", () => {
    const session = dualIdentity();
    expect(personalFromSession(session).name).toBe("Seo Yuna");
  });
});

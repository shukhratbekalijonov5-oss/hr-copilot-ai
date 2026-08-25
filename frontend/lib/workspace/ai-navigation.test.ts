import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/workspace/navigation";
import { ROLES, type Role } from "@/lib/types";
import en from "@/lib/i18n/dictionaries/en";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import type {
  OrganizationWorkspace,
  PersonalWorkspace,
} from "@/lib/workspace/types";

function workspaceFor(role: Role): OrganizationWorkspace {
  return { kind: "organization", id: "org-1", name: "Northwind", slug: "nw", role };
}

const personalWorkspace: PersonalWorkspace = {
  kind: "personal",
  id: "personal",
  name: "Aziza",
};

const hrefsFor = (role: Role) => {
  const { primary, secondary } = navigationFor(workspaceFor(role));
  return [...primary, ...secondary].map((item) => item.href);
};

/**
 * Sidebar visibility is a usability decision, never a security one — every one
 * of these routes is independently guarded by the backend. These tests assert
 * the UX contract: an interviewer is not shown recruiter administration.
 */
describe("role-sensitive AI navigation", () => {
  it("shows AI search to every role", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role)).toContain("/search");
    }
  });

  it("hides compare, vacancies and processing from an interviewer", () => {
    const hrefs = hrefsFor("INTERVIEWER");
    expect(hrefs).not.toContain("/compare");
    expect(hrefs).not.toContain("/vacancies");
    expect(hrefs).not.toContain("/processing");
    // They still read candidates and run evidence search.
    expect(hrefs).toContain("/candidates");
    expect(hrefs).toContain("/search");
  });

  it("shows compare to the roles that can run an evidence mapping", () => {
    // Mirrors @Roles(OWNER, HR_ADMIN, RECRUITER) on EvidenceMapController.
    for (const role of ["OWNER", "HR_ADMIN", "RECRUITER"] as const) {
      expect(hrefsFor(role)).toContain("/compare");
    }
  });

  it("shows account settings to every organization role", () => {
    for (const role of ROLES) {
      expect(hrefsFor(role)).toContain("/settings");
    }
  });
});

describe("navigation labels", () => {
  it("resolves every nav item's label key in every locale", () => {
    const keys = new Set(
      [
        ...ROLES.flatMap((role) => {
          const { primary, secondary } = navigationFor(workspaceFor(role));
          return [...primary, ...secondary].map((item) => item.labelKey);
        }),
        ...navigationFor(personalWorkspace).primary.map((item) => item.labelKey),
      ],
    );

    expect(keys.size).toBeGreaterThan(0);
    for (const { dictionary } of ALL_DICTIONARIES) {
      for (const key of keys) {
        expect(typeof dictionary.nav[key]).toBe("string");
        expect(dictionary.nav[key]).not.toBe("");
      }
    }
  });

  it("keeps the AI job searches in the personal workspace only", () => {
    const { primary, secondary } = navigationFor(personalWorkspace);
    expect(primary.map((item) => item.href)).toEqual([
      // Where a session starts.
      "/home",

      // Ordinary search and the records it produces. It is the one job search
      // every plan includes, so it is NOT filed with the two paid ones below.
      "/jobs",
      "/saved-jobs",
      "/my-applications",

      // The two AI searches, adjacent and in one section. They stay SEPARATE
      // entries — never one merged board — because applying differs: here,
      // versus on the employer's own site. Internal comes first because it is
      // the cheaper plan and the one whose applications this product can
      // actually report on.
      "/job-matches",
      "/external-jobs",

      // The material the searches run on.
      "/my-profile",
      "/job-preferences",
      "/my-interview-chats",

      // Account closes the rail. Settings joined it from the old unlabelled
      // tail, so every entry now sits under a heading.
      "/plans",
      "/settings",
    ]);
    expect(secondary).toEqual([]);
    expect(en.nav.internalAiJobs).toBe("Internal AI Jobs");
    expect(en.nav.externalAiJobs).toBe("External AI Jobs");

    for (const role of ROLES) {
      const { primary, secondary } = navigationFor(workspaceFor(role));
      const hrefs = [...primary, ...secondary].map((item) => item.href);
      expect(hrefs).not.toContain("/job-matches");
      expect(hrefs).toContain("/interview-chats");
      expect(hrefs).not.toContain("/my-interview-chats");
    }
  });
});

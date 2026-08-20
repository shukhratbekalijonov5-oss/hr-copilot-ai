import { describe, expect, it } from "vitest";
import {
  toAuthSession,
  toCandidateAccount,
  toMyApplication,
  toPublicJob,
  toPublicJobDetail,
  toSavedJob,
  toSessionUser,
} from "@/lib/api/adapters";
import { candidateFailureReason } from "@/lib/api/candidate-errors";
import { ApiError, networkError } from "@/lib/api/errors";
import type { MeResponse } from "@/lib/api/contracts";

const NORTHWIND = { id: "org-1", name: "Northwind Labs", slug: "northwind" };
const ACME = { id: "org-2", name: "Acme Rival", slug: "acme" };

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: "u1",
    email: "dual@example.test",
    fullName: "Seo Yuna",
    accountType: "ORGANIZATION",
    preferredLocale: "ko",
    role: "RECRUITER",
    organizationId: NORTHWIND.id,
    organization: NORTHWIND,
    user: {
      id: "u1",
      email: "dual@example.test",
      fullName: "Seo Yuna",
      accountType: "ORGANIZATION",
      preferredLocale: "ko",
    },
    candidateAccount: { exists: true },
    activeOrganization: { ...NORTHWIND, role: "RECRUITER" },
    memberships: [
      { organization: NORTHWIND, role: "RECRUITER", joinedAt: "2026-01-01T00:00:00.000Z" },
      { organization: ACME, role: "INTERVIEWER", joinedAt: "2026-02-01T00:00:00.000Z" },
    ],
    ...overrides,
  };
}

describe("toSessionUser", () => {
  it("reads identity from the canonical shape, not the flat compatibility fields", () => {
    const session = toSessionUser(
      me({
        // Deliberately contradictory flat fields: the adapter must ignore them.
        role: "OWNER",
        organizationId: "org-999",
        organization: { id: "org-999", name: "Wrong", slug: "wrong" },
      }),
    );

    expect(session.activeOrganization?.id).toBe(NORTHWIND.id);
    expect(session.activeOrganization?.role).toBe("RECRUITER");
  });

  it("carries every membership with the role held in that organization", () => {
    const session = toSessionUser(me());
    expect(session.memberships).toHaveLength(2);
    expect(session.memberships.map((m) => m.role)).toEqual([
      "RECRUITER",
      "INTERVIEWER",
    ]);
  });

  it("exposes no user-level role or organizationId at all", () => {
    // Reintroducing either would recreate the single-organization assumption.
    const session = toSessionUser(me()) as unknown as Record<string, unknown>;
    expect(Object.keys(session)).not.toContain("role");
    expect(Object.keys(session)).not.toContain("organizationId");
  });

  it("represents a job seeker as a first-class account", () => {
    const session = toSessionUser(
      me({
        role: null,
        organizationId: null,
        organization: null,
        activeOrganization: null,
        memberships: [],
      }),
    );

    expect(session.activeOrganization).toBeNull();
    expect(session.memberships).toEqual([]);
    expect(session.hasCandidateAccount).toBe(true);
  });

  it("treats a stale organization claim as no active organization", () => {
    // The membership was revoked; the backend reports activeOrganization null
    // while still listing the memberships that remain.
    const session = toSessionUser(me({ activeOrganization: null }));
    expect(session.activeOrganization).toBeNull();
    expect(session.memberships).toHaveLength(2);
  });

  it("keeps the account's preferred locale", () => {
    expect(toSessionUser(me()).preferredLocale).toBe("ko");
  });
});

describe("toAuthSession", () => {
  it("maps only the safe fields and flags the current session", () => {
    const row = toAuthSession({
      id: "s1",
      createdAt: "2026-08-01T00:00:00.000Z",
      lastUsedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      userAgent: "Mozilla/5.0 (Macintosh)",
      deviceName: "Work laptop",
      current: true,
    });

    expect(row.current).toBe(true);
    expect(row.deviceName).toBe("Work laptop");
    // No token material is part of the contract, so none can be mapped.
    expect(Object.keys(row)).not.toContain("refreshTokenHash");
  });
});

describe("toCandidateAccount", () => {
  it("maps the profile and its resume", () => {
    const account = toCandidateAccount({
      id: "ca-1",
      headline: "Backend Engineer",
      location: "Tashkent",
      phone: "+998 90 000 0001",
      summary: "Builds services.",
      skills: ["Node.js", "PostgreSQL"],
      languages: ["O'zbekcha", "English"],
      experience: [{ title: "Engineer", company: "Acme", startDate: "2021" }],
      education: [{ institution: "TUIT", degree: "BSc", startYear: 2015 }],
      profileVisibility: "PRIVATE",
      resumeDocument: {
        id: "doc-1",
        originalFileName: "resume.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    expect(account.skills).toEqual(["Node.js", "PostgreSQL"]);
    expect(account.experience[0].startDate).toBe("2021");
    expect(account.resume?.originalFileName).toBe("resume.pdf");
    expect(account.profileVisibility).toBe("PRIVATE");
  });

  it("reports a profile with no resume as having none", () => {
    const account = toCandidateAccount({
      id: "ca-2",
      headline: null,
      location: null,
      phone: null,
      summary: null,
      skills: [],
      languages: [],
      experience: [],
      education: [],
      profileVisibility: "PRIVATE",
      resumeDocument: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(account.resume).toBeNull();
  });
});

describe("public job adapters", () => {
  const row = {
    publicSlug: "backend-engineer-northwind-abc123",
    title: "Backend Engineer",
    department: "Engineering",
    location: "Seoul, KR",
    employmentType: "Full-time",
    experienceLevel: "Senior",
    createdAt: "2026-08-01T00:00:00.000Z",
    organization: { name: "Northwind Labs" },
  };

  it("flattens the organization to its display name only", () => {
    const job = toPublicJob(row);
    expect(job.organizationName).toBe("Northwind Labs");
    // No organization id is exposed on the public board.
    expect(Object.keys(job)).not.toContain("organizationId");
  });

  it("addresses a job by its public slug, never an internal id", () => {
    const job = toPublicJob(row);
    expect(job.publicSlug).toBe(row.publicSlug);
    expect(Object.keys(job)).not.toContain("id");
  });

  it("adds description and requirements on the detail shape", () => {
    const detail = toPublicJobDetail({
      ...row,
      description: "Build things.",
      requirements: [
        { text: "NestJS", type: "SKILL", required: true },
        { text: "Redis", type: "SKILL", required: false },
      ],
    });

    expect(detail.description).toBe("Build things.");
    expect(detail.requirements.filter((r) => r.required)).toHaveLength(1);
  });
});

describe("toMyApplication", () => {
  it("keeps the submitted snapshot separate from the current profile resume", () => {
    const application = toMyApplication({
      id: "app-1",
      status: "REVIEWING",
      source: "DIRECT",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
      vacancy: {
        publicSlug: "slug",
        title: "Backend Engineer",
        location: "Seoul",
        employmentType: "Full-time",
        organization: { name: "Northwind Labs" },
      },
      submittedDocument: { originalFileName: "resume-v1.pdf" },
    });

    expect(application.submittedFileName).toBe("resume-v1.pdf");
    expect(application.job.organizationName).toBe("Northwind Labs");
    expect(application.source).toBe("DIRECT");
  });

  it("exposes no recruiter-side data", () => {
    const application = toMyApplication({
      id: "app-2",
      status: "NEW",
      source: "DIRECT",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      vacancy: {
        publicSlug: "slug",
        title: "Role",
        location: null,
        employmentType: null,
        organization: { name: "Org" },
      },
      submittedDocument: null,
    }) as unknown as Record<string, unknown>;

    for (const forbidden of ["notes", "evidence", "candidateId", "rank"]) {
      expect(Object.keys(application)).not.toContain(forbidden);
    }
  });
});

describe("toSavedJob", () => {
  it("keeps the job status so a closed bookmark can be flagged", () => {
    const saved = toSavedJob({
      savedAt: "2026-08-01T00:00:00.000Z",
      job: {
        publicSlug: "slug",
        title: "Role",
        location: null,
        employmentType: null,
        status: "CLOSED",
        organization: { name: "Org" },
      },
    });
    expect(saved.job.status).toBe("CLOSED");
  });
});

describe("candidateFailureReason", () => {
  it("names the specific thing that is missing", () => {
    // Each maps to a different next step, so they must not be merged.
    expect(candidateFailureReason(new ApiError("x", 400, "validation"))).toBe(
      "no_candidate_account",
    );
    expect(candidateFailureReason(new ApiError("x", 422, "validation"))).toBe(
      "no_resume",
    );
    expect(candidateFailureReason(new ApiError("x", 409, "conflict"))).toBe(
      "already_applied",
    );
    expect(candidateFailureReason(new ApiError("x", 404, "not_found"))).toBe(
      "job_unavailable",
    );
    expect(candidateFailureReason(new ApiError("x", 401, "unauthorized"))).toBe(
      "unauthorized",
    );
  });

  it("keeps a network fault distinct from a rejected request", () => {
    expect(candidateFailureReason(networkError())).toBe("network");
  });

  it("falls back for anything unrecognised", () => {
    expect(candidateFailureReason(new Error("boom"))).toBe("error");
    expect(candidateFailureReason(new ApiError("x", 500, "server"))).toBe("error");
  });
});

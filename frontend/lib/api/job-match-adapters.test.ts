import { describe, expect, it } from "vitest";
import { toJobMatchResult } from "@/lib/api/adapters";
import type { JobMatchesResponse, JobMatchResponse } from "@/lib/api/contracts";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

type JobMatchResponseWithHiddenId = JobMatchResponse & {
  vacancy: JobMatchResponse["vacancy"] & { id?: string };
};

type MatchOverrides = Omit<Partial<JobMatchResponse>, "vacancy"> & {
  vacancy?: Partial<JobMatchResponse["vacancy"]> & { id?: string };
};

function match(
  overrides: MatchOverrides = {},
): JobMatchResponseWithHiddenId {
  return {
    vacancy: {
      id: UUID,
      slug: "backend-engineer-northwind-public",
      title: "Backend Engineer",
      organizationName: "Northwind Labs",
      location: "Seoul",
      employmentType: "Full-time",
      status: "OPEN",
      ...overrides.vacancy,
    },
    match: overrides.match ?? "STRONG",
    explanation:
      "explanation" in overrides
        ? overrides.explanation!
        : "Your Docker work supports the role.",
    supportedRequirements: overrides.supportedRequirements ?? [
      { text: "Docker", required: true, reason: "Resume mentions Docker." },
    ],
    unsupportedRequirements: overrides.unsupportedRequirements ?? [
      { text: "Terraform", required: false, reason: "No Terraform evidence." },
    ],
    unclearRequirements: overrides.unclearRequirements ?? [
      { text: "Korean fluency", required: false, reason: "Language level is unclear." },
    ],
    evidence: overrides.evidence ?? [
      {
        fileName: "resume.pdf",
        pageNumber: 2,
        section: "skills",
        text: "Docker, PostgreSQL, distributed systems",
      },
    ],
    saved: overrides.saved ?? false,
    applicationState: overrides.applicationState ?? null,
  };
}

function response(matches: JobMatchResponse[]): JobMatchesResponse {
  return {
    matches,
    locale: "en",
    generated: true,
    generatedAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("toJobMatchResult", () => {
  it("preserves STRONG, PARTIAL and WEAK labels without exposing a score", () => {
    const result = toJobMatchResult(
      response([
        match({ match: "STRONG" }),
        match({ match: "PARTIAL", vacancy: { slug: "partial-role" } }),
        match({ match: "WEAK", vacancy: { slug: "weak-role" } }),
      ]),
    );

    expect(result.matches.map((item) => item.match)).toEqual([
      "STRONG",
      "PARTIAL",
      "WEAK",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/score|percent|percentage/i);
  });

  it("keeps deterministic requirements and evidence when generated is false", () => {
    const result = toJobMatchResult({
      ...response([match({ explanation: null })]),
      generated: false,
    });

    const [item] = result.matches;
    expect(result.generated).toBe(false);
    expect(item.explanation).toBeNull();
    expect(item.supportedRequirements[0].text).toBe("Docker");
    expect(item.unsupportedRequirements[0].text).toBe("Terraform");
    expect(item.unclearRequirements[0].text).toBe("Korean fluency");
    expect(item.evidence[0]).toMatchObject({
      fileName: "resume.pdf",
      pageNumber: 2,
      section: "skills",
    });
  });

  it("carries saved, applied and closed state for the shared job flows", () => {
    const result = toJobMatchResult(
      response([
        match({ saved: true, applicationState: "REVIEWING" }),
        match({
          vacancy: {
            slug: "closed-role",
            status: "CLOSED",
          },
          saved: false,
          applicationState: null,
        }),
      ]),
    );

    expect(result.matches[0].saved).toBe(true);
    expect(result.matches[0].applicationState).toBe("REVIEWING");
    expect(result.matches[1].vacancy.status).toBe("CLOSED");
  });

  it("uses only the public vacancy slug and drops internal identifiers", () => {
    const result = toJobMatchResult(response([match()]));
    const [item] = result.matches;

    expect(item.vacancy.slug).toBe("backend-engineer-northwind-public");
    expect(Object.keys(item.vacancy)).not.toContain("id");
    expect(JSON.stringify(result)).not.toContain(UUID);
  });

  it("preserves the backend locale and generation timestamp", () => {
    const result = toJobMatchResult({
      ...response([match()]),
      locale: "uz",
      generatedAt: "2026-08-20T01:02:03.000Z",
    });

    expect(result.locale).toBe("uz");
    expect(result.generatedAt).toBe("2026-08-20T01:02:03.000Z");
  });
});

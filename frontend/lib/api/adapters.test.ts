import { describe, expect, it } from "vitest";
import {
  aggregateDocumentStatus,
  aiReadiness,
  buildRequirementEvidence,
  documentProgress,
  summarizeDocumentStatuses,
  toCandidate,
  toEvidenceSearchResult,
  toVacancy,
  toJobPreferences,
} from "@/lib/api/adapters";
import type { CandidateResponse, VacancyResponse } from "@/lib/api/contracts";
import type { Evidence, JobRequirement } from "@/lib/types";

describe("summarizeDocumentStatuses", () => {
  it("counts each document at every stage it has reached", () => {
    const summary = summarizeDocumentStatuses([
      "COMPLETED",
      "EMBEDDING",
      "UPLOADED",
    ]);

    expect(summary.total).toBe(3);
    expect(summary.reached.UPLOADED).toBe(3);
    expect(summary.reached.PARSING).toBe(2);
    expect(summary.reached.EMBEDDING).toBe(2);
    expect(summary.reached.INDEXING).toBe(1);
    expect(summary.reached.COMPLETED).toBe(1);
  });

  it("treats QUEUED as uploaded but not yet parsing", () => {
    const summary = summarizeDocumentStatuses(["QUEUED"]);
    expect(summary.reached.UPLOADED).toBe(1);
    expect(summary.reached.PARSING).toBe(0);
  });

  it("reports failures separately instead of counting them as progress", () => {
    const summary = summarizeDocumentStatuses(["FAILED", "COMPLETED"]);
    expect(summary.failed).toBe(1);
    expect(summary.reached.UPLOADED).toBe(1);
  });
});

describe("aggregateDocumentStatus", () => {
  it("returns null when there are no documents", () => {
    expect(aggregateDocumentStatus([])).toBeNull();
  });

  it("surfaces a failure even when other documents finished", () => {
    expect(
      aggregateDocumentStatus([{ status: "COMPLETED" }, { status: "FAILED" }]),
    ).toBe("FAILED");
  });

  it("reports the least advanced document so nothing looks ready early", () => {
    expect(
      aggregateDocumentStatus([{ status: "COMPLETED" }, { status: "PARSING" }]),
    ).toBe("PARSING");
  });
});

describe("documentProgress", () => {
  it("maps the pipeline onto 0–100 without ever exceeding it", () => {
    expect(documentProgress("COMPLETED")).toBe(100);
    expect(documentProgress("FAILED")).toBe(0);
    expect(documentProgress("UPLOADED")).toBe(0);
    expect(documentProgress("EMBEDDING")).toBeGreaterThan(
      documentProgress("PARSING"),
    );
  });
});

describe("toVacancy", () => {
  const base: VacancyResponse = {
    id: "v1",
    organizationId: "o1",
    title: "Senior Backend Engineer",
    department: null,
    location: null,
    employmentType: null,
    description: null,
    experienceLevel: null,
    status: "OPEN",
    createdById: "u1",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };

  it("derives candidate count from the application count the list returns", () => {
    const vacancy = toVacancy({
      ...base,
      _count: { applications: 4, requirements: 2 },
    });
    expect(vacancy.candidateCount).toBe(4);
    expect(vacancy.requirementCount).toBe(2);
  });

  it("counts people, not attempts, when the API says how many people", () => {
    // Since reapply-after-rejection the two differ: five applications by three
    // people. `candidateCount` is the people number and must win — a card
    // labelled "5 candidates" over a list of three is the same bug the
    // applicant grouping fixes, one screen earlier.
    const vacancy = toVacancy({
      ...base,
      candidateCount: 3,
      _count: { applications: 5, requirements: 2 },
    });
    expect(vacancy.candidateCount).toBe(3);
  });

  it("falls back to the nested requirements when no counts are present", () => {
    const vacancy = toVacancy({
      ...base,
      requirements: [
        { id: "r1", vacancyId: "v1", text: "Kubernetes", type: "SKILL", required: true },
      ],
    });
    expect(vacancy.candidateCount).toBe(0);
    expect(vacancy.requirementCount).toBe(1);
  });
});

describe("toCandidate", () => {
  const base: CandidateResponse = {
    id: "c1",
    organizationId: "o1",
    fullName: "Aziz Yusupov",
    email: null,
    phone: null,
    location: null,
    currentTitle: null,
    totalExperienceYears: null,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };

  it("derives the primary vacancy from the first application", () => {
    const candidate = toCandidate({
      ...base,
      applications: [
        {
          id: "a1",
          candidateId: "c1",
          vacancyId: "v1",
          status: "NEW",
          createdAt: "2026-08-20T00:00:00.000Z",
          updatedAt: "2026-08-20T00:00:00.000Z",
          vacancy: { id: "v1", title: "Senior Backend Engineer", status: "OPEN" },
        },
      ],
    });

    expect(candidate.primaryVacancyId).toBe("v1");
    expect(candidate.primaryVacancyTitle).toBe("Senior Backend Engineer");
  });

  it("preserves the candidate account linkage discriminator", () => {
    expect(toCandidate({ ...base, candidateAccountId: null }).candidateAccountId).toBeNull();
    expect(
      toCandidate({ ...base, candidateAccountId: "account-1" }).candidateAccountId,
    ).toBe("account-1");
  });

  it("reports the CURRENT evidence facts, not application-time copies", () => {
    // A row describes the person as they are now: their live avatar and the
    // documents their account holds. Applying copies nothing, so there is no
    // per-application document list to count.
    const candidate = toCandidate({
      ...base,
      avatarUrl: "https://files.example.test/avatar.png?sig=abc",
      documentCount: 2,
      documentStatuses: ["COMPLETED", "EMBEDDING"],
    });

    expect(candidate.avatarUrl).toBe(
      "https://files.example.test/avatar.png?sig=abc",
    );
    expect(candidate.documentCount).toBe(2);
    // Worst-case across the current documents, so a row never reads "ready"
    // while one of the person's files is still being processed.
    expect(candidate.processingStatus).toBe("EMBEDDING");
  });

  it("falls back to initials and no documents when the account has neither", () => {
    const candidate = toCandidate(base);

    expect(candidate.avatarUrl).toBeNull();
    expect(candidate.documentCount).toBe(0);
    expect(candidate.processingStatus).toBeNull();
  });
});

describe("buildRequirementEvidence", () => {
  const requirements: JobRequirement[] = [
    { id: "r1", vacancyId: "v1", text: "Kubernetes", type: "SKILL", required: true },
    { id: "r2", vacancyId: "v1", text: "Terraform", type: "SKILL", required: false },
  ];

  const evidence: Evidence[] = [
    {
      id: "e1",
      candidateId: "c1",
      documentId: "d1",
      vacancyId: "v1",
      requirementId: "r1",
      pageNumber: 2,
      section: null,
      text: "Deployed services on Kubernetes.",
      evidenceType: "SKILL",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
  ];

  it("marks a requirement FOUND only when a passage supports it", () => {
    const rows = buildRequirementEvidence(
      requirements,
      evidence,
      new Map([["d1", "aziz.pdf"]]),
    );

    expect(rows[0].status).toBe("FOUND");
    expect(rows[0].citations[0].documentName).toBe("aziz.pdf");
    expect(rows[0].citations[0].page).toBe(2);
  });

  it("reports absence of evidence rather than omitting the requirement", () => {
    const rows = buildRequirementEvidence(requirements, evidence, new Map());
    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe("NOT_FOUND");
    expect(rows[1].citations).toEqual([]);
  });

  it("never invents NEEDS_REVIEW, which the API has no signal for", () => {
    const rows = buildRequirementEvidence(requirements, evidence, new Map());
    expect(rows.some((row) => row.status === "NEEDS_REVIEW")).toBe(false);
  });
});

describe("toEvidenceSearchResult", () => {
  const hit = (
    candidateId: string | null,
    text: string,
    extra: Partial<{
      candidateName: string | null;
      fileName: string | null;
      pageNumber: number | null;
      section: string | null;
      retrievalScore: number;
      rerankScore: number | null;
    }> = {},
  ) => ({
    candidateId,
    candidateName: extra.candidateName ?? "Aziz Yusupov",
    documentId: "d1",
    fileName: extra.fileName ?? "aziz.pdf",
    section: extra.section ?? null,
    pageNumber: extra.pageNumber ?? 2,
    text,
    relevance: {
      retrievalScore: extra.retrievalScore ?? 0.91,
      rerankScore: extra.rerankScore ?? 0.88,
    },
  });

  const response = (
    results: ReturnType<typeof hit>[],
  ) => ({
    query: "kubernetes",
    results,
    reranked: true,
    totalConsidered: 40,
    durationMs: 120,
  });

  it("groups passages under the candidate they came from", () => {
    const result = toEvidenceSearchResult(
      response([
        hit("c1", "Ran Kubernetes in production."),
        hit("c2", "Managed EKS clusters.", { candidateName: "Daniel Osei" }),
        hit("c1", "Tuned HPA for the ingress tier."),
      ]),
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].candidateId).toBe("c1");
    expect(result.candidates[0].passages).toHaveLength(2);
    expect(result.candidates[1].candidateName).toBe("Daniel Osei");
  });

  it("preserves the backend's ordering of first appearance", () => {
    const result = toEvidenceSearchResult(
      response([
        hit("c2", "second candidate first", { candidateName: "Daniel Osei" }),
        hit("c1", "first candidate second"),
      ]),
    );

    expect(result.candidates.map((c) => c.candidateId)).toEqual(["c2", "c1"]);
  });

  it("carries the source of every passage so a citation can be opened", () => {
    const [candidate] = toEvidenceSearchResult(
      response([hit("c1", "Ran Kubernetes.", { pageNumber: 3, section: "Experience" })]),
    ).candidates;

    expect(candidate.passages[0]).toMatchObject({
      documentId: "d1",
      documentName: "aziz.pdf",
      page: 3,
      section: "Experience",
    });
  });

  it("never exposes a relevance score in the view model", () => {
    const result = toEvidenceSearchResult(response([hit("c1", "Kubernetes.")]));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("retrievalScore");
    expect(serialized).not.toContain("rerankScore");
    expect(serialized).not.toContain("relevance");
    expect(serialized).not.toContain("0.91");
  });

  it("drops passages that cannot be attributed to a candidate", () => {
    const result = toEvidenceSearchResult(
      response([hit(null, "orphaned passage"), hit("c1", "Kubernetes.")]),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].candidateId).toBe("c1");
  });

  it("returns no candidates when nothing matched, rather than inventing one", () => {
    const result = toEvidenceSearchResult(response([]));
    expect(result.candidates).toEqual([]);
    expect(result.totalConsidered).toBe(40);
  });
});

describe("aiReadiness", () => {
  it("is ready as soon as one document is indexed", () => {
    // The AI service reads what is indexed; a sibling failure does not hide it.
    expect(
      aiReadiness([{ status: "COMPLETED" }, { status: "FAILED" }]),
    ).toBe("ready");
    expect(
      aiReadiness([{ status: "COMPLETED" }, { status: "EMBEDDING" }]),
    ).toBe("ready");
  });

  it("reports no documents separately from a failure", () => {
    expect(aiReadiness([])).toBe("no_documents");
  });

  it("prefers `processing` while anything is still moving", () => {
    expect(aiReadiness([{ status: "FAILED" }, { status: "PARSING" }])).toBe(
      "processing",
    );
    expect(aiReadiness([{ status: "QUEUED" }])).toBe("processing");
  });

  it("reports failure only when every document failed", () => {
    expect(aiReadiness([{ status: "FAILED" }, { status: "FAILED" }])).toBe(
      "failed",
    );
  });

  it("stays stricter than the headline badge on purpose", () => {
    const documents = [{ status: "COMPLETED" as const }, { status: "FAILED" as const }];
    // The badge warns about the failure; the panels still work.
    expect(aggregateDocumentStatus(documents)).toBe("FAILED");
    expect(aiReadiness(documents)).toBe("ready");
  });
});

/**
 * Backward compatibility at the wire boundary.
 *
 * The list endpoint omits the structured long tail, and every vacancy created
 * before the structured model has those columns unset. Both arrive here as
 * "absent", and both must come out as "not stated" — never as a value.
 */
describe("toVacancy — vacancies without a structured profile", () => {
  const legacyPayload = {
    id: "v1",
    organizationId: "org",
    title: "Frontend Engineer",
    department: "Engineering",
    location: "Seoul",
    employmentType: "Full-time",
    description: "…",
    experienceLevel: "Mid-level",
    status: "OPEN" as const,
    createdById: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("maps a payload with no structured fields at all", () => {
    const vacancy = toVacancy(legacyPayload);

    expect(vacancy.salaryMin).toBeNull();
    expect(vacancy.workMode).toBeNull();
    expect(vacancy.seniorityLevel).toBeNull();
    // Absent arrays become empty arrays, so `.map()` on a list page is safe.
    expect(vacancy.benefits).toEqual([]);
    expect(vacancy.eligibleVisaTypes).toEqual([]);
    expect(vacancy.languages).toEqual([]);
    // The legacy free-text location survives untouched.
    expect(vacancy.location).toBe("Seoul");
  });

  it("defaults the two non-null columns to their 'nothing claimed' values", () => {
    const vacancy = toVacancy(legacyPayload);

    // Not "no": an employer who said nothing has not refused sponsorship.
    expect(vacancy.visaSponsorship).toBe("UNKNOWN");
    expect(vacancy.citizenshipRequirement).toBe("NONE");
    expect(vacancy.foreignApplicantsAccepted).toBeNull();
    expect(vacancy.salaryNegotiable).toBe(false);
  });

  it("carries a fully specified profile through unchanged", () => {
    const vacancy = toVacancy({
      ...legacyPayload,
      salaryMin: 55_000_000,
      salaryMax: 70_000_000,
      currency: "KRW",
      payPeriod: "YEARLY",
      country: "KR",
      city: "Seoul",
      workMode: "HYBRID",
      officeDaysPerWeek: 2,
      visaSponsorship: "YES",
      eligibleVisaTypes: ["E-7"],
      seniorityLevel: "SENIOR",
      benefits: ["HEALTH_INSURANCE"],
      languages: [{ languageCode: "ko", level: "B1", required: true }],
    });

    expect(vacancy).toMatchObject({
      salaryMin: 55_000_000,
      currency: "KRW",
      workMode: "HYBRID",
      officeDaysPerWeek: 2,
      visaSponsorship: "YES",
      seniorityLevel: "SENIOR",
    });
    expect(vacancy.languages).toEqual([
      { languageCode: "ko", level: "B1", required: true },
    ]);
  });
});

/**
 * Candidate job preferences at the wire boundary.
 *
 * The adapter's job is to preserve the difference between "did not say" and a
 * value — the distinction the whole preference model rests on.
 */
describe("toJobPreferences", () => {
  const empty = {
    stated: false,
    preferredJobTitles: [],
    preferredLocations: [],
    preferredWorkModes: [],
    preferredEmploymentTypes: [],
    preferredSeniorityLevels: [],
    desiredSalaryMin: null,
    salaryCurrency: null,
    payPeriod: null,
    willingToRelocate: null,
    preferredIndustries: [],
    preferredBenefits: [],
    excludedCompanies: [],
    excludedJobTitles: [],
    excludedLocations: [],
    createdAt: null,
    updatedAt: null,
  };

  it("keeps a candidate who has stated nothing recognisable as such", () => {
    const preferences = toJobPreferences(empty);

    expect(preferences.stated).toBe(false);
    // Not zero and not false — the two mistakes this model exists to avoid.
    expect(preferences.desiredSalaryMin).toBeNull();
    expect(preferences.willingToRelocate).toBeNull();
    expect(preferences.preferredWorkModes).toEqual([]);
  });

  it("preserves an explicit false as false, not as unstated", () => {
    expect(
      toJobPreferences({ ...empty, stated: true, willingToRelocate: false })
        .willingToRelocate,
    ).toBe(false);
  });

  it("carries a fully stated profile through unchanged", () => {
    const preferences = toJobPreferences({
      ...empty,
      stated: true,
      preferredJobTitles: ["DevOps Engineer"],
      preferredLocations: [{ countryCode: "KR", region: null, city: "Seoul" }],
      preferredWorkModes: ["REMOTE"],
      preferredEmploymentTypes: ["FULL_TIME"],
      desiredSalaryMin: 50_000_000,
      salaryCurrency: "KRW",
      payPeriod: "YEARLY",
      willingToRelocate: true,
      excludedCompanies: ["Company X"],
      updatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(preferences).toMatchObject({
      stated: true,
      preferredJobTitles: ["DevOps Engineer"],
      preferredWorkModes: ["REMOTE"],
      preferredEmploymentTypes: ["FULL_TIME"],
      desiredSalaryMin: 50_000_000,
      salaryCurrency: "KRW",
      willingToRelocate: true,
      excludedCompanies: ["Company X"],
    });
    expect(preferences.preferredLocations).toEqual([
      { countryCode: "KR", region: null, city: "Seoul" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  toAiCitation,
  toCandidateSummary,
  toEvidenceMap,
  toEvidenceMapCitation,
  toEvidenceStatus,
  toGroundedAnswer,
  toInterviewQuestionSet,
} from "@/lib/api/adapters";
import type {
  AiAnswerResponse,
  AiCandidateSummaryResponse,
  AiCitationResponse,
  AiInterviewQuestionsResponse,
  EvidenceMapResponse,
} from "@/lib/api/contracts";

const citation: AiCitationResponse = {
  chunkId: "chunk-1",
  documentId: "doc-1",
  fileName: "resume.pdf",
  pageNumber: 2,
  section: "Experience",
  text: "Ran production Kubernetes clusters and owned the on-call rotation.",
};

describe("toAiCitation", () => {
  it("keeps the backend's page number rather than deriving one", () => {
    expect(toAiCitation(citation).page).toBe(2);
    expect(toAiCitation({ ...citation, pageNumber: null }).page).toBeNull();
  });

  it("keys on the chunk id so a citation traces back to its indexed passage", () => {
    const result = toAiCitation(citation);
    expect(result.id).toBe("chunk-1");
    expect(result.chunkId).toBe("chunk-1");
    expect(result.documentId).toBe("doc-1");
    expect(result.documentName).toBe("resume.pdf");
    expect(result.section).toBe("Experience");
    expect(result.snippet).toContain("Kubernetes");
  });

  it("leaves a missing filename null instead of inventing one", () => {
    expect(toAiCitation({ ...citation, fileName: null }).documentName).toBeNull();
  });
});

describe("toEvidenceMapCitation", () => {
  it("uses the stored evidence row id and keeps the source chunk id", () => {
    const result = toEvidenceMapCitation({
      id: "evidence-9",
      documentId: "doc-1",
      fileName: "resume.pdf",
      pageNumber: 3,
      section: null,
      text: "Built the deployment pipeline.",
      sourceChunkId: "chunk-7",
    });

    expect(result.id).toBe("evidence-9");
    expect(result.chunkId).toBe("chunk-7");
    expect(result.page).toBe(3);
  });
});

describe("toGroundedAnswer", () => {
  const response: AiAnswerResponse = {
    answer: "They ran Kubernetes in production.",
    status: "GROUNDED",
    citations: [citation],
    locale: "ko",
    rejectedCitations: ["bogus-1", "bogus-2"],
    evidenceConsidered: 8,
    durationMs: 1234,
    model: "test-model",
  };

  it("maps every field the backend returns", () => {
    const result = toGroundedAnswer(response);
    expect(result.answer).toBe("They ran Kubernetes in production.");
    expect(result.status).toBe("GROUNDED");
    expect(result.locale).toBe("ko");
    expect(result.evidenceConsidered).toBe(8);
    expect(result.durationMs).toBe(1234);
    expect(result.model).toBe("test-model");
    expect(result.citations).toHaveLength(1);
  });

  it("reduces rejected chunk ids to a count", () => {
    // Chunk ids mean nothing to a recruiter; that filtering happened does.
    expect(toGroundedAnswer(response).rejectedCitationCount).toBe(2);
  });

  it("carries an insufficient-evidence answer through as a real result", () => {
    const result = toGroundedAnswer({
      ...response,
      status: "INSUFFICIENT_EVIDENCE",
      citations: [],
      answer: "",
    });
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.citations).toEqual([]);
  });
});

describe("toCandidateSummary", () => {
  it("maps the summary, its status and its citations", () => {
    const response: AiCandidateSummaryResponse = {
      summary: "Backend engineer with distributed-systems experience.",
      status: "NEEDS_HUMAN_REVIEW",
      citations: [citation],
      locale: "ru",
      rejectedCitations: [],
      durationMs: 900,
      model: null,
    };

    const result = toCandidateSummary(response);
    expect(result.summary).toContain("Backend engineer");
    expect(result.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(result.locale).toBe("ru");
    expect(result.model).toBeNull();
    expect(result.rejectedCitationCount).toBe(0);
    expect(result.citations[0].chunkId).toBe("chunk-1");
  });
});

describe("toInterviewQuestionSet", () => {
  const response: AiInterviewQuestionsResponse = {
    candidateId: "cand-1",
    vacancyId: "vac-1",
    locale: "uz",
    durationMs: 500,
    model: "test-model",
    questions: [
      {
        question: "Walk me through the on-call rotation you owned.",
        reason: "The resume mentions it without detail.",
        kind: "evidence_probe",
        requirementId: "req-1",
        citations: [citation],
      },
      {
        question: "Have you worked with AWS?",
        reason: "No passage mentions AWS.",
        kind: "missing_requirement_probe",
        requirementId: "req-2",
        citations: [],
      },
      {
        question: "Tell me about a rollback you ran.",
        reason: "Follow-up on the same requirement.",
        kind: "evidence_probe",
        requirementId: "req-1",
        citations: [],
      },
    ],
  };

  it("preserves both question kinds", () => {
    const result = toInterviewQuestionSet(response);
    expect(result.questions.map((q) => q.kind)).toEqual([
      "evidence_probe",
      "missing_requirement_probe",
      "evidence_probe",
    ]);
  });

  it("derives a unique key even for two probes on one requirement", () => {
    const ids = toInterviewQuestionSet(response).questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps reason and citations per question", () => {
    const result = toInterviewQuestionSet(response);
    expect(result.questions[0].reason).toContain("without detail");
    expect(result.questions[0].citations).toHaveLength(1);
    expect(result.questions[1].citations).toEqual([]);
    expect(result.locale).toBe("uz");
  });
});

describe("toEvidenceStatus", () => {
  it("maps each backend status one-to-one", () => {
    expect(toEvidenceStatus("EVIDENCE_FOUND")).toBe("FOUND");
    expect(toEvidenceStatus("NO_EVIDENCE_FOUND")).toBe("NOT_FOUND");
    expect(toEvidenceStatus("NEEDS_HUMAN_REVIEW")).toBe("NEEDS_REVIEW");
  });

  it("distinguishes a requirement nobody has checked from one with no evidence", () => {
    expect(toEvidenceStatus(null)).toBe("NOT_RUN");
    expect(toEvidenceStatus(null)).not.toBe("NOT_FOUND");
  });
});

describe("toEvidenceMap", () => {
  const response: EvidenceMapResponse = {
    candidate: { id: "cand-1", fullName: "Aziza Rakhimova" },
    vacancy: { id: "vac-1", title: "Senior Backend Engineer" },
    requirements: [
      {
        requirement: { id: "req-1", text: "NestJS", type: "SKILL", required: true },
        status: "EVIDENCE_FOUND",
        reason: "Named in the experience section.",
        matchedTerms: ["NestJS"],
        missingTerms: [],
        mappedAt: "2026-08-19T10:00:00.000Z",
        evidence: [
          {
            id: "ev-1",
            documentId: "doc-1",
            fileName: "resume.pdf",
            pageNumber: 2,
            section: "Experience",
            text: "Built services with NestJS.",
            sourceChunkId: "chunk-3",
          },
        ],
      },
      {
        requirement: {
          id: "req-2",
          text: "Kubernetes",
          type: "SKILL",
          required: true,
        },
        status: "NO_EVIDENCE_FOUND",
        reason: "No passage mentions it.",
        matchedTerms: [],
        missingTerms: ["Kubernetes"],
        mappedAt: "2026-08-20T09:00:00.000Z",
        evidence: [],
      },
      {
        requirement: { id: "req-3", text: "AWS", type: "SKILL", required: false },
        status: null,
        reason: null,
        matchedTerms: [],
        missingTerms: [],
        mappedAt: null,
        evidence: [],
      },
    ],
  };

  it("lists every requirement, mapped or not", () => {
    const result = toEvidenceMap(response);
    expect(result.requirements).toHaveLength(3);
    expect(result.requirements.map((r) => r.status)).toEqual([
      "FOUND",
      "NOT_FOUND",
      "NOT_RUN",
    ]);
  });

  it("carries candidate and vacancy identity", () => {
    const result = toEvidenceMap(response);
    expect(result.candidateId).toBe("cand-1");
    expect(result.candidateName).toBe("Aziza Rakhimova");
    expect(result.vacancyId).toBe("vac-1");
    expect(result.vacancyTitle).toBe("Senior Backend Engineer");
  });

  it("keeps matched and missing terms and the backend's reason", () => {
    const [nestjs, kubernetes] = toEvidenceMap(response).requirements;
    expect(nestjs.matchedTerms).toEqual(["NestJS"]);
    expect(kubernetes.missingTerms).toEqual(["Kubernetes"]);
    expect(kubernetes.reason).toBe("No passage mentions it.");
  });

  it("reports the most recent mapping time", () => {
    expect(toEvidenceMap(response).mappedAt).toBe("2026-08-20T09:00:00.000Z");
  });

  it("treats a map with at least one stored status as having run", () => {
    expect(toEvidenceMap(response).hasRun).toBe(true);
  });

  it("treats a map with no stored status at all as never run", () => {
    const never = toEvidenceMap({
      ...response,
      requirements: response.requirements.map((entry) => ({
        ...entry,
        status: null,
        mappedAt: null,
      })),
    });
    expect(never.hasRun).toBe(false);
    expect(never.mappedAt).toBeNull();
  });

  it("exposes no overall score, percentage or verdict", () => {
    const result = toEvidenceMap(response) as unknown as Record<string, unknown>;
    for (const forbidden of ["score", "fit", "percentage", "rank", "recommendation"]) {
      expect(Object.keys(result)).not.toContain(forbidden);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  isEmptyCoverLetter,
  isEmptyInterviewPrep,
  toExternalCoverLetter,
  toExternalInterviewPrep,
} from "@/lib/api/external-jobs-adapters";
import type {
  ExternalCoverLetterResponse,
  ExternalInterviewPrepResponse,
} from "@/lib/api/contracts";

/**
 * Narrowing the other two generated documents.
 *
 * Same discipline as the why-match adapter, and for the same reason: the shape
 * is a convention rather than a schema, and the content is untrusted prose.
 */

const LETTER: ExternalCoverLetterResponse = {
  jobId: "job-1",
  version: "external-cover-letter-v1",
  locale: "en",
  subject: "Application for Senior Backend Engineer",
  content: "Dear Hiring Team,\n\nI have six years of backend experience.\n\nRegards,\nAlex",
  cached: true,
  generatedAt: "2026-08-24T09:00:00.000Z",
};

const PREP: ExternalInterviewPrepResponse = {
  jobId: "job-1",
  version: "external-interview-prep-v1",
  locale: "en",
  questions: [
    {
      question: "How would you design a rate limiter?",
      whyAsked: "The role owns a public API.",
      preparation: "Revise token bucket and sliding window.",
    },
    { question: "Tell us about a rollback you led.", whyAsked: "", preparation: "" },
  ],
  focusAreas: [{ title: "Kubernetes", guidance: "Listed as preferred, not required." }],
  cached: false,
  generatedAt: "2026-08-24T09:00:00.000Z",
};

describe("cover letter", () => {
  it("carries subject and body through unchanged", () => {
    const result = toExternalCoverLetter("job-1", LETTER);
    expect(result.subject).toBe(LETTER.subject);
    expect(result.content).toBe(LETTER.content);
    expect(result.version).toBe("external-cover-letter-v1");
    expect(isEmptyCoverLetter(result)).toBe(false);
  });

  it("uses the id that was asked about, not the one the body claims", () => {
    // A letter rendered under the wrong job is a letter sent to the wrong
    // employer.
    expect(toExternalCoverLetter("job-1", { ...LETTER, jobId: "job-999" }).externalJobId).toBe(
      "job-1",
    );
  });

  it("drops the cache flag rather than surfacing it", () => {
    const result = toExternalCoverLetter("job-1", LETTER) as unknown as Record<string, unknown>;
    expect(result.cached).toBeUndefined();
  });

  it("treats a subject with no body as no letter", () => {
    // The body is what makes it a letter; a subject alone is not one.
    const result = toExternalCoverLetter("job-1", { ...LETTER, content: "   " });
    expect(result.content).toBeNull();
    expect(isEmptyCoverLetter(result)).toBe(true);
  });

  it("keeps a body that has no subject", () => {
    const result = toExternalCoverLetter("job-1", { ...LETTER, subject: null });
    expect(result.subject).toBeNull();
    expect(isEmptyCoverLetter(result)).toBe(false);
  });

  it("truncates a runaway generation instead of refusing it", () => {
    const result = toExternalCoverLetter("job-1", {
      ...LETTER,
      content: "x".repeat(50_000),
    });
    expect(result.content?.length).toBeLessThanOrEqual(12_000);
  });

  it("passes markup through as text, unchanged", () => {
    const nasty = '<script>alert(1)</script>';
    const result = toExternalCoverLetter("job-1", { ...LETTER, subject: nasty, content: nasty });
    expect(result.subject).toBe(nasty);
    expect(result.content).toBe(nasty);
  });

  it("survives an absent body", () => {
    for (const body of [null, undefined, {} as ExternalCoverLetterResponse]) {
      const result = toExternalCoverLetter("job-1", body);
      expect(result.content).toBeNull();
      expect(isEmptyCoverLetter(result)).toBe(true);
    }
  });
});

describe("interview prep", () => {
  it("carries questions and focus areas through", () => {
    const result = toExternalInterviewPrep("job-1", PREP);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toEqual({
      question: "How would you design a rate limiter?",
      whyAsked: "The role owns a public API.",
      preparation: "Revise token bucket and sliding window.",
    });
    // `{title, guidance}` on the wire becomes the same AiInsight strengths use.
    expect(result.focusAreas).toEqual([
      { title: "Kubernetes", explanation: "Listed as preferred, not required." },
    ]);
  });

  it("keeps a question whose notes are empty", () => {
    // The notes are commentary; the question stands on its own.
    const result = toExternalInterviewPrep("job-1", PREP);
    expect(result.questions[1]).toEqual({
      question: "Tell us about a rollback you led.",
      whyAsked: "",
      preparation: "",
    });
  });

  it("drops an item with no question text", () => {
    const result = toExternalInterviewPrep("job-1", {
      ...PREP,
      questions: [
        { whyAsked: "orphaned note", preparation: "no question" },
        { question: "  ", whyAsked: "blank" },
        { question: "Real one" },
      ],
    });
    expect(result.questions).toEqual([
      { question: "Real one", whyAsked: "", preparation: "" },
    ]);
  });

  it("drops a focus area with no title", () => {
    const result = toExternalInterviewPrep("job-1", {
      ...PREP,
      focusAreas: [{ guidance: "orphaned" }, { title: "Kept", guidance: "" }],
    });
    expect(result.focusAreas).toEqual([{ title: "Kept", explanation: "" }]);
  });

  it("allows empty focus areas — the section simply will not render", () => {
    for (const focusAreas of [[], null, undefined]) {
      const result = toExternalInterviewPrep("job-1", {
        ...PREP,
        focusAreas: focusAreas as ExternalInterviewPrepResponse["focusAreas"],
      });
      expect(result.focusAreas).toEqual([]);
      // Still real prep: the questions are what the reader asked for.
      expect(isEmptyInterviewPrep(result)).toBe(false);
    }
  });

  it("treats focus areas with no questions as nothing", () => {
    // The reader pressed the button for questions. A panel without them reads
    // as broken rather than as sparse.
    const result = toExternalInterviewPrep("job-1", { ...PREP, questions: [] });
    expect(isEmptyInterviewPrep(result)).toBe(true);
  });

  it("caps a runaway list", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ question: `Q${i}` }));
    const result = toExternalInterviewPrep("job-1", { ...PREP, questions: many });
    expect(result.questions.length).toBeLessThanOrEqual(12);
  });

  it("never produces a score, readiness or percentage", () => {
    const result = toExternalInterviewPrep("job-1", {
      ...PREP,
      ...({ readiness: 0.7, score: 88 } as object),
    });
    for (const forbidden of ["readiness", "score", "confidence"]) {
      expect(Object.keys(result)).not.toContain(forbidden);
    }
  });

  it("survives an absent body", () => {
    for (const body of [null, undefined, {} as ExternalInterviewPrepResponse]) {
      const result = toExternalInterviewPrep("job-1", body);
      expect(result.questions).toEqual([]);
      expect(result.focusAreas).toEqual([]);
      expect(isEmptyInterviewPrep(result)).toBe(true);
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { toJobMatchResult, toCompareInsights, toHrMatchInsight } from "@/lib/api/adapters";
import { hasAdvancedDetail, mustHaveGapCount } from "@/lib/match/insight";
import {
  dimensionBarWidth,
  eligibilityPresentation,
  formatDelta,
  priorityPresentation,
  requirementStatusPresentation,
} from "@/lib/match/presentation";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

/**
 * The advanced match contract, as the frontend reads and draws it.
 *
 * Two properties matter most and are pinned hardest: the browser never
 * computes an authoritative number, and an absent analysis is absent rather
 * than zero.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/**
 * Source with comments stripped.
 *
 * Assertions about what the CODE does must not be satisfied — or broken — by
 * prose explaining it. This file's own doc comments discuss `<table>` and
 * `NODE_ENV`; only the executable text should be searched for them.
 */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** A match row carrying the full advanced payload, shaped as the API sends it. */
function advancedRow() {
  return {
    vacancy: {
      slug: "platform-engineer",
      title: "Platform Engineer",
      organizationName: "Acme",
      location: "Seoul",
      employmentType: "Full-time",
      status: "OPEN",
    },
    match: "STRONG",
    band: "STRONG",
    rank: 1,
    score: 73,
    capabilityScore: 73,
    intentScore: null,
    signals: {},
    matchedSkills: ["Kubernetes"],
    missingSkills: ["Terraform"],
    explanation: "Prose from the model.",
    supportedRequirements: [],
    unsupportedRequirements: [],
    unclearRequirements: [],
    evidence: [],
    saved: false,
    applicationState: null,
    insightVersion: "advanced-match-v1",
    eligibility: "PARTIAL",
    eligibilityReasons: [
      { code: "MUST_HAVE_EVIDENCE_GAPS", detail: "Some must-have requirements lack current evidence." },
    ],
    evidenceConfidence: 67,
    evidenceConfidenceBreakdown: {
      sources: 15,
      volume: 12,
      coverage: 20,
      profileCompleteness: 10,
      consistency: 10,
    },
    dimensions: [
      { key: "mustHaveSkills", labelKey: "match.dimension.mustHaveSkills", score: 24, max: 30, normalizedScore: 0.8 },
      // max 0 cannot be drawn as score/max and must be dropped, not guessed.
      { key: "brokenDimension", labelKey: "match.dimension.brokenDimension", score: 3, max: 0 },
    ],
    requirementMatrix: [
      {
        requirementId: "req-1",
        text: "Kubernetes",
        priority: "MUST_HAVE",
        status: "STRONG",
        scoreContribution: 1,
        evidenceCount: 3,
        evidenceRefs: [
          { sourceKind: "FILE", fileName: "cv.pdf", pageNumber: 2, section: "Experience", snippet: "Ran EKS clusters", sourceUrl: null },
        ],
        transferable: null,
        reason: "Evidenced by three independent current sources.",
      },
      {
        requirementId: "req-2",
        text: "Terraform",
        priority: "MUST_HAVE",
        status: "MISSING",
        scoreContribution: 0,
        evidenceCount: 0,
        evidenceRefs: [],
        transferable: null,
        reason: "No current evidence found.",
      },
      {
        requirementId: "req-3",
        text: "Kafka",
        priority: "NICE_TO_HAVE",
        status: "PARTIAL",
        scoreContribution: 0.45,
        evidenceCount: 1,
        evidenceRefs: [],
        transferable: { sourceSkill: "RabbitMQ", relation: "messaging" },
        reason: "Covered only by a related messaging technology.",
      },
    ],
    transferableSkills: [
      {
        sourceSkill: "RabbitMQ",
        targetRequirement: "Kafka",
        targetSkill: "Kafka",
        credit: 0.45,
        relation: "messaging",
        reason: "Both are message brokers.",
        evidenceRefs: [],
      },
    ],
    contradictions: [
      {
        kind: "EXPERIENCE_YEARS_CLAIM",
        summary: "Conflicting evidence detected about years of experience.",
        sourceA: "Profile: 8 years",
        sourceB: "cv.pdf: 5 years",
        confidencePenalty: 4,
      },
    ],
    careerTrajectory: { status: "ALIGNED", score: 0.7, reasons: ["Titles progress steadily."] },
    scoreChange: { previous: 71, current: 73, delta: 2, reasons: ["+ now evidenced: Kubernetes"] },
    improvementSuggestions: [
      { requirementId: "req-2", type: "ADD_MUST_HAVE_EVIDENCE", text: "Add evidence of Terraform.", impactRank: 2 },
      { requirementId: null, type: "ADD_INDEPENDENT_SOURCE", text: "Add a second source.", impactRank: 1 },
    ],
  };
}

function parse(row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toJobMatchResult({ matches: [row], locale: "en", generated: true, generatedAt: "2026-08-26T00:00:00.000Z", evidenceRevision: 3, explanationsPending: false, page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false, totalEligible: 1, totalExcluded: 0 } as any).matches[0];
}

describe("advanced contract rendering", () => {
  it("reads every advanced field off the row", () => {
    const insight = parse(advancedRow()).insight;
    expect(insight).not.toBeNull();
    expect(insight?.version).toBe("advanced-match-v1");
    expect(insight?.context).toBe("CANDIDATE");
    expect(insight?.requirementMatrix).toHaveLength(3);
    expect(insight?.transferableSkills).toHaveLength(1);
    expect(insight?.contradictions).toHaveLength(1);
  });

  it("preserves the legacy fields alongside it", () => {
    const match = parse(advancedRow());
    expect(match.score).toBe(73);
    expect(match.band).toBe("STRONG");
    expect(match.explanation).toBe("Prose from the model.");
    expect(match.matchedSkills).toEqual(["Kubernetes"]);
  });
});

describe("null advanced fields fall back", () => {
  it("yields a null insight when the engine did not run", () => {
    const row = { ...advancedRow() } as Record<string, unknown>;
    row.insightVersion = undefined;
    const match = parse(row);
    expect(match.insight).toBeNull();
    // §17: a legacy row still carries its own score. Null analysis is not 0.
    expect(match.score).toBe(73);
  });

  it("does not draw the panel for an insight with nothing in it", () => {
    expect(hasAdvancedDetail(null)).toBe(false);
    const empty = parse({
      ...advancedRow(),
      eligibilityReasons: [],
      dimensions: [],
      requirementMatrix: [],
      transferableSkills: [],
      contradictions: [],
      careerTrajectory: { status: "UNKNOWN", score: null, reasons: [] },
      scoreChange: null,
      improvementSuggestions: [],
    }).insight;
    expect(hasAdvancedDetail(empty)).toBe(false);
  });
});

describe("eligibility", () => {
  it("carries the state and its reasons", () => {
    const insight = parse(advancedRow()).insight!;
    expect(insight.eligibility).toBe("PARTIAL");
    expect(insight.eligibilityReasons[0].detail).toContain("must-have");
  });

  it("gives every state a word and a glyph, not only a colour", () => {
    for (const state of ["ELIGIBLE", "PARTIAL", "BLOCKED"] as const) {
      const presentation = eligibilityPresentation(state);
      expect(presentation.labelKey.length, state).toBeGreaterThan(0);
      expect(presentation.glyph.length, state).toBeGreaterThan(0);
    }
  });
});

describe("evidence confidence", () => {
  it("passes the value and its breakdown through untouched", () => {
    const insight = parse(advancedRow()).insight!;
    expect(insight.evidenceConfidence).toBe(67);
    expect(insight.evidenceConfidenceBreakdown.coverage).toBe(20);
  });

  it("says it is not a probability, in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.matchInsight.confidenceHelp.trim(), locale).not.toBe("");
    }
    // The English wording is the one the spec fixes verbatim.
    const en = ALL_DICTIONARIES.find((entry) => entry.locale === "en")!;
    expect(en.dictionary.matchInsight.confidenceHelp).toContain("not a probability");
  });
});

describe("dimensions", () => {
  it("keeps the backend's score and max", () => {
    const dimensions = parse(advancedRow()).insight!.dimensions;
    expect(dimensions[0].score).toBe(24);
    expect(dimensions[0].max).toBe(30);
  });

  it("drops a dimension that has no usable denominator", () => {
    const dimensions = parse(advancedRow()).insight!.dimensions;
    expect(dimensions.map((dimension) => dimension.key)).toEqual(["mustHaveSkills"]);
  });

  it("derives only a bar width, never a score", () => {
    expect(dimensionBarWidth(24, 30)).toBe("80%");
    expect(dimensionBarWidth(3, 0)).toBe("0%");
    expect(dimensionBarWidth(40, 30)).toBe("100%");
  });
});

describe("requirement matrix", () => {
  it("carries priority, status, evidence count and refs", () => {
    const rows = parse(advancedRow()).insight!.requirementMatrix;
    expect(rows[0]).toMatchObject({ priority: "MUST_HAVE", status: "STRONG", evidenceCount: 3 });
    expect(rows[0].evidenceRefs[0].fileName).toBe("cv.pdf");
    expect(rows[1]).toMatchObject({ priority: "MUST_HAVE", status: "MISSING", evidenceCount: 0 });
    expect(rows[2].priority).toBe("NICE_TO_HAVE");
  });

  it("counts must-have gaps the way HR reads them", () => {
    expect(mustHaveGapCount(parse(advancedRow()).insight)).toBe(1);
  });

  it("gives every status a word and a glyph", () => {
    for (const status of ["STRONG", "MATCH", "PARTIAL", "MISSING", "BLOCKED"] as const) {
      const presentation = requirementStatusPresentation(status);
      expect(presentation.glyph.length, status).toBeGreaterThan(0);
      expect(presentation.labelKey.length, status).toBeGreaterThan(0);
    }
    for (const priority of ["MUST_HAVE", "NICE_TO_HAVE"] as const) {
      expect(priorityPresentation(priority).glyph.length, priority).toBeGreaterThan(0);
    }
  });

  it("never paints a missing requirement as an error", () => {
    // An absence of evidence is not a fault of the candidate, so MISSING is
    // neutral. BLOCKED — a real conflict — is the only critical tone.
    expect(requirementStatusPresentation("MISSING").tone).toBe("neutral");
    expect(requirementStatusPresentation("BLOCKED").tone).toBe("critical");
  });

  it("words a missing requirement as being about the documents", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.matchInsight.noCurrentEvidence.trim(), locale).not.toBe("");
    }
    const en = ALL_DICTIONARIES.find((entry) => entry.locale === "en")!;
    expect(en.dictionary.matchInsight.noCurrentEvidence).toBe("No current evidence found");
    // The phrasing the spec forbids must not appear anywhere in the block.
    const block = JSON.stringify(en.dictionary.matchInsight).toLowerCase();
    expect(block).not.toContain("does not know");
    expect(block).not.toContain("cannot do");
  });
});

describe("transferable evidence", () => {
  it("is kept distinct from a direct match", () => {
    const insight = parse(advancedRow()).insight!;
    expect(insight.transferableSkills[0]).toMatchObject({
      sourceSkill: "RabbitMQ",
      targetRequirement: "Kafka",
      credit: 0.45,
    });
    // Credit is below a direct match's, and the row it covers is not STRONG.
    expect(insight.transferableSkills[0].credit).toBeLessThan(0.9);
    const covered = insight.requirementMatrix.find((row) => row.text === "Kafka")!;
    expect(covered.status).toBe("PARTIAL");
    expect(covered.transferable).not.toBeNull();
  });

  it("is not styled like direct evidence", () => {
    const source = code("components/match/MatchInsightSections.tsx");
    // The transferable card is info-toned; positive is reserved for the
    // matrix's STRONG/MATCH so the two never look alike.
    expect(source).toContain("border-info/20");
    expect(source).not.toContain("bg-positive-soft");
  });
});

describe("contradictions", () => {
  it("carries a neutral summary and both sources", () => {
    const contradiction = parse(advancedRow()).insight!.contradictions[0];
    expect(contradiction.summary).toContain("Conflicting evidence");
    expect(contradiction.sourceA).toBe("Profile: 8 years");
    expect(contradiction.sourceB).toBe("cv.pdf: 5 years");
  });

  it("is toned as a warning, never as an accusation", () => {
    const source = code("components/match/MatchInsightSections.tsx");
    expect(source).toContain("border-warning/20");
    const en = ALL_DICTIONARIES.find((entry) => entry.locale === "en")!;
    const block = JSON.stringify(en.dictionary.matchInsight).toLowerCase();
    for (const word of ["dishonest", "lying", "lied", "false claim"]) {
      expect(block, word).not.toContain(word);
    }
  });
});

describe("career trajectory", () => {
  it("passes status, score and reasons through", () => {
    const trajectory = parse(advancedRow()).insight!.careerTrajectory;
    expect(trajectory).toMatchObject({ status: "ALIGNED", score: 0.7 });
    expect(trajectory.reasons).toHaveLength(1);
  });

  it("is not rendered when the backend could not read one", () => {
    const source = code("components/match/MatchInsightSections.tsx");
    expect(source).toContain('trajectory.status === "UNKNOWN"');
  });
});

describe("score change", () => {
  it("reports the previous score, current score and delta", () => {
    const change = parse(advancedRow()).insight!.scoreChange!;
    expect(change).toMatchObject({ previous: 71, current: 73, delta: 2 });
    expect(formatDelta(change.delta)).toBe("+2");
    expect(formatDelta(-3)).toBe("-3");
  });

  it("stays null when there is no earlier ranking", () => {
    const insight = parse({ ...advancedRow(), scoreChange: null }).insight!;
    expect(insight.scoreChange).toBeNull();
    // No fabricated history: the section returns nothing rather than 0 -> 73.
    const source = code("components/match/MatchInsightSections.tsx");
    expect(source).toContain("if (!scoreChange) return null;");
  });
});

describe("improvement suggestions", () => {
  it("orders by impactRank", () => {
    const suggestions = parse(advancedRow()).insight!.improvementSuggestions;
    expect(suggestions.map((suggestion) => suggestion.impactRank)).toEqual([1, 2]);
    expect(suggestions[0].text).toBe("Add a second source.");
  });

  it("promises nothing about the score", () => {
    const en = ALL_DICTIONARIES.find((entry) => entry.locale === "en")!;
    expect(en.dictionary.matchInsight.improveHint).toContain("does not guarantee");
  });

  it("is candidate-facing only", () => {
    // The shared panel takes an explicit opt-in, the HR panel never passes it.
    expect(code("components/candidate/MatchCard.tsx")).toContain("showImprovements");
    expect(code("components/candidates/HrMatchInsightPanel.tsx")).not.toContain(
      "showImprovements",
    );
  });
});

describe("HR candidate detail", () => {
  it("reads the nested insight and keeps the vacancy", () => {
    const hr = toHrMatchInsight({
      candidate: { id: "c1", fullName: "Ada" },
      vacancy: { id: "v1", title: "Platform Engineer", status: "OPEN" },
      score: 64,
      capabilityScore: 64,
      tier: "PARTIAL",
      band: "GOOD",
      matchedSkills: ["Kubernetes"],
      missingSkills: [],
      insight: {
        version: "advanced-match-v1",
        context: "HR",
        eligibility: "ELIGIBLE",
        eligibilityReasons: [],
        evidenceConfidence: 51,
        evidenceConfidenceBreakdown: { sources: 10, volume: 10, coverage: 15, profileCompleteness: 6, consistency: 10 },
        dimensions: [{ key: "mustHaveSkills", labelKey: "match.dimension.mustHaveSkills", score: 20, max: 30 }],
        requirementMatrix: [],
        transferableSkills: [],
        contradictions: [],
        careerTrajectory: { status: "UNKNOWN", score: null, reasons: [] },
        scoreChange: null,
        improvementSuggestions: [],
      },
      generatedAt: "2026-08-26T00:00:00.000Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(hr.vacancy.title).toBe("Platform Engineer");
    expect(hr.insight.context).toBe("HR");
    expect(hr.insight.dimensions[0].max).toBe(30);
  });

  it("discards the assessment when the vacancy changes", () => {
    // Keyed on the vacancy id, so vacancy A's numbers cannot survive under
    // vacancy B's heading.
    const workspace = code("components/candidates/CandidateWorkspace.tsx");
    expect(workspace).toContain("key={`insight-${selectedVacancy.id}`}");
    expect(workspace).toContain("vacancyId={selectedVacancy.id}");
  });
});

describe("HR compare", () => {
  const response = {
    vacancy: { id: "v1", title: "Platform Engineer", status: "OPEN" },
    candidates: [
      { candidateId: "c1", fullName: "Ada", score: 71, band: "GOOD", eligibility: "ELIGIBLE", evidenceConfidence: 62, mustHaveGapCount: 1, dimensions: [], error: null },
      { candidateId: "c2", fullName: "Grace", score: null, band: null, eligibility: null, evidenceConfidence: null, mustHaveGapCount: null, dimensions: [], error: "NO_CANDIDATE_EVIDENCE" },
    ],
    superlatives: {
      bestTechnicalMatch: { candidateId: "c1", fullName: "Ada", value: 71 },
      bestSeniorityFit: null,
      fewestMustHaveGaps: { candidateId: "c1", fullName: "Ada", value: 1 },
      highestEvidenceConfidence: { candidateId: "c1", fullName: "Ada", value: 62 },
    },
    generatedAt: "2026-08-26T00:00:00.000Z",
  };

  it("renders the backend's winners verbatim", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compare = toCompareInsights(response as any);
    expect(compare.superlatives.bestTechnicalMatch).toMatchObject({ fullName: "Ada", value: 71 });
    // A measure with fewer than two assessable candidates stays null rather
    // than being filled by picking a leader locally.
    expect(compare.superlatives.bestSeniorityFit).toBeNull();
  });

  it("keeps an unassessed candidate unassessed", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compare = toCompareInsights(response as any);
    const grace = compare.candidates.find((candidate) => candidate.fullName === "Grace")!;
    expect(grace.score).toBeNull();
    expect(grace.evidenceConfidence).toBeNull();
    expect(grace.error).toBe("NO_CANDIDATE_EVIDENCE");
  });

  it("does not pick winners in the browser", () => {
    const source = code("components/compare/CompareInsightsPanel.tsx");
    expect(source).not.toContain(".sort(");
    expect(source).not.toContain("Math.max(");
    expect(source).not.toContain("Math.min(");
  });
});

describe("no authoritative score is recomputed in the browser", () => {
  it("keeps arithmetic out of the rendering components", () => {
    for (const file of [
      "components/match/MatchInsightSummary.tsx",
      "components/match/MatchDimensions.tsx",
      "components/match/RequirementMatrix.tsx",
      "components/match/MatchInsightSections.tsx",
      "components/compare/CompareInsightsPanel.tsx",
    ]) {
      const source = code(file);
      // No summing, averaging or rescaling of backend numbers anywhere.
      expect(source, file).not.toMatch(/\breduce\(/);
      expect(source, file).not.toMatch(/Math\.(max|min|round)\(/);
    }
  });

  it("confines the one derived value to a bar width", () => {
    const source = code("lib/match/presentation.ts");
    expect(source).toContain("dimensionBarWidth");
    // The width is the only place score/max is divided.
    const divisions = source.match(/score \/ max/g) ?? [];
    expect(divisions).toHaveLength(1);
  });
});

describe("mobile layout", () => {
  it("stacks the matrix instead of scrolling a wide table", () => {
    const source = code("components/match/RequirementMatrix.tsx");
    // No table element, and the columns only appear from `sm` up.
    expect(source).not.toContain("<table");
    expect(source).toContain("sm:grid-cols-");
    expect(source).toContain("hidden");
    // Nothing may introduce a horizontal scroller.
    expect(source).not.toContain("overflow-x");
  });
});

describe("locales", () => {
  const KEYS = [
    "eligibility",
    "evidenceConfidence",
    "mustHave",
    "niceToHave",
    "strong",
    "match",
    "partial",
    "missing",
    "blocked",
    "transferableTitle",
    "contradictionsTitle",
    "trajectoryTitle",
    "scoreChangeTitle",
    "improveTitle",
    "noCurrentEvidence",
  ];

  it("translates every advanced heading in all four locales", () => {
    expect(ALL_DICTIONARIES).toHaveLength(4);
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const block = dictionary.matchInsight as unknown as Record<string, string>;
      for (const key of KEYS) {
        expect(block[key], `${locale}.${key}`).toBeTruthy();
        expect(block[key].trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("labels every dimension the backend can send", () => {
    const dimensionKeys = [
      "MustHaveSkills",
      "ExperienceDepth",
      "RoleSimilarity",
      "SeniorityFit",
      "ProjectEvidence",
      "LocationWorkMode",
      "LanguageFit",
      "NiceToHave",
    ];
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const block = dictionary.matchInsight as unknown as Record<string, string>;
      for (const key of dimensionKeys) {
        expect(block[`dimension${key}`], `${locale}.dimension${key}`).toBeTruthy();
      }
    }
  });
});

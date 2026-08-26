import {
  computeEvidenceConfidence,
  countIndependentEvidenceSources,
} from './evidence-confidence';
import { buildProfileFacts } from './profile-facts';
import { matrixFromChecks } from './requirement-matrix';

const richProfile = buildProfileFacts({
  headline: 'Backend Engineer',
  summary: 'APIs',
  location: null,
  skills: ['a', 'b', 'c'],
  languages: [],
  experience: [{ title: 'Engineer' }],
  education: [{ institution: 'X' }],
});

const sparseProfile = buildProfileFacts({
  headline: null,
  summary: null,
  location: null,
  skills: [],
  languages: [],
  experience: [],
  education: [],
});

const coveredMatrix = matrixFromChecks(
  [
    { text: 'A', required: true, reason: '' },
    { text: 'B', required: true, reason: '' },
  ],
  [],
  [],
  [],
);
const uncoveredMatrix = matrixFromChecks(
  [],
  [
    { text: 'A', required: true, reason: '' },
    { text: 'B', required: true, reason: '' },
  ],
  [],
  [],
);

describe('countIndependentEvidenceSources', () => {
  it('excludes the Profile pseudo-source — a self-statement is not corroboration', () => {
    expect(
      countIndependentEvidenceSources({ Profile: 1, 'resume.pdf': 12 }),
    ).toBe(1);
    expect(
      countIndependentEvidenceSources({ 'resume.pdf': 12, 'portfolio.dev': 4 }),
    ).toBe(2);
    expect(countIndependentEvidenceSources({ Profile: 1 })).toBe(0);
    expect(countIndependentEvidenceSources(null)).toBe(0);
    expect(countIndependentEvidenceSources(undefined)).toBe(0);
  });
});

describe('evidence confidence', () => {
  it('is coverage/consistency confidence with a full breakdown — bounded 0..100', () => {
    const rich = computeEvidenceConfidence({
      evidenceSourceCount: 3,
      evidenceChars: 9000,
      matrix: coveredMatrix,
      profile: richProfile,
      contradictions: [],
    });
    expect(rich.evidenceConfidence).toBe(30 + 20 + 25 + 15 + 10);
    expect(rich.breakdown).toEqual({
      sources: 30,
      volume: 20,
      coverage: 25,
      profileCompleteness: 15,
      consistency: 10,
    });
  });

  it('a sparse candidate scores materially lower than a documented one — same matrix', () => {
    const sparse = computeEvidenceConfidence({
      evidenceSourceCount: 1,
      evidenceChars: 500,
      matrix: coveredMatrix,
      profile: sparseProfile,
      contradictions: [],
    });
    const rich = computeEvidenceConfidence({
      evidenceSourceCount: 3,
      evidenceChars: 9000,
      matrix: coveredMatrix,
      profile: richProfile,
      contradictions: [],
    });
    expect(sparse.evidenceConfidence).toBeLessThan(
      rich.evidenceConfidence - 30,
    );
  });

  it('confidence is independent of the match score: it reads evidence, not fit', () => {
    // Same evidence base, one vacancy fully covered and one fully uncovered:
    // only the 25-point coverage component may move.
    const covered = computeEvidenceConfidence({
      evidenceSourceCount: 3,
      evidenceChars: 9000,
      matrix: coveredMatrix,
      profile: richProfile,
      contradictions: [],
    });
    const uncovered = computeEvidenceConfidence({
      evidenceSourceCount: 3,
      evidenceChars: 9000,
      matrix: uncoveredMatrix,
      profile: richProfile,
      contradictions: [],
    });
    expect(covered.evidenceConfidence - uncovered.evidenceConfidence).toBe(25);
    expect(uncovered.breakdown.sources).toBe(covered.breakdown.sources);
  });

  it('contradictions subtract from consistency, floored at zero', () => {
    const result = computeEvidenceConfidence({
      evidenceSourceCount: 2,
      evidenceChars: 3000,
      matrix: coveredMatrix,
      profile: richProfile,
      contradictions: [
        {
          kind: 'EXPERIENCE_YEARS_CLAIM',
          summary: '',
          sourceA: '',
          sourceB: '',
          confidencePenalty: 5,
        },
        {
          kind: 'DATE_ORDER',
          summary: '',
          sourceA: '',
          sourceB: '',
          confidencePenalty: 3,
        },
        {
          kind: 'DATE_ORDER',
          summary: '',
          sourceA: '',
          sourceB: '',
          confidencePenalty: 3,
        },
      ],
    });
    expect(result.breakdown.consistency).toBe(0); // 10 − 11, floored
  });

  it('no stated requirements → neutral coverage, not zero', () => {
    const result = computeEvidenceConfidence({
      evidenceSourceCount: 2,
      evidenceChars: 3000,
      matrix: [],
      profile: richProfile,
      contradictions: [],
    });
    expect(result.breakdown.coverage).toBe(12);
  });
});

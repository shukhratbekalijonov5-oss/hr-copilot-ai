import { MATCH_DIMENSION_MAX } from './advanced-match.types';
import {
  buildDimensions,
  candidateSpeaks,
  inferSeniorityFromTitles,
  languageFit,
  type DimensionInputs,
} from './dimensions';
import { buildProfileFacts } from './profile-facts';
import { matrixFromChecks } from './requirement-matrix';

const profile = (over: Record<string, unknown> = {}) =>
  buildProfileFacts({
    headline: 'Backend Engineer',
    summary: 'APIs in production',
    location: 'Seoul',
    skills: ['node.js', 'postgresql', 'docker'],
    languages: ['English', 'Korean'],
    experience: [
      {
        title: 'Backend Engineer',
        company: 'Acme',
        startDate: '2023',
        endDate: 'present',
        description: 'Built Node.js services on kubernetes with CI/CD',
      },
    ],
    education: [{ institution: 'X University' }],
    ...over,
  });

function inputs(over: Partial<DimensionInputs> = {}): DimensionInputs {
  return {
    context: 'CANDIDATE',
    matrix: matrixFromChecks(
      [{ text: 'Node.js APIs', required: true, reason: '' }],
      [{ text: 'Terraform', required: true, reason: '' }],
      [],
      [],
    ),
    signals: { roleFamily: 1 },
    vacancyTitle: 'Backend Engineer',
    vacancySeniority: 'MID',
    vacancyLanguages: [],
    alignments: [],
    intent: null,
    profile: profile(),
    distinctEvidenceSources: 2,
    evidenceTexts: [],
    currentYear: 2026,
    ...over,
  };
}

describe('dimensions', () => {
  it('every dimension carries score/max/normalizedScore with the fixed denominators', () => {
    const { dimensions } = buildDimensions(inputs(), ['node.js']);
    for (const dim of dimensions) {
      expect(dim.max).toBe(MATCH_DIMENSION_MAX[dim.key]);
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(dim.max);
      expect(dim.normalizedScore).toBeCloseTo(dim.score / dim.max, 1);
      expect(Number.isInteger(dim.score)).toBe(true);
    }
    // The denominators sum to 100 — the whole breakdown reads as X/100.
    expect(Object.values(MATCH_DIMENSION_MAX).reduce((a, b) => a + b, 0)).toBe(
      100,
    );
  });

  it('mustHaveSkills is the mean row credit over MUST_HAVE rows only', () => {
    const { dimensions } = buildDimensions(inputs(), []);
    const dim = dimensions.find((d) => d.key === 'mustHaveSkills')!;
    // one MATCH (0.9) + one MISSING (0) → 0.45 → 14/30
    expect(dim.score).toBe(Math.round(0.45 * 30));
    expect(dim.reason).toContain('1 of 2');
  });

  it('experienceDepth rewards independent sources, not repetition, and recency', () => {
    const sparse = buildDimensions(
      inputs({
        distinctEvidenceSources: 0,
        profile: profile({ experience: [] }),
      }),
      [],
    ).dimensions.find((d) => d.key === 'experienceDepth')!;
    const deep = buildDimensions(inputs({ distinctEvidenceSources: 3 }), [
      'kubernetes',
    ]).dimensions.find((d) => d.key === 'experienceDepth')!;
    expect(deep.score).toBeGreaterThan(sparse.score);
    expect(deep.reason).toContain('Recent experience');
  });

  it('roleSimilarity: exact recent title tops the ladder; unrelated title with unknown family is neutral-capped', () => {
    const exact = buildDimensions(inputs({ signals: {} }), []).dimensions.find(
      (d) => d.key === 'roleSimilarity',
    )!;
    expect(exact.normalizedScore).toBe(1);

    const far = buildDimensions(
      inputs({
        signals: { roleFamily: 0.2 },
        profile: profile({
          experience: [{ title: 'Chef', startDate: '2024' }],
        }),
      }),
      [],
    ).dimensions.find((d) => d.key === 'roleSimilarity')!;
    expect(far.normalizedScore).toBeLessThanOrEqual(0.2);
  });

  it('title similarity never dominates: it is capped by its own 15-point weight', () => {
    expect(MATCH_DIMENSION_MAX.roleSimilarity).toBe(15);
    expect(
      MATCH_DIMENSION_MAX.mustHaveSkills + MATCH_DIMENSION_MAX.experienceDepth,
    ).toBeGreaterThan(MATCH_DIMENSION_MAX.roleSimilarity * 3);
  });

  it('seniorityFit: stated intent beats inference; unknown candidate seniority is neutral 0.5', () => {
    const stated = buildDimensions(
      inputs({
        intent: { seniorityLevels: ['SENIOR'] } as never,
        vacancySeniority: 'SENIOR',
      }),
      [],
    ).dimensions.find((d) => d.key === 'seniorityFit')!;
    expect(stated.normalizedScore).toBe(1);

    const unknown = buildDimensions(
      inputs({ profile: profile({ experience: [] }) }),
      [],
    ).dimensions.find((d) => d.key === 'seniorityFit')!;
    expect(unknown.normalizedScore).toBe(0.5);
    expect(unknown.reason).toContain('not stated');

    // No vacancy seniority → the dimension is absent, not faked.
    const absent = buildDimensions(inputs({ vacancySeniority: null }), []);
    expect(
      absent.dimensions.find((d) => d.key === 'seniorityFit'),
    ).toBeUndefined();
  });

  it('projectEvidence counts distinct complexity facets, not keyword volume', () => {
    const rich = buildDimensions(
      inputs({
        evidenceTexts: [
          'Deployed microservices to production on AWS with CI/CD pipelines, ' +
            'Prometheus monitoring and PostgreSQL',
        ],
      }),
      [],
    ).dimensions.find((d) => d.key === 'projectEvidence')!;

    const stuffed = buildDimensions(
      inputs({
        profile: profile({ experience: [], summary: null }),
        evidenceTexts: ['aws aws aws aws aws aws aws aws aws aws'],
      }),
      [],
    ).dimensions.find((d) => d.key === 'projectEvidence')!;

    expect(rich.score).toBeGreaterThan(stuffed.score);
    expect(stuffed.normalizedScore).toBeLessThanOrEqual(0.3); // one facet, however loud
  });

  it('locationWorkMode exists only in candidate context with comparable alignments', () => {
    const withAlignments = buildDimensions(
      inputs({
        alignments: [
          { dimension: 'location', state: 'MATCH', reason: 'X', score: 1 },
          { dimension: 'workMode', state: 'MISMATCH', reason: 'X', score: 0 },
        ],
      }),
      [],
    ).dimensions.find((d) => d.key === 'locationWorkMode')!;
    // raw 0.5 × max 5 = 2.5 → integer score 3 → 3/5 (scores are integers by contract)
    expect(withAlignments.score).toBe(3);
    expect(withAlignments.normalizedScore).toBe(0.6);

    const hr = buildDimensions(
      inputs({
        context: 'HR',
        alignments: [
          { dimension: 'location', state: 'MATCH', reason: 'X', score: 1 },
        ],
      }),
      [],
    );
    expect(
      hr.dimensions.find((d) => d.key === 'locationWorkMode'),
    ).toBeUndefined();
  });

  it('languageFit: found=1, stated-but-absent=0.2 (missing ≠ absent), nothing stated=0.5', () => {
    const found = languageFit(
      [{ languageCode: 'en', level: 'B2', required: true }],
      ['English (C1)'],
    );
    expect(found.dimension!.normalizedScore).toBe(1);
    expect(found.missingRequired).toEqual([]);

    const absent = languageFit(
      [{ languageCode: 'ko', level: 'B1', required: true }],
      ['English'],
    );
    expect(absent.dimension!.normalizedScore).toBe(0.2);
    expect(absent.missingRequired).toEqual(['ko']);

    const unstated = languageFit(
      [{ languageCode: 'ko', level: 'B1', required: true }],
      [],
    );
    expect(unstated.dimension!.score).toBe(3); // raw 0.5 × 5 → integer 3
    expect(unstated.missingRequired).toEqual([]);

    const none = languageFit([], ['English']);
    expect(none.dimension).toBeNull();
  });

  it('candidateSpeaks matches names across scripts', () => {
    expect(candidateSpeaks(['한국어'], 'ko')).toBe(true);
    expect(candidateSpeaks(['Русский'], 'ru')).toBe(true);
    expect(candidateSpeaks(['English'], 'ko')).toBe(false);
  });

  it('inferSeniorityFromTitles reads only what titles state', () => {
    expect(
      inferSeniorityFromTitles([{ title: 'Senior Backend Engineer' } as never]),
    ).toBe('SENIOR');
    expect(inferSeniorityFromTitles([{ title: 'Engineer' } as never])).toBe(
      'MID',
    );
    expect(inferSeniorityFromTitles([])).toBeNull();
  });
});

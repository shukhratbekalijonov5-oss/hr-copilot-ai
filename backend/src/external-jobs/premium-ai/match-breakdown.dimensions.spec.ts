import { deriveBreakdownDimensions } from './match-breakdown.dimensions';
import type { PremiumAiContext } from './external-premium-ai.context';

/**
 * The deterministic classifier. No model exists anywhere in these tests —
 * every status below is decided by arithmetic over stored values and the
 * shared matchers' own raw verdicts, which is the whole point of the design.
 */

function context(over: Partial<PremiumAiContext> = {}): PremiumAiContext {
  return {
    candidateAccountId: 'acct-1',
    candidate: {
      headline: 'Backend Engineer',
      summary: null,
      locationLabel: 'Seoul, KR',
      skills: ['Go', 'PostgreSQL'],
      languages: ['English', 'Korean'],
      experience: [],
      education: [],
      preferences: [],
      evidenceExcerpts: [],
    },
    job: {
      jobId: 'job-1',
      title: 'Senior Backend Engineer',
      company: 'Acme',
      status: 'ACTIVE',
      locationLabel: 'Seoul, KR',
      workMode: 'HYBRID',
      employmentType: 'FULL_TIME',
      seniorityLevel: 'SENIOR',
      salaryLabel: null,
      skills: ['Go', 'Kubernetes'],
      languages: ['en'],
      benefits: [],
      description: 'Own the platform.',
      requirementsText: null,
    },
    facts: {
      score: null,
      band: null,
      matchedSkills: ['Go'],
      missingSkills: ['Kubernetes'],
      alignmentNotes: [],
    },
    alignments: [],
    fingerprint: 'fp-1',
    ...over,
  };
}

function byKey(dimensions: ReturnType<typeof deriveBreakdownDimensions>) {
  return new Map(dimensions.map((d) => [d.key, d]));
}

describe('skills', () => {
  it('is PARTIAL with grounded matched/missing when some overlap', () => {
    const skills = byKey(deriveBreakdownDimensions(context())).get('skills')!;
    expect(skills.status).toBe('PARTIAL');
    expect(skills.matched).toEqual(['Go']);
    expect(skills.missing).toEqual(['Kubernetes']);
  });

  it('is STRONG when everything the job lists is shown', () => {
    const skills = byKey(
      deriveBreakdownDimensions(
        context({
          facts: {
            score: null,
            band: null,
            matchedSkills: ['Go', 'Kubernetes'],
            missingSkills: [],
            alignmentNotes: [],
          },
        }),
      ),
    ).get('skills')!;
    expect(skills.status).toBe('STRONG');
  });

  it('is GAP only when BOTH sides stated skills and none overlap', () => {
    const skills = byKey(
      deriveBreakdownDimensions(
        context({
          facts: {
            score: null,
            band: null,
            matchedSkills: [],
            missingSkills: ['Kubernetes'],
            alignmentNotes: [],
          },
        }),
      ),
    ).get('skills')!;
    expect(skills.status).toBe('GAP');
  });

  it('is UNKNOWN when the candidate stated no skills — silence, not a verdict', () => {
    const base = context();
    const skills = byKey(
      deriveBreakdownDimensions(
        context({
          candidate: { ...base.candidate, skills: [] },
        }),
      ),
    ).get('skills')!;
    expect(skills.status).toBe('UNKNOWN');
    expect(skills.matched).toEqual([]);
    expect(skills.missing).toEqual([]);
  });

  it('is OMITTED when the employer listed no skills', () => {
    const base = context();
    const dimensions = deriveBreakdownDimensions(
      context({ job: { ...base.job, skills: [] } }),
    );
    expect(byKey(dimensions).has('skills')).toBe(false);
  });

  it('clips matched/missing at 12 each', () => {
    const many = Array.from({ length: 30 }, (_, i) => `S${i}`);
    const base = context();
    const skills = byKey(
      deriveBreakdownDimensions(
        context({
          job: { ...base.job, skills: many },
          facts: {
            score: null,
            band: null,
            matchedSkills: many.slice(0, 20),
            missingSkills: many.slice(20),
            alignmentNotes: [],
          },
        }),
      ),
    ).get('skills')!;
    expect(skills.matched).toHaveLength(12);
    expect(skills.missing.length).toBeLessThanOrEqual(12);
  });
});

describe('preference dimensions ride the shared matchers', () => {
  it('maps MATCH/PARTIAL/MISMATCH/UNKNOWN to STRONG/PARTIAL/GAP/UNKNOWN', () => {
    const dimensions = byKey(
      deriveBreakdownDimensions(
        context({
          alignments: [
            {
              dimension: 'seniority',
              state: 'MATCH',
              reason: 'SENIORITY_MATCH',
            },
            { dimension: 'workMode', state: 'PARTIAL', reason: 'WM_PARTIAL' },
            {
              dimension: 'employmentType',
              state: 'MISMATCH',
              reason: 'EMPLOYMENT_MISMATCH',
            },
            { dimension: 'salary', state: 'UNKNOWN', reason: 'SALARY_UNKNOWN' },
          ],
        }),
      ),
    );
    expect(dimensions.get('seniority')!.status).toBe('STRONG');
    expect(dimensions.get('workMode')!.status).toBe('PARTIAL');
    expect(dimensions.get('employmentType')!.status).toBe('GAP');
    expect(dimensions.get('salary')!.status).toBe('UNKNOWN');
  });

  it('NEVER turns a missing employer salary into a GAP', () => {
    // The candidate stated a salary expectation; the employer stated
    // nothing. The shared matcher says UNKNOWN, and UNKNOWN it stays.
    const salary = byKey(
      deriveBreakdownDimensions(
        context({
          alignments: [
            { dimension: 'salary', state: 'UNKNOWN', reason: 'SALARY_UNKNOWN' },
          ],
        }),
      ),
    ).get('salary')!;
    expect(salary.status).toBe('UNKNOWN');
    expect(salary.status).not.toBe('GAP');
  });

  it('maps NOT_COMPARABLE to UNKNOWN, never to a verdict', () => {
    const salary = byKey(
      deriveBreakdownDimensions(
        context({
          alignments: [
            {
              dimension: 'salary',
              state: 'NOT_COMPARABLE',
              reason: 'SALARY_NO_RATE',
            },
          ],
        }),
      ),
    ).get('salary')!;
    expect(salary.status).toBe('UNKNOWN');
  });

  it('shows a job-stated value as UNKNOWN when no preference exists', () => {
    // No alignment entries at all: the candidate stated no preferences.
    const dimensions = byKey(deriveBreakdownDimensions(context()));
    const seniority = dimensions.get('seniority')!;
    expect(seniority.status).toBe('UNKNOWN');
    expect(seniority.reason).toContain('SENIOR');
    expect(seniority.reason).toContain('not stated a preference');
  });

  it('OMITS a dimension where neither side said anything', () => {
    const base = context();
    const dimensions = byKey(
      deriveBreakdownDimensions(
        context({
          job: { ...base.job, salaryLabel: null },
          alignments: [],
        }),
      ),
    );
    // Job states no salary, candidate states no expectation → no row.
    expect(dimensions.has('salary')).toBe(false);
  });
});

describe('languages', () => {
  it('matches across code and name forms', () => {
    const languages = byKey(deriveBreakdownDimensions(context())).get(
      'languages',
    )!;
    // Job states 'en'; candidate wrote 'English'. Normalized → STRONG.
    expect(languages.status).toBe('STRONG');
    expect(languages.matched).toEqual(['en']);
  });

  it('is PARTIAL when only some stated languages are confirmed', () => {
    const base = context();
    const languages = byKey(
      deriveBreakdownDimensions(
        context({ job: { ...base.job, languages: ['en', 'de'] } }),
      ),
    ).get('languages')!;
    expect(languages.status).toBe('PARTIAL');
    expect(languages.matched).toEqual(['en']);
    expect(languages.missing).toEqual(['de']);
  });

  it('is UNKNOWN — never GAP — when no overlap can be CONFIRMED', () => {
    const base = context();
    const languages = byKey(
      deriveBreakdownDimensions(
        context({
          job: { ...base.job, languages: ['de'] },
          candidate: { ...base.candidate, languages: ['영어'] },
        }),
      ),
    ).get('languages')!;
    // Free-text language names: an unconfirmed overlap is missing
    // information about the comparison, not evidence of a gap.
    expect(languages.status).toBe('UNKNOWN');
  });

  it('is OMITTED when the employer states no languages', () => {
    const base = context();
    const dimensions = byKey(
      deriveBreakdownDimensions(
        context({ job: { ...base.job, languages: [] } }),
      ),
    );
    expect(dimensions.has('languages')).toBe(false);
  });
});

describe('the table as a whole', () => {
  it('emits a fixed canonical order and at most 9 dimensions', () => {
    const dimensions = deriveBreakdownDimensions(
      context({
        alignments: [
          { dimension: 'seniority', state: 'MATCH', reason: 'R' },
          { dimension: 'workMode', state: 'MATCH', reason: 'R' },
          { dimension: 'employmentType', state: 'MATCH', reason: 'R' },
          { dimension: 'location', state: 'MATCH', reason: 'R' },
          { dimension: 'salary', state: 'UNKNOWN', reason: 'SALARY_UNKNOWN' },
        ],
      }),
    );
    expect(dimensions.map((d) => d.key)).toEqual([
      'skills',
      'seniority',
      'workMode',
      'employmentType',
      'location',
      'salary',
      'languages',
    ]);
    expect(dimensions.length).toBeLessThanOrEqual(9);
  });

  it('produces only valid statuses, whatever the inputs', () => {
    const dimensions = deriveBreakdownDimensions(
      context({
        alignments: [{ dimension: 'seniority', state: 'GARBAGE', reason: 'R' }],
      }),
    );
    for (const dimension of dimensions) {
      expect(['STRONG', 'PARTIAL', 'GAP', 'UNKNOWN']).toContain(
        dimension.status,
      );
    }
  });

  it('never emits a score, band, percentage or rank field', () => {
    for (const dimension of deriveBreakdownDimensions(context())) {
      expect(Object.keys(dimension).sort()).toEqual([
        'key',
        'label',
        'matched',
        'missing',
        'reason',
        'status',
      ]);
    }
  });
});

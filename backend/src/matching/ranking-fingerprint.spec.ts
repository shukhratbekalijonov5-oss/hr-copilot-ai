import {
  intentFingerprint,
  vacancyRankingFingerprint,
} from './ranking-fingerprint';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import { RANKING_VACANCY_SELECT } from './normalized-job-features';
import type { RankingVacancyRow } from './normalized-job-features';

/**
 * Fingerprints are SEMANTIC: same meaning → same hash, changed meaning → new
 * hash. Both directions matter equally — a reorder that invalidates throws
 * away good rankings; a real change that does not invalidate serves stale
 * ones, which for intent would break Rule N1.
 */

function intent(
  overrides: Partial<CandidateJobIntent> = {},
): CandidateJobIntent {
  return { ...emptyJobIntent('acct-1'), stated: true, ...overrides };
}

describe('intentFingerprint', () => {
  it('order-insensitive: [REMOTE, HYBRID] and [HYBRID, REMOTE] are the same intent', () => {
    const a = intent({ workModes: ['REMOTE', 'HYBRID'] });
    const b = intent({ workModes: ['HYBRID', 'REMOTE'] });
    expect(intentFingerprint(a)).toBe(intentFingerprint(b));
  });

  it('ignores updatedAt and candidateAccountId — a re-save of the same content changes nothing', () => {
    const a = intent({
      roles: ['Backend Engineer'],
      updatedAt: '2026-08-22T01:00:00Z',
    });
    const b = {
      ...intent({
        roles: ['Backend Engineer'],
        updatedAt: '2026-08-22T09:00:00Z',
      }),
      candidateAccountId: 'acct-2',
    };
    expect(intentFingerprint(a)).toBe(intentFingerprint(b));
  });

  it.each([
    ['roles', intent({ roles: ['Cloud Engineer'] })],
    [
      'locations',
      intent({
        locations: [{ countryCode: 'CA', region: 'Ontario', city: 'Toronto' }],
      }),
    ],
    ['workModes', intent({ workModes: ['REMOTE'] })],
    [
      'salary',
      intent({
        compensation: {
          minAmount: 70_000,
          maxAmount: null,
          currency: 'CAD',
          payPeriod: 'YEARLY',
        },
      }),
    ],
    ['employmentTypes', intent({ employmentTypes: ['FULL_TIME'] })],
    ['seniorityLevels', intent({ seniorityLevels: ['SENIOR'] })],
    ['relocation', intent({ relocation: true })],
    ['industries', intent({ preferredIndustries: ['fintech'] })],
    ['benefits', intent({ preferredBenefits: ['STOCK_OPTIONS'] })],
    [
      'exclusions',
      intent({
        exclusions: { companies: ['ABC Corp'], jobTitles: [], locations: [] },
      }),
    ],
  ])('a semantic edit to %s changes the fingerprint', (_dimension, edited) => {
    expect(intentFingerprint(edited)).not.toBe(
      intentFingerprint(emptyJobIntent('acct-1')),
    );
  });

  it('the salary amount alone changes it — 50M and 70M are different intents', () => {
    const a = intent({
      compensation: {
        minAmount: 50_000_000,
        maxAmount: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      },
    });
    const b = intent({
      compensation: {
        minAmount: 70_000_000,
        maxAmount: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      },
    });
    expect(intentFingerprint(a)).not.toBe(intentFingerprint(b));
  });

  it('deleting preferences changes the fingerprint — to the hash of the EMPTY intent', () => {
    // Rule N1's last step: after deletion the ranking must recompute, and it
    // recomputes preference-neutral.
    const before = intent({ roles: ['Backend Engineer'] });
    const after = emptyJobIntent('acct-1');
    expect(intentFingerprint(before)).not.toBe(intentFingerprint(after));
    // And the empty intent is stable: every preference-less candidate shares it.
    expect(intentFingerprint(after)).toBe(
      intentFingerprint(emptyJobIntent('acct-99')),
    );
  });
});

function row(overrides: Partial<RankingVacancyRow> = {}): RankingVacancyRow {
  return {
    id: 'vac-1',
    title: 'Backend Engineer',
    description: 'Build APIs',
    country: 'KR',
    region: null,
    city: 'Seoul',
    workMode: 'HYBRID',
    remoteCountriesAllowed: [],
    salaryMin: 40_000_000,
    salaryMax: 60_000_000,
    currency: 'KRW',
    payPeriod: 'YEARLY',
    employmentType: 'Full-time',
    seniorityLevel: 'MID',
    benefits: ['BONUS', 'HEALTH_INSURANCE'],
    domainExperience: [],
    organization: { name: 'Acme' },
    requirements: [{ text: 'Node.js', required: true }],
    languages: [],
    ...overrides,
  };
}

describe('vacancyRankingFingerprint', () => {
  it('is stable across row order and meaningless array order', () => {
    const a = [row({ id: 'v1' }), row({ id: 'v2' })];
    const b = [
      row({ id: 'v2' }),
      row({ id: 'v1', benefits: ['HEALTH_INSURANCE', 'BONUS'] }),
    ];
    expect(vacancyRankingFingerprint(a)).toBe(vacancyRankingFingerprint(b));
  });

  it.each([
    ['title', row({ title: 'Senior Backend Engineer' })],
    ['description', row({ description: 'Build APIs and more' })],
    ['a requirement', row({ requirements: [{ text: 'Go', required: true }] })],
    ['salary', row({ salaryMax: 80_000_000 })],
    ['location', row({ city: 'Busan' })],
    ['work mode', row({ workMode: 'REMOTE' })],
    ['employment type', row({ employmentType: 'Contract' })],
    ['seniority', row({ seniorityLevel: 'SENIOR' })],
  ])('a ranking-relevant edit (%s) changes it', (_field, edited) => {
    expect(vacancyRankingFingerprint([edited])).not.toBe(
      vacancyRankingFingerprint([row()]),
    );
  });

  it('40M → 80M salary can never keep its old snapshot', () => {
    expect(
      vacancyRankingFingerprint([
        row({ salaryMin: 40_000_000, salaryMax: 40_000_000 }),
      ]),
    ).not.toBe(
      vacancyRankingFingerprint([
        row({ salaryMin: 80_000_000, salaryMax: 80_000_000 }),
      ]),
    );
  });

  it('opening or closing a vacancy changes it — the row set IS the universe', () => {
    expect(vacancyRankingFingerprint([row()])).not.toBe(
      vacancyRankingFingerprint([row(), row({ id: 'vac-2' })]),
    );
  });

  it('display-only vacancy fields are not ranking inputs at all', () => {
    // The definition of "ranking-relevant" is RANKING_VACANCY_SELECT: a field
    // absent there never reaches the hash, so editing the department, the
    // application deadline, openings count, hiring urgency or benefitsOther
    // cannot invalidate anyone's ranking. Asserted structurally, where the
    // rule actually lives.
    for (const displayOnly of [
      'department',
      'applicationDeadline',
      'openingsCount',
      'hiringUrgency',
      'benefitsOther',
      'location', // legacy free text — displayed, superseded for matching
    ]) {
      expect(RANKING_VACANCY_SELECT).not.toHaveProperty(displayOnly);
    }
  });
});

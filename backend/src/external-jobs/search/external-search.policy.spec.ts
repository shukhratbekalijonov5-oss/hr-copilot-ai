import {
  compareByNewest,
  compareExternalResults,
  EXTERNAL_SEARCH_ALGORITHM_VERSION,
  EXTERNAL_SEARCH_BAND_THRESHOLDS,
  externalSearchBand,
  externalSearchReasons,
  externalSearchScore,
  NEUTRAL_SCORE,
  SEARCH_INTENT_SHARE,
  TEXT_SHARE,
} from './external-search.policy';
import { MATCH_ALGORITHM_VERSION } from '../../matching/match-policy';
import type { IntentAlignment } from '../../matching/intent-alignment';

/**
 * The versioned policy: what the score means, and what it must never mean.
 */

describe('the two algorithms are versioned separately', () => {
  it('does not reuse the AI Job Match version', () => {
    /*
     * They answer different questions — "which jobs are these words?" versus
     * "which jobs does your evidence fit?" — and sharing a version would mean
     * a change to one silently invalidating every snapshot of the other, or
     * worse, not invalidating when it should.
     */
    expect(EXTERNAL_SEARCH_ALGORITHM_VERSION).not.toBe(MATCH_ALGORITHM_VERSION);
    expect(EXTERNAL_SEARCH_ALGORITHM_VERSION).toBe('external-search-v1');
  });

  it('gives the typed query the majority of the score', () => {
    expect(TEXT_SHARE).toBeGreaterThan(SEARCH_INTENT_SHARE);
    expect(TEXT_SHARE + SEARCH_INTENT_SHARE).toBeCloseTo(1);
  });
});

describe('the score', () => {
  it('combines text and intent at the stated ratio', () => {
    expect(externalSearchScore(100, 0)).toBe(60);
    expect(externalSearchScore(0, 100)).toBe(40);
    expect(externalSearchScore(80, 50)).toBe(68);
  });

  it('keeps relevance dominant over preferences', () => {
    /*
     * The failure this ratio prevents: a job that barely answers the search
     * climbing over one that answers it well, because its work mode happened
     * to match. Preferences reorder the neighbourhood; the query decides the
     * league.
     */
    const relevantButUnwanted = externalSearchScore(90, 0);
    const irrelevantButIdeal = externalSearchScore(20, 100);
    expect(relevantButUnwanted).toBeGreaterThan(irrelevantButIdeal);
  });

  it('treats a missing signal as absent, not as zero', () => {
    // No query: the score is the preference alignment alone.
    expect(externalSearchScore(null, 70)).toBe(70);
    // No preferences: the score is the relevance alone.
    expect(externalSearchScore(70, null)).toBe(70);
    // Neither: a browse. Every job is equal and the tie-break orders them.
    expect(externalSearchScore(null, null)).toBe(NEUTRAL_SCORE);
  });

  it('distinguishes "asked nothing" from "answered nothing"', () => {
    // A search with no preferences must not score every job as though it
    // failed them.
    expect(externalSearchScore(50, null)).toBeGreaterThan(
      externalSearchScore(50, 0),
    );
  });
});

describe('bands', () => {
  it('maps a score to its band', () => {
    expect(externalSearchBand(90)).toBe('STRONG');
    expect(externalSearchBand(EXTERNAL_SEARCH_BAND_THRESHOLDS.STRONG)).toBe(
      'STRONG',
    );
    expect(externalSearchBand(60)).toBe('GOOD');
    expect(externalSearchBand(40)).toBe('PARTIAL');
    expect(externalSearchBand(10)).toBe('LOW');
  });

  it('never removes anything', () => {
    // A band is presentation. LOW MATCH ≠ HIDDEN JOB, on this surface too.
    expect(externalSearchBand(0)).toBe('LOW');
  });
});

describe('the order is a total order', () => {
  const at = (
    over: Partial<Parameters<typeof compareExternalResults>[0]> = {},
  ) => ({
    externalJobId: 'b',
    score: 50,
    textScore: 50,
    intentScore: 50,
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });

  it('orders by score, then text, then intent', () => {
    expect(
      compareExternalResults(at({ score: 60 }), at({ score: 50 })),
    ).toBeLessThan(0);
    expect(
      compareExternalResults(
        at({ score: 50, textScore: 80 }),
        at({ score: 50, textScore: 40 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareExternalResults(
        at({ score: 50, textScore: 50, intentScore: 80 }),
        at({ score: 50, textScore: 50, intentScore: 40 }),
      ),
    ).toBeLessThan(0);
  });

  it('breaks a full tie by first-seen then id, and never returns 0', () => {
    /*
     * Pagination slices this list. Two jobs that compared equal on some
     * requests and not others would let a reader page forward and see one job
     * twice while never seeing another — so the comparison must bottom out on
     * something unique.
     */
    const a = at({ externalJobId: 'a' });
    const b = at({ externalJobId: 'b' });
    expect(compareExternalResults(a, b)).toBeLessThan(0);
    expect(compareExternalResults(b, a)).toBeGreaterThan(0);
    expect(compareExternalResults(a, a)).toBe(0);

    const newer = at({
      externalJobId: 'z',
      firstSeenAt: new Date('2026-06-01'),
    });
    const older = at({
      externalJobId: 'a',
      firstSeenAt: new Date('2026-01-01'),
    });
    expect(compareExternalResults(newer, older)).toBeLessThan(0);
  });

  it('is stable across repeated sorts of the same input', () => {
    const items = [
      at({ externalJobId: 'a', score: 50 }),
      at({ externalJobId: 'b', score: 50 }),
      at({ externalJobId: 'c', score: 70 }),
      at({ externalJobId: 'd', score: 50, textScore: null }),
    ];
    const once = [...items]
      .sort(compareExternalResults)
      .map((i) => i.externalJobId);
    const twice = [...items]
      .reverse()
      .sort(compareExternalResults)
      .map((i) => i.externalJobId);
    expect(twice).toEqual(once);
  });
});

describe('reasons', () => {
  const alignment = (over: Partial<IntentAlignment>): IntentAlignment => ({
    dimension: 'workMode',
    state: 'MATCH',
    reason: 'WORK_MODE_MATCH',
    score: 1,
    ...over,
  });

  it('never claims a text match when there was no query', () => {
    const reasons = externalSearchReasons({
      textScore: null,
      matchedLexically: false,
      alignments: [],
      isStale: false,
    });
    expect(reasons.map((r) => r.code)).toEqual([]);
  });

  it('says a semantic match was semantic', () => {
    // The candidate's words did NOT appear in this job; a reason implying
    // they did would be a small lie the reader could catch.
    const reasons = externalSearchReasons({
      textScore: 60,
      matchedLexically: false,
      alignments: [],
      isStale: false,
    });
    expect(reasons[0].code).toBe('TEXT_SEMANTIC_MATCH');
  });

  it('grades a lexical match by how strong it was', () => {
    const strong = externalSearchReasons({
      textScore: 90,
      matchedLexically: true,
      alignments: [],
      isStale: false,
    });
    expect(strong[0].code).toBe('TEXT_STRONG_MATCH');
    const weak = externalSearchReasons({
      textScore: 10,
      matchedLexically: true,
      alignments: [],
      isStale: false,
    });
    expect(weak[0].code).toBe('TEXT_PARTIAL_MATCH');
  });

  it('passes alignment verdicts through verbatim', () => {
    /*
     * The salary and location enums already exist and already mean exactly
     * this on the AI Job Match surface. A parallel set of search-only names
     * for the same verdicts would give the product two vocabularies for one
     * fact — and two sets of translations to keep in step.
     */
    const reasons = externalSearchReasons({
      textScore: null,
      matchedLexically: false,
      alignments: [
        alignment({
          dimension: 'salary',
          state: 'UNKNOWN',
          reason: 'SALARY_UNKNOWN',
          score: null,
        }),
        alignment({
          dimension: 'location',
          state: 'MATCH',
          reason: 'LOCATION_EXACT',
        }),
      ],
      isStale: false,
    });
    expect(reasons.map((r) => r.code)).toContain('SALARY_UNKNOWN');
    expect(reasons.map((r) => r.code)).toContain('LOCATION_EXACT');
  });

  it('puts a contradiction before a confirmation', () => {
    // The most useful thing to tell someone about an unexpected result is
    // what does NOT line up.
    const reasons = externalSearchReasons({
      textScore: null,
      matchedLexically: false,
      alignments: [
        alignment({ state: 'MATCH', reason: 'WORK_MODE_MATCH' }),
        alignment({
          dimension: 'salary',
          state: 'MISMATCH',
          reason: 'SALARY_BELOW_MINIMUM',
          score: 0,
        }),
      ],
      isStale: false,
    });
    expect(reasons[0].code).toBe('SALARY_BELOW_MINIMUM');
  });

  it('surfaces staleness rather than hiding it', () => {
    const reasons = externalSearchReasons({
      textScore: null,
      matchedLexically: false,
      alignments: [],
      isStale: true,
    });
    expect(reasons.map((r) => r.code)).toContain('STALE_LISTING');
  });

  it('stores codes, never prose', () => {
    // A snapshot written in English would be wrong for the same candidate on
    // their next visit. The UI localizes; the database does not.
    const reasons = externalSearchReasons({
      textScore: 80,
      matchedLexically: true,
      alignments: [alignment({})],
      isStale: true,
    });
    for (const reason of reasons) {
      expect(reason.code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(reason.code).not.toMatch(/\s/);
    }
  });

  it('is bounded, so one result cannot carry twenty explanations', () => {
    const many = Array.from({ length: 20 }, () => alignment({}));
    expect(
      externalSearchReasons({
        textScore: 50,
        matchedLexically: true,
        alignments: many,
        isStale: true,
      }).length,
    ).toBeLessThanOrEqual(6);
  });
});

/**
 * Newest-first.
 *
 * The interesting half is the undated jobs. Half this catalogue has no
 * publication date, so where they go is not an edge case — it is the design.
 */
describe('newest-first ordering', () => {
  const entry = (
    id: string,
    postedAt: string | null,
    over: Partial<{ score: number; textScore: number; firstSeenAt: Date }> = {},
  ) => ({
    externalJobId: id,
    score: over.score ?? 50,
    textScore: over.textScore ?? null,
    intentScore: null,
    firstSeenAt: over.firstSeenAt ?? new Date('2026-01-01T00:00:00Z'),
    employerPostedAt: postedAt ? new Date(postedAt) : null,
  });

  const order = (entries: ReturnType<typeof entry>[]) =>
    [...entries].sort(compareByNewest).map((e) => e.externalJobId);

  it('puts the most recently published first', () => {
    expect(
      order([
        entry('old', '2026-01-05T00:00:00Z'),
        entry('new', '2026-08-20T00:00:00Z'),
        entry('mid', '2026-05-01T00:00:00Z'),
      ]),
    ).toEqual(['new', 'mid', 'old']);
  });

  it('puts every dated job before every undated one', () => {
    expect(
      order([
        entry('undated', null, { score: 99 }),
        entry('ancient', '2021-04-27T00:00:00Z', { score: 1 }),
      ]),
    ).toEqual(['ancient', 'undated']);
  });

  it('does not treat an unknown date as an old one', () => {
    // The alternative — null as the epoch — would be indistinguishable in the
    // output from a job genuinely posted in 1970, and would bury real
    // vacancies under a fact nobody stated.
    const undated = entry('undated', null);
    expect(undated.employerPostedAt).toBeNull();
    expect(order([undated, entry('dated', '2026-08-20T00:00:00Z')])).toEqual([
      'dated',
      'undated',
    ]);
  });

  it('keeps undated jobs in relevance order among themselves', () => {
    expect(
      order([
        entry('weak', null, { score: 10 }),
        entry('strong', null, { score: 90 }),
      ]),
    ).toEqual(['strong', 'weak']);
  });

  it('is a total order, so pagination cannot repeat or lose a job', () => {
    // Same date, same score, same everything a comparator could read except
    // the id — which is what stops the comparison falling through.
    const same = new Date('2026-08-20T00:00:00Z');
    const entries = ['c', 'a', 'b'].map((id) => ({
      ...entry(id, same.toISOString()),
    }));
    expect(order(entries)).toEqual(['a', 'b', 'c']);
    expect(order([...entries].reverse())).toEqual(['a', 'b', 'c']);
  });

  it('orders by the publication date and not by when we first saw it', () => {
    // The crawler saw 'seenFirst' earlier; the employer published 'postedLast'
    // later. The employer's statement is the one that decides.
    expect(
      order([
        entry('seenFirst', '2026-01-01T00:00:00Z', {
          firstSeenAt: new Date('2026-01-02T00:00:00Z'),
        }),
        entry('postedLast', '2026-08-01T00:00:00Z', {
          firstSeenAt: new Date('2026-08-23T00:00:00Z'),
        }),
      ]),
    ).toEqual(['postedLast', 'seenFirst']);
  });
});

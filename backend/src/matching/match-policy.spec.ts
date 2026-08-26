import {
  CAPABILITY_SHARE,
  INTENT_DIMENSION_WEIGHTS,
  MATCH_ALGORITHM_VERSION,
  canonicalScore,
  compareRanked,
  intentScoreFrom,
} from './match-policy';
import type { IntentAlignment } from './intent-alignment';

/**
 * The scoring policy: capability dominates, unknown drops out, null and zero
 * stay different things, and the score orders — it never gates.
 */

function alignment(
  dimension: IntentAlignment['dimension'],
  score: number | null,
): IntentAlignment {
  return {
    dimension,
    state: score === null ? 'UNKNOWN' : 'MATCH',
    reason: 'X',
    score,
  };
}

describe('intentScoreFrom', () => {
  it('no alignments → null, the "no signal exists" value', () => {
    expect(intentScoreFrom([])).toBeNull();
  });

  it('all alignments unknown → null too — silence is not a score', () => {
    expect(
      intentScoreFrom([alignment('salary', null), alignment('workMode', null)]),
    ).toBeNull();
  });

  it('unknown dimensions drop OUT of the average instead of dragging it', () => {
    // Location matched perfectly; salary was unknown. The intent score is
    // 100, not 100-diluted-by-a-zero-for-silence.
    expect(
      intentScoreFrom([alignment('location', 1), alignment('salary', null)]),
    ).toBe(100);
  });

  it('weights renormalize over the comparable dimensions', () => {
    // role (30) at 1.0 and workMode (14) at 0.0 → 30/44.
    const score = intentScoreFrom([
      alignment('role', 1),
      alignment('workMode', 0),
    ]);
    expect(score).toBe(Math.round((30 / 44) * 100));
  });

  it('a full contradiction is 0 — a real score, distinct from null', () => {
    expect(
      intentScoreFrom([alignment('role', 0), alignment('location', 0)]),
    ).toBe(0);
  });

  it('every dimension has a weight, and the six primary ones carry almost all of it', () => {
    const total = Object.values(INTENT_DIMENSION_WEIGHTS).reduce(
      (a, b) => a + b,
    );
    const primary =
      INTENT_DIMENSION_WEIGHTS.role +
      INTENT_DIMENSION_WEIGHTS.location +
      INTENT_DIMENSION_WEIGHTS.workMode +
      INTENT_DIMENSION_WEIGHTS.salary +
      INTENT_DIMENSION_WEIGHTS.employmentType +
      INTENT_DIMENSION_WEIGHTS.seniority;
    expect(primary / total).toBeGreaterThan(0.9);
  });
});

describe('canonicalScore', () => {
  it('no intent signal → EXACTLY the capability score (the provable baseline)', () => {
    for (const capability of [0, 12, 47, 68, 100]) {
      expect(canonicalScore(capability, null)).toBe(capability);
    }
  });

  it('capability dominates: strong evidence + total intent mismatch beats weak evidence + perfect intent', () => {
    const strongMismatched = canonicalScore(90, 0);
    const weakPerfect = canonicalScore(30, 100);
    expect(strongMismatched).toBeGreaterThan(weakPerfect);
    // And the shares say why.
    expect(CAPABILITY_SHARE).toBeGreaterThanOrEqual(0.7);
  });

  it('a zero canonical score is a legitimate value, not a sentinel', () => {
    // Score 0 orders a job last; nothing anywhere may read it as "remove".
    expect(canonicalScore(0, 0)).toBe(0);
    expect(canonicalScore(0, null)).toBe(0);
  });

  it('bounded: intent moves a job by at most the intent share', () => {
    expect(canonicalScore(50, 100)).toBe(60);
    expect(canonicalScore(50, 0)).toBe(40);
  });
});

describe('compareRanked', () => {
  const entry = (
    vacancyId: string,
    canonical: number,
    capability: number,
    intent: number | null,
  ) => ({
    vacancyId,
    canonicalScore: canonical,
    capabilityScore: capability,
    intentScore: intent,
  });

  it('orders canonical desc, then capability, then intent, then vacancyId', () => {
    const list = [
      entry('d', 80, 80, null),
      entry('c', 80, 80, 50),
      entry('b', 80, 90, null),
      entry('a', 90, 50, 0),
    ];
    expect([...list].sort(compareRanked).map((e) => e.vacancyId)).toEqual([
      'a', // highest canonical wins regardless of the parts
      'b', // equal canonical → higher capability
      'c', // equal both → known intent above no-signal
      'd',
    ]);
  });

  it('equal on everything → vacancyId decides, so pages can never disagree', () => {
    const a = entry('vac-a', 50, 50, null);
    const b = entry('vac-b', 50, 50, null);
    expect(compareRanked(a, b)).toBeLessThan(0);
    expect(compareRanked(b, a)).toBeGreaterThan(0);
    expect(compareRanked(a, { ...a })).toBe(0);
  });
});

describe('MATCH_ALGORITHM_VERSION', () => {
  it('is v4.1 — advanced explainable match. Changing the policy means bumping this', () => {
    // v3 → v4: the canonical formula is unchanged, but entries now carry the
    // advanced insight payload and vacancy languages joined the
    // ranking-relevant state, so every v3 snapshot must recompute.
    expect(MATCH_ALGORITHM_VERSION).toBe('v4.1');
  });
});

import type { IntentAlignment } from '../intent-alignment';
import { evaluateEligibility } from './eligibility';

const align = (
  dimension: IntentAlignment['dimension'],
  state: IntentAlignment['state'],
  reason = 'X',
): IntentAlignment => ({
  dimension,
  state,
  reason,
  score: state === 'MATCH' ? 1 : 0,
});

const cleanMatrix = { mustTotal: 3, mustGaps: 0, mustMissing: 0 };

describe('eligibility gate', () => {
  it('ELIGIBLE when everything evaluable is compatible or unknown', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [align('workMode', 'MATCH'), align('salary', 'UNKNOWN')],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result).toEqual({ eligibility: 'ELIGIBLE', reasons: [] });
  });

  it('missing must-have evidence is PARTIAL, never BLOCKED — no evidence ≠ cannot do it', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: { mustTotal: 3, mustGaps: 1, mustMissing: 1 },
      alignments: [],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('PARTIAL');
    expect(result.reasons[0].code).toBe('MUST_HAVE_EVIDENCE_GAPS');
    expect(result.reasons[0].detail).toContain('1 of 3');
  });

  it('ALL must-haves missing gets its own exact reason — still PARTIAL', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: { mustTotal: 2, mustGaps: 2, mustMissing: 2 },
      alignments: [],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('PARTIAL');
    expect(result.reasons[0].code).toBe('ALL_MUST_HAVE_EVIDENCE_MISSING');
  });

  it('BLOCKED when stated pay is below the stated minimum (both sides stated facts)', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [
        {
          dimension: 'salary',
          state: 'MISMATCH',
          reason: 'SALARY_BELOW_MINIMUM',
          score: 0,
        },
      ],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('BLOCKED');
    expect(result.reasons[0].code).toBe('SALARY_BELOW_STATED_MINIMUM');
  });

  it('BLOCKED when work mode AND location both conflict with no relocation', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [
        align('workMode', 'MISMATCH'),
        align('location', 'MISMATCH'),
      ],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('BLOCKED');
    expect(result.reasons.map((r) => r.code).sort()).toEqual([
      'LOCATION_CONFLICT',
      'WORK_MODE_CONFLICT',
    ]);
  });

  it('the same double conflict WITH relocation stated true stays PARTIAL', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [
        align('workMode', 'MISMATCH'),
        align('location', 'MISMATCH'),
      ],
      relocation: true,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('PARTIAL');
  });

  it('a single stated mismatch is PARTIAL with its exact code', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [align('employmentType', 'MISMATCH')],
      relocation: null,
      missingRequiredLanguages: [],
    });
    expect(result.eligibility).toBe('PARTIAL');
    expect(result.reasons[0].code).toBe('EMPLOYMENT_TYPE_CONFLICT');
  });

  it('a required language absent from a stated list is PARTIAL', () => {
    const result = evaluateEligibility({
      context: 'CANDIDATE',
      matrix: cleanMatrix,
      alignments: [],
      relocation: null,
      missingRequiredLanguages: ['ko'],
    });
    expect(result.eligibility).toBe('PARTIAL');
    expect(result.reasons[0].code).toBe('REQUIRED_LANGUAGE_NOT_EVIDENCED');
    expect(result.reasons[0].detail).toContain('"ko"');
  });

  it('HR context: preference dimensions never apply, and a non-open vacancy is BLOCKED', () => {
    const blocked = evaluateEligibility({
      context: 'HR',
      matrix: cleanMatrix,
      alignments: [],
      relocation: null,
      missingRequiredLanguages: [],
      vacancyStatus: 'CLOSED',
    });
    expect(blocked.eligibility).toBe('BLOCKED');
    expect(blocked.reasons[0].code).toBe('VACANCY_NOT_OPEN');

    const open = evaluateEligibility({
      context: 'HR',
      matrix: cleanMatrix,
      alignments: [],
      relocation: null,
      missingRequiredLanguages: [],
      vacancyStatus: 'OPEN',
    });
    expect(open.eligibility).toBe('ELIGIBLE');
  });
});

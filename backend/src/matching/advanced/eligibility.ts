/**
 * The eligibility gate: how this candidate RELATES to this vacancy before any
 * weighting — ELIGIBLE / PARTIAL / BLOCKED, with exact reasons.
 *
 * Deterministic rules, and only over facts the product actually stores:
 *
 * BLOCKED — a stated-fact conflict, never a missing-evidence situation:
 *   · FX-comparable pay where the job's stated maximum is below the
 *     candidate's stated minimum (both sides said it; candidate context only);
 *   · the vacancy's work mode AND location both conflict with everything the
 *     candidate stated, with no relocation offer — per stated preferences the
 *     job cannot be attended;
 *   · HR context: the vacancy is not OPEN.
 *
 * PARTIAL — evidence gaps or single-dimension stated conflicts:
 *   · one or more MUST_HAVE requirements without current evidence
 *     ("no evidence found" is NOT "cannot do this" — §missing-evidence rule,
 *     which is exactly why it is PARTIAL and never BLOCKED);
 *   · a required vacancy language absent from the candidate's stated list;
 *   · a single stated mismatch on work mode / location / employment type /
 *     seniority.
 *
 * ELIGIBLE — everything evaluable is compatible or unknown. Unknown never
 * demotes: a candidate who stated nothing is judged on evidence alone.
 *
 * Work authorization / visa is deliberately NOT evaluated: the vacancy model
 * stores it but no candidate-side fact exists, and inventing one is exactly
 * the fabrication this engine refuses.
 */

import type { IntentAlignment } from '../intent-alignment';
import type {
  EligibilityReason,
  MatchEligibility,
} from './advanced-match.types';
import type { MatrixSummary } from './requirement-matrix';

export interface EligibilityInputs {
  context: 'CANDIDATE' | 'HR';
  matrix: MatrixSummary;
  /** Candidate context only; [] in HR context (preferences stay private). */
  alignments: readonly IntentAlignment[];
  relocation: boolean | null;
  /** Required vacancy languages not found in the candidate's stated list. */
  missingRequiredLanguages: readonly string[];
  /** HR context: the vacancy's current status. */
  vacancyStatus?: string;
}

export interface EligibilityResult {
  eligibility: MatchEligibility;
  reasons: EligibilityReason[];
}

export function evaluateEligibility(
  input: EligibilityInputs,
): EligibilityResult {
  const blocked: EligibilityReason[] = [];
  const partial: EligibilityReason[] = [];

  const byDimension = new Map(input.alignments.map((a) => [a.dimension, a]));
  const salary = byDimension.get('salary');
  const workMode = byDimension.get('workMode');
  const location = byDimension.get('location');
  const employment = byDimension.get('employmentType');
  const seniority = byDimension.get('seniority');

  if (
    input.context === 'HR' &&
    input.vacancyStatus &&
    input.vacancyStatus !== 'OPEN'
  ) {
    blocked.push({
      code: 'VACANCY_NOT_OPEN',
      detail: `This vacancy is ${input.vacancyStatus}, so no candidate is currently eligible for it.`,
    });
  }

  if (
    salary?.state === 'MISMATCH' &&
    salary.reason === 'SALARY_BELOW_MINIMUM'
  ) {
    blocked.push({
      code: 'SALARY_BELOW_STATED_MINIMUM',
      detail:
        'The stated pay for this job is below the minimum the candidate stated, compared in the same currency and period.',
    });
  }

  const unattendable =
    workMode?.state === 'MISMATCH' &&
    location?.state === 'MISMATCH' &&
    input.relocation !== true;
  if (unattendable) {
    blocked.push(
      {
        code: 'WORK_MODE_CONFLICT',
        detail:
          'The vacancy work mode conflicts with every work mode the candidate stated.',
      },
      {
        code: 'LOCATION_CONFLICT',
        detail:
          'The vacancy location is outside every location the candidate stated, and no willingness to relocate is stated.',
      },
    );
  }

  if (blocked.length > 0) {
    return { eligibility: 'BLOCKED', reasons: blocked };
  }

  const { mustTotal, mustGaps, mustMissing } = input.matrix;
  if (mustTotal > 0 && mustGaps > 0) {
    if (mustMissing === mustTotal) {
      partial.push({
        code: 'ALL_MUST_HAVE_EVIDENCE_MISSING',
        detail: `None of the ${mustTotal} must-have requirement(s) are evidenced in the current documents and links.`,
      });
    } else {
      partial.push({
        code: 'MUST_HAVE_EVIDENCE_GAPS',
        detail: `${mustGaps} of ${mustTotal} must-have requirement(s) lack clear current evidence.`,
      });
    }
  }

  for (const language of input.missingRequiredLanguages) {
    partial.push({
      code: 'REQUIRED_LANGUAGE_NOT_EVIDENCED',
      detail: `Required language "${language}" is not among the candidate's stated languages.`,
    });
  }

  if (!unattendable) {
    if (workMode?.state === 'MISMATCH') {
      partial.push({
        code: 'WORK_MODE_CONFLICT',
        detail:
          'The vacancy work mode conflicts with the work modes the candidate stated.',
      });
    }
    if (location?.state === 'MISMATCH') {
      partial.push({
        code: 'LOCATION_CONFLICT',
        detail:
          'The vacancy location is outside the locations the candidate stated.',
      });
    }
  }
  if (employment?.state === 'MISMATCH') {
    partial.push({
      code: 'EMPLOYMENT_TYPE_CONFLICT',
      detail:
        'The vacancy employment type conflicts with the types the candidate stated.',
    });
  }
  if (seniority?.state === 'MISMATCH') {
    partial.push({
      code: 'SENIORITY_GAP',
      detail:
        "The vacancy's seniority level is far from the levels the candidate stated.",
    });
  }

  return partial.length > 0
    ? { eligibility: 'PARTIAL', reasons: partial }
    : { eligibility: 'ELIGIBLE', reasons: [] };
}

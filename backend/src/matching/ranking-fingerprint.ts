import { createHash } from 'node:crypto';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import { locationKey } from '../candidate-preferences/candidate-job-intent';
import type { RankingVacancyRow } from './normalized-job-features';

/**
 * Fingerprints of the two ranking inputs a stored run must still describe.
 *
 * A stored ranking is reusable only while nothing that fed it has changed:
 * the candidate's evidence (tracked by `evidenceRevision`, elsewhere), the
 * candidate's CURRENT job intent, the ranking-relevant state of the eligible
 * catalogue, and the algorithm version. The last three are covered here.
 *
 * Both fingerprints are SEMANTIC, not positional. The intent hash sorts every
 * list first, so saving [REMOTE, HYBRID] and later re-saving it as
 * [HYBRID, REMOTE] is the same intent and the same hash — a reorder must not
 * throw away a ranking, and an actual change must. Rule N1 rides on this: the
 * moment Seoul becomes Toronto the hash differs, the old snapshot (and every
 * Seoul-flavored reason inside it) is unreachable, and the next request
 * recomputes from the only intent that exists — the current one. Deleting
 * preferences changes the hash again, to the hash of the empty intent, and
 * ranking returns to pure capability.
 */

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sortedLower(values: string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).sort();
}

/**
 * Semantic hash of the candidate's current intent.
 *
 * Excluded on purpose: `updatedAt` (a re-save of identical content bumps it
 * but changes nothing the ranking reads), `stated` (a record that exists but
 * is blank ranks identically to no record), and `candidateAccountId` (runs
 * are already per-candidate). Including any of them would invalidate runs
 * that would rank identically.
 */
export function intentFingerprint(intent: CandidateJobIntent): string {
  return sha256({
    v: 1,
    roles: sortedLower(intent.roles),
    locations: intent.locations.map(locationKey).sort(),
    workModes: [...intent.workModes].sort(),
    compensation: intent.compensation
      ? {
          minAmount: intent.compensation.minAmount,
          maxAmount: intent.compensation.maxAmount,
          currency: intent.compensation.currency,
          payPeriod: intent.compensation.payPeriod,
        }
      : null,
    employmentTypes: [...intent.employmentTypes].sort(),
    seniorityLevels: [...intent.seniorityLevels].sort(),
    relocation: intent.relocation,
    industries: sortedLower(intent.preferredIndustries),
    benefits: [...intent.preferredBenefits].sort(),
    exclusions: {
      companies: sortedLower(intent.exclusions.companies),
      jobTitles: sortedLower(intent.exclusions.jobTitles),
      locations: intent.exclusions.locations.map(locationKey).sort(),
    },
  });
}

/**
 * Hash of the ranking-relevant state of the OPEN catalogue.
 *
 * Built from exactly the columns `RANKING_VACANCY_SELECT` fetches — the
 * definition of "ranking-relevant" lives there, once. This replaces the old
 * `count:maxUpdatedAt` fingerprint, which invalidated every candidate's run
 * whenever ANY vacancy field changed, display-only ones included. Now an
 * edited application deadline leaves rankings alone, while an edited salary,
 * title, requirement, location or description (all real ranking inputs — the
 * last two feed the semantic and coverage signals) invalidates as before.
 * Opening or closing a vacancy changes the row set itself.
 *
 * Arrays whose ORDER carries no meaning (benefits, domains, remote
 * countries) are sorted before hashing; requirement order is kept because
 * the ranker caps how many it reads, so order genuinely matters there.
 */
export function vacancyRankingFingerprint(rows: RankingVacancyRow[]): string {
  const canonical = [...rows]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => [
      row.id,
      row.title,
      row.description ?? '',
      row.country ?? '',
      row.region ?? '',
      row.city ?? '',
      row.workMode ?? '',
      [...row.remoteCountriesAllowed].sort(),
      row.salaryMin,
      row.salaryMax,
      row.currency ?? '',
      row.payPeriod ?? '',
      row.employmentType ?? '',
      row.seniorityLevel ?? '',
      [...row.benefits].sort(),
      [...row.domainExperience].sort(),
      row.organization.name,
      row.requirements.map((req) => [req.text, req.required]),
      [...row.languages]
        .sort((a, b) => a.languageCode.localeCompare(b.languageCode))
        .map((lang) => [lang.languageCode, lang.level, lang.required]),
    ]);
  return sha256({ v: 1, rows: canonical });
}

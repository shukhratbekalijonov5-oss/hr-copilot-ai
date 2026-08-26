/**
 * Material conflicts inside the candidate's own CURRENT data, in neutral
 * language ("Conflicting evidence detected") — never an accusation, and never
 * invented: a claim is only compared against literally parseable dates.
 *
 * Two kinds today:
 *   EXPERIENCE_YEARS_CLAIM — profile text claims N years, dated experience
 *     supports materially fewer (margin of 2 full years before it counts).
 *   DATE_ORDER — an experience entry that ends before it starts.
 *
 * Each carries the confidencePenalty it costs the consistency component.
 */

import type { MatchContradiction } from './advanced-match.types';
import type { ProfileFacts } from './profile-facts';

const YEARS_CLAIM = /(\d{1,2})\s*\+?\s*(?:years?|yrs?|년|лет|года?|yil)/gi;

/** Highest years-of-experience figure claimed in headline+summary, if any. */
export function claimedYears(profile: ProfileFacts): number | null {
  const text = `${profile.headline ?? ''} ${profile.summary ?? ''}`;
  let best: number | null = null;
  for (const match of text.matchAll(YEARS_CLAIM)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= 60) {
      best = best === null ? value : Math.max(best, value);
    }
  }
  return best;
}

/** Career span in years from parseable experience dates, else null. */
export function datedCareerSpan(profile: ProfileFacts): number | null {
  const starts = profile.experience
    .map((e) => e.startYear)
    .filter((y): y is number => y !== null);
  const ends = profile.experience
    .map((e) => e.endYear)
    .filter((y): y is number => y !== null);
  if (starts.length === 0 || ends.length === 0) return null;
  return Math.max(0, Math.max(...ends) - Math.min(...starts));
}

export function detectContradictions(
  profile: ProfileFacts,
): MatchContradiction[] {
  const found: MatchContradiction[] = [];

  const claimed = claimedYears(profile);
  const span = datedCareerSpan(profile);
  if (claimed !== null && span !== null && claimed > span + 2) {
    found.push({
      kind: 'EXPERIENCE_YEARS_CLAIM',
      summary:
        `Conflicting evidence detected: the profile text states ` +
        `${claimed} years of experience, while the dated experience ` +
        `entries span about ${span} year(s).`,
      sourceA: `Profile text ("${claimed} years")`,
      sourceB: 'Dated experience entries',
      confidencePenalty: 5,
    });
  }

  let dateOrder = 0;
  for (const exp of profile.experience) {
    if (
      exp.startYear !== null &&
      exp.endYear !== null &&
      !exp.isCurrent &&
      exp.endYear < exp.startYear &&
      dateOrder < 2
    ) {
      dateOrder += 1;
      found.push({
        kind: 'DATE_ORDER',
        summary:
          `Conflicting evidence detected: the experience entry ` +
          `"${exp.title}" ends (${exp.endYear}) before it starts (${exp.startYear}).`,
        sourceA: `"${exp.title}" start date`,
        sourceB: `"${exp.title}" end date`,
        confidencePenalty: 3,
      });
    }
  }

  return found;
}

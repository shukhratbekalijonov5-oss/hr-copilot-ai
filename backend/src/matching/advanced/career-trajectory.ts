/**
 * Career trajectory: do the candidate's RECENT roles point toward this
 * vacancy's kind of work and level? Chronology only — no promotion is ever
 * inferred that the entries do not state.
 *
 *   STRONG  — recent roles aligned with the vacancy's family AND the title
 *             seniority rank rose over the dated history.
 *   ALIGNED — recent roles aligned, no demonstrated rise.
 *   MIXED   — some recent roles aligned, some not.
 *   WEAK    — recent roles in unrelated families (both sides classifiable).
 *   UNKNOWN — not enough dated/classifiable data to say anything.
 */

import { ROLE_FAMILY_TITLES, SENIORITY_ORDER } from '../intent-alignment';
import type { CareerTrajectory } from './advanced-match.types';
import { inferSeniorityFromTitles } from './dimensions';
import type { ExperienceFact, ProfileFacts } from './profile-facts';

function familiesOf(title: string): Set<string> {
  const lowered = title.toLowerCase();
  const families = new Set<string>();
  for (const [family, markers] of Object.entries(ROLE_FAMILY_TITLES)) {
    if (markers.some((m) => lowered.includes(m))) families.add(family);
  }
  if (families.has('frontend') && families.has('backend')) {
    families.add('fullstack');
  }
  return families;
}

function seniorityRank(exp: ExperienceFact): number | null {
  const level = inferSeniorityFromTitles([exp]);
  if (!level) return null;
  const idx = SENIORITY_ORDER.indexOf(level);
  return idx < 0 ? null : idx;
}

export function buildCareerTrajectory(
  profile: ProfileFacts,
  vacancyTitle: string,
): CareerTrajectory {
  const vacancyFamilies = familiesOf(vacancyTitle);
  const dated = profile.experience
    .filter((e) => e.startYear !== null)
    .sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0));
  const ordered = dated.length > 0 ? dated : profile.experience;

  if (ordered.length === 0 || vacancyFamilies.size === 0) {
    return {
      status: 'UNKNOWN',
      score: null,
      reasons: [
        ordered.length === 0
          ? 'No experience entries to read a trajectory from.'
          : 'The vacancy title does not map to a known role family.',
      ],
    };
  }

  const recent = ordered.slice(0, 2);
  const classified = recent.filter((e) => familiesOf(e.title).size > 0);
  if (classified.length === 0) {
    return {
      status: 'UNKNOWN',
      score: null,
      reasons: ['Recent role titles do not map to known role families.'],
    };
  }

  const aligned = classified.filter((e) =>
    [...familiesOf(e.title)].some((f) => vacancyFamilies.has(f)),
  );
  const reasons: string[] = [];

  if (aligned.length === classified.length) {
    for (const e of aligned) {
      reasons.push(
        `Recent role "${e.title}" is in the same role family as this vacancy.`,
      );
    }
    // Progression: strictly from what the titles state, oldest dated vs
    // newest dated. No dates → no progression claim.
    let progressed = false;
    if (dated.length >= 2) {
      const newest = seniorityRank(dated[0]);
      const oldest = seniorityRank(dated[dated.length - 1]);
      if (newest !== null && oldest !== null && newest > oldest) {
        progressed = true;
        reasons.push(
          `Title seniority rose from "${dated[dated.length - 1].title}" to "${dated[0].title}".`,
        );
      }
    }
    return progressed
      ? { status: 'STRONG', score: 1, reasons }
      : { status: 'ALIGNED', score: 0.8, reasons };
  }

  if (aligned.length > 0) {
    reasons.push(
      `Some recent roles align with this vacancy's role family and some do not.`,
    );
    return { status: 'MIXED', score: 0.5, reasons };
  }

  reasons.push(
    'Recent roles are in a different role family than this vacancy.',
  );
  return { status: 'WEAK', score: 0.2, reasons };
}

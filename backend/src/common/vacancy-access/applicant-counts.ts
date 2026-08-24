import type { PrismaService } from '../../prisma/prisma.service';
import { APPLICANT_APPLICATION_SCOPE } from './applicant-scope';

/**
 * How many PEOPLE have applied to a vacancy — the one definition.
 *
 * ## One candidate is one applicant
 *
 * `_count.applications` counts ATTEMPTS, and since reapply-after-rejection a
 * single person can hold several attempts on the same vacancy. Counting rows
 * would report 5 where three people applied. Prisma's `_count` has no
 * DISTINCT, so the distinct (vacancy, candidate) pairs are read for the
 * vacancies in question and tallied here.
 *
 * Nothing is deduplicated in the DATA: every attempt still exists and every
 * attempt-level endpoint still returns all of them. Only the headline number
 * collapses to people.
 *
 * ## Why candidates and recruiters share this function
 *
 * A job page that advertises "12 applicants" while the recruiter's dashboard
 * says 9 is not a cosmetic inconsistency — it is the product telling two
 * people different things about the same fact, and a candidate deciding
 * whether to apply is acting on it. Both surfaces call THIS, with the same
 * applicant scope, so the number cannot describe two different universes.
 *
 * The count is computed live rather than stored: a denormalized counter would
 * need every status change, withdrawal, cascade delete and reapply to
 * remember to update it, and the first one that forgot would be wrong forever.
 */
export async function uniqueApplicantCounts(
  prisma: PrismaService,
  vacancyIds: string[],
): Promise<Map<string, number>> {
  if (vacancyIds.length === 0) return new Map();

  const pairs = await prisma.application.findMany({
    where: {
      vacancyId: { in: vacancyIds },
      ...APPLICANT_APPLICATION_SCOPE,
    },
    select: { vacancyId: true, candidateId: true },
    distinct: ['vacancyId', 'candidateId'],
  });

  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.vacancyId, (counts.get(pair.vacancyId) ?? 0) + 1);
  }
  return counts;
}

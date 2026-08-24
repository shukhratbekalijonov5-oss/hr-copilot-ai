import { BadRequestException } from '@nestjs/common';
import {
  CitizenshipRequirement,
  WorkMode,
  JobBenefit,
} from '../generated/prisma/enums';

/**
 * The subset of a vacancy the cross-field rules care about. Deliberately
 * structural rather than the Prisma row type: the same function judges a
 * create payload and a PATCH merged onto the stored row.
 */
export interface VacancyProfileShape {
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  workMode?: WorkMode | null;
  officeDaysPerWeek?: number | null;
  remoteCountriesAllowed?: string[] | null;
  minExperienceYears?: number | null;
  preferredExperienceYears?: number | null;
  citizenshipRequirement?: CitizenshipRequirement | null;
  eligibleNationalities?: string[] | null;
  benefits?: JobBenefit[] | null;
  benefitsOther?: string | null;
}

/**
 * Rules that span more than one field.
 *
 * Kept out of the DTO on purpose. class-validator sees only the fragment in
 * the request, and a PATCH that lowers `salaryMax` alone would pass every
 * per-field rule while producing a stored row where min > max. These rules
 * therefore run in the service, against the MERGED result — the row as it will
 * actually exist — which is also the only shape in which they are meaningful.
 *
 * Messages follow the "<field> must ..." convention the frontend parses into
 * per-input errors, so the form highlights the field the recruiter can fix.
 */
export function assertVacancyProfile(profile: VacancyProfileShape): void {
  const errors: string[] = [];

  const { salaryMin, salaryMax, currency } = profile;
  const hasSalary =
    salaryMin !== null && salaryMin !== undefined
      ? true
      : salaryMax !== null && salaryMax !== undefined;

  if (
    salaryMin !== null &&
    salaryMin !== undefined &&
    salaryMax !== null &&
    salaryMax !== undefined &&
    salaryMin > salaryMax
  ) {
    errors.push('salaryMax must be greater than or equal to salaryMin');
  }
  // An amount with no currency is not a salary: "55,000,000" is unreadable to
  // a candidate and unusable to a matcher.
  if (hasSalary && !currency) {
    errors.push('currency must be set when a salary range is given');
  }

  const { minExperienceYears: min, preferredExperienceYears: preferred } =
    profile;
  if (
    min !== null &&
    min !== undefined &&
    preferred !== null &&
    preferred !== undefined &&
    preferred < min
  ) {
    errors.push(
      'preferredExperienceYears must be greater than or equal to minExperienceYears',
    );
  }

  // A citizenship restriction with no nationalities restricts nothing while
  // reading as a restriction — the one case that cannot be normalized away,
  // because the missing list cannot be invented.
  if (
    profile.citizenshipRequirement === CitizenshipRequirement.SPECIFIC &&
    (profile.eligibleNationalities ?? []).length === 0
  ) {
    errors.push(
      'eligibleNationalities must list at least one nationality when citizenshipRequirement is SPECIFIC',
    );
  }

  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: errors,
    });
  }
}

/**
 * Clears fields that the row's own shape makes meaningless.
 *
 * These are stale-UI leftovers, not contradictory intent: switching a hybrid
 * role to REMOTE leaves an office-days value behind that the recruiter can no
 * longer even see. Rejecting the edit would block a legitimate change, so the
 * dependent value is dropped instead and the row stays internally coherent —
 * which is what later matching will read.
 *
 * Only ever clears; it never invents a value.
 */
export function normalizeVacancyProfile<T extends VacancyProfileShape>(
  profile: T,
): T {
  const next = { ...profile };

  if (next.workMode === WorkMode.REMOTE) {
    if (next.officeDaysPerWeek !== undefined) next.officeDaysPerWeek = null;
  } else if (next.workMode !== null && next.workMode !== undefined) {
    // ONSITE/HYBRID: an allow-list of remote countries describes nothing.
    if (next.remoteCountriesAllowed !== undefined) {
      next.remoteCountriesAllowed = [];
    }
  }

  if (next.citizenshipRequirement === CitizenshipRequirement.NONE) {
    if (next.eligibleNationalities !== undefined) {
      next.eligibleNationalities = [];
    }
  }

  const benefits = next.benefits;
  if (benefits && !benefits.includes(JobBenefit.OTHER)) {
    if (next.benefitsOther !== undefined) next.benefitsOther = null;
  }

  return next;
}

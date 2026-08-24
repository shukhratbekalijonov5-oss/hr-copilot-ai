import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_PREFERENCE_ENTRY_LENGTH,
  normalizeEnumList,
  normalizePreferenceEntries,
} from '../common/vacancy/job-vocabulary';
import { PreferredLocationKind } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import {
  emptyJobIntent,
  locationKey,
  type CandidateJobIntent,
  type JobIntentLocation,
} from './candidate-job-intent';
import type {
  PreferredLocationDto,
  PutJobPreferencesDto,
} from './dto/job-preferences.dto';

/** The rows a preference read needs; one query, locations included. */
const PREFERENCES_SELECT = {
  id: true,
  candidateAccountId: true,
  preferredJobTitles: true,
  preferredWorkModes: true,
  preferredEmploymentTypes: true,
  preferredSeniorityLevels: true,
  desiredSalaryMin: true,
  desiredSalaryMax: true,
  salaryCurrency: true,
  payPeriod: true,
  willingToRelocate: true,
  preferredIndustries: true,
  preferredBenefits: true,
  excludedCompanies: true,
  excludedJobTitles: true,
  createdAt: true,
  updatedAt: true,
  locations: {
    select: { kind: true, countryCode: true, region: true, city: true },
    // Stable order so the same preferences render identically twice.
    orderBy: [{ countryCode: 'asc' }, { region: 'asc' }, { city: 'asc' }],
  },
} satisfies Prisma.CandidateJobPreferencesSelect;

/**
 * The candidate's stated job intent: the one place it is written and the one
 * place it is read from.
 *
 * ## Rule N1
 *
 * Preferences are candidate-owned, so exactly ONE current version exists.
 * There is no history table, no per-application copy and no snapshot. A write
 * REPLACES the whole profile inside a transaction — child location rows are
 * deleted and re-inserted, never merged — so a candidate who changes Seoul to
 * Busan leaves nothing behind that any surface could still retrieve. `remove()`
 * deletes the record and the FK cascade takes the locations with it.
 *
 * ## Nothing is inferred
 *
 * Every value here exists because the candidate typed it. Resumes,
 * applications, saved jobs, profile location and model output are all
 * forbidden sources — a preference the candidate did not state is not a
 * preference, and reading one in would make this table lie about consent.
 */
@Injectable()
export class CandidatePreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's own candidate account id.
   *
   * Resolved from the AUTHENTICATED user, never from anything the client
   * sends — there is no account id in any route, body or query on this
   * surface, so one candidate cannot address another's preferences.
   *
   * Deliberately a local lookup rather than a call into CandidateAccountService:
   * that module consumes the intent resolver, and depending back on it would
   * make the two circular.
   */
  async requireAccountId(userId: string): Promise<string> {
    const account = await this.prisma.candidateAccount.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!account) {
      throw new BadRequestException(
        'A candidate account is required. Create one via POST /candidate-account first.',
      );
    }
    return account.id;
  }

  /**
   * THE shared resolver: an account id in, canonical intent out.
   *
   * Every candidate→jobs surface calls this rather than reading the tables, so
   * one candidate has one interpretation of their intent across Find Jobs, AI
   * Job Match and every future external provider search. A candidate with no
   * record gets a well-formed empty intent rather than null, so "stated
   * nothing" can never become an unhandled branch that filters everything out.
   */
  async resolveIntent(candidateAccountId: string): Promise<CandidateJobIntent> {
    const stored = await this.prisma.candidateJobPreferences.findUnique({
      where: { candidateAccountId },
      select: PREFERENCES_SELECT,
    });
    if (!stored) return emptyJobIntent(candidateAccountId);

    const locations = this.toIntentLocations(
      stored.locations,
      PreferredLocationKind.PREFERRED,
    );

    return {
      candidateAccountId,
      stated: true,
      roles: stored.preferredJobTitles,
      locations,
      // Derived, never stored separately, so it cannot drift from `locations`.
      countries: [...new Set(locations.map((l) => l.countryCode))],
      workModes: stored.preferredWorkModes,
      // Present only as a complete, comparable triple. The write path
      // guarantees the three move together, so this cannot be half-stated.
      compensation:
        stored.desiredSalaryMin !== null &&
        stored.salaryCurrency !== null &&
        stored.payPeriod !== null
          ? {
              minAmount: stored.desiredSalaryMin,
              // Optional upper end. Null means they named only a floor —
              // never a ceiling of zero, and never an implied one.
              maxAmount: stored.desiredSalaryMax,
              currency: stored.salaryCurrency,
              payPeriod: stored.payPeriod,
            }
          : null,
      employmentTypes: stored.preferredEmploymentTypes,
      seniorityLevels: stored.preferredSeniorityLevels,
      relocation: stored.willingToRelocate,
      preferredIndustries: stored.preferredIndustries,
      preferredBenefits: stored.preferredBenefits,
      exclusions: {
        companies: stored.excludedCompanies,
        jobTitles: stored.excludedJobTitles,
        locations: this.toIntentLocations(
          stored.locations,
          PreferredLocationKind.EXCLUDED,
        ),
      },
      updatedAt: stored.updatedAt.toISOString(),
    };
  }

  /** The stored profile as the candidate's own API returns it. */
  async getMine(candidateAccountId: string) {
    const stored = await this.prisma.candidateJobPreferences.findUnique({
      where: { candidateAccountId },
      select: PREFERENCES_SELECT,
    });
    // A candidate who has stated nothing is not an error — it is the normal
    // starting state, and the form needs an empty shape to render.
    if (!stored) return this.emptyResponse();

    return {
      stated: true,
      preferredJobTitles: stored.preferredJobTitles,
      preferredLocations: this.toIntentLocations(
        stored.locations,
        PreferredLocationKind.PREFERRED,
      ),
      preferredWorkModes: stored.preferredWorkModes,
      preferredEmploymentTypes: stored.preferredEmploymentTypes,
      preferredSeniorityLevels: stored.preferredSeniorityLevels,
      desiredSalaryMin: stored.desiredSalaryMin,
      desiredSalaryMax: stored.desiredSalaryMax,
      salaryCurrency: stored.salaryCurrency,
      payPeriod: stored.payPeriod,
      willingToRelocate: stored.willingToRelocate,
      preferredIndustries: stored.preferredIndustries,
      preferredBenefits: stored.preferredBenefits,
      excludedCompanies: stored.excludedCompanies,
      excludedJobTitles: stored.excludedJobTitles,
      excludedLocations: this.toIntentLocations(
        stored.locations,
        PreferredLocationKind.EXCLUDED,
      ),
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
    };
  }

  /**
   * Replaces the candidate's whole preference profile.
   *
   * PUT, not PATCH: the body is the complete current state, so an absent list
   * is an empty list and an absent scalar is null. The write is one
   * transaction — upsert the record, delete every location row, insert the
   * current set — because "current only" has to include the child rows. A
   * merge would leave the previous Seoul row alive next to the new Busan one,
   * and both would then be retrievable as current intent.
   */
  async replace(candidateAccountId: string, dto: PutJobPreferencesDto) {
    const data = this.normalize(dto);
    const preferred = this.normalizeLocations(
      dto.preferredLocations ?? [],
      PreferredLocationKind.PREFERRED,
    );
    const excluded = this.normalizeLocations(
      dto.excludedLocations ?? [],
      PreferredLocationKind.EXCLUDED,
    );
    const locations = [...preferred, ...excluded];

    await this.prisma.$transaction(async (tx) => {
      const record = await tx.candidateJobPreferences.upsert({
        where: { candidateAccountId },
        create: { candidateAccountId, ...data },
        update: data,
        select: { id: true },
      });
      // Replace-all, inside the same transaction as the scalar write: either
      // the whole new intent is current or none of it is.
      await tx.candidatePreferredLocation.deleteMany({
        where: { preferencesId: record.id },
      });
      if (locations.length > 0) {
        await tx.candidatePreferredLocation.createMany({
          data: locations.map((location) => ({
            preferencesId: record.id,
            ...location,
          })),
        });
      }
    });

    return this.getMine(candidateAccountId);
  }

  /**
   * Deletes the profile entirely. The location rows go with it through the FK
   * cascade, so nothing survives to be read as current intent — the candidate
   * returns to "has stated nothing", which is a real state and not an error.
   */
  async remove(candidateAccountId: string) {
    const existing = await this.prisma.candidateJobPreferences.findUnique({
      where: { candidateAccountId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('No job preferences to delete');
    }
    await this.prisma.candidateJobPreferences.delete({
      where: { candidateAccountId },
    });
    return { deleted: true };
  }

  /**
   * The scalar columns, normalized and checked as a whole.
   *
   * Compensation is the one cross-field rule: an amount, a currency and a pay
   * period are meaningful only together — "50,000,000" cannot be compared with
   * any job's pay without knowing the currency and the period — so all three
   * are required together and all three clear together. That single invariant
   * is what lets the intent expose `compensation` as either a complete triple
   * or null, with no half-stated third case for consumers to handle.
   */
  private normalize(dto: PutJobPreferencesDto) {
    const salary = dto.desiredSalaryMin ?? null;
    const salaryMax = dto.desiredSalaryMax ?? null;
    const currency = dto.salaryCurrency ?? null;
    const payPeriod = dto.payPeriod ?? null;

    // A range needs a floor. A maximum on its own describes nothing a job can
    // be compared against — and silently inventing a minimum of zero would
    // turn "I'd like up to 40k" into "any pay at all is acceptable".
    if (salaryMax !== null && salary === null) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'desiredSalaryMin must be set when desiredSalaryMax is given',
        ],
      });
    }
    if (salary !== null && salaryMax !== null && salaryMax < salary) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'desiredSalaryMax must be greater than or equal to desiredSalaryMin',
        ],
      });
    }

    if (salary !== null && (currency === null || payPeriod === null)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'salaryCurrency must be set when desiredSalaryMin is given',
          'payPeriod must be set when desiredSalaryMin is given',
        ].filter((_, index) =>
          index === 0 ? currency === null : payPeriod === null,
        ),
      });
    }
    if (salary === null && (currency !== null || payPeriod !== null)) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [
          'desiredSalaryMin must be set when a currency or pay period is given',
        ],
      });
    }

    return {
      preferredJobTitles: normalizePreferenceEntries(
        dto.preferredJobTitles ?? [],
      ),
      preferredWorkModes: normalizeEnumList(dto.preferredWorkModes ?? []),
      preferredEmploymentTypes: normalizeEnumList(
        dto.preferredEmploymentTypes ?? [],
      ),
      preferredSeniorityLevels: normalizeEnumList(
        dto.preferredSeniorityLevels ?? [],
      ),
      desiredSalaryMin: salary,
      // Clearing the floor clears the whole expectation: min, max, currency
      // and period are one statement, and a stranded maximum would be a
      // half-stated preference no consumer could read.
      desiredSalaryMax: salary === null ? null : salaryMax,
      salaryCurrency: currency,
      payPeriod,
      // `?? null` and never `?? false`: an unanswered relocation question is
      // not a refusal, and it is never inferred from the preferred locations.
      willingToRelocate: dto.willingToRelocate ?? null,
      preferredIndustries: normalizePreferenceEntries(
        dto.preferredIndustries ?? [],
      ),
      preferredBenefits: normalizeEnumList(dto.preferredBenefits ?? []),
      excludedCompanies: normalizePreferenceEntries(
        dto.excludedCompanies ?? [],
      ),
      excludedJobTitles: normalizePreferenceEntries(
        dto.excludedJobTitles ?? [],
      ),
    };
  }

  /**
   * Trims, upper-cases the country, drops blank region/city and removes
   * case-insensitive duplicates.
   *
   * Done here rather than with a database constraint because Postgres treats
   * NULLs as distinct: a unique index over (country, region, city) would
   * happily accept two bare "KR" rows, which is precisely the duplicate that
   * matters most.
   */
  private normalizeLocations(
    locations: PreferredLocationDto[],
    kind: PreferredLocationKind,
  ) {
    const seen = new Set<string>();
    const out: {
      kind: PreferredLocationKind;
      countryCode: string;
      region: string | null;
      city: string | null;
    }[] = [];

    for (const raw of locations) {
      const text = (value: string | null | undefined) => {
        const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
        return trimmed.length > 0
          ? trimmed.slice(0, MAX_PREFERENCE_ENTRY_LENGTH)
          : null;
      };
      const location = {
        kind,
        countryCode: raw.countryCode.toUpperCase(),
        region: text(raw.region),
        city: text(raw.city),
      };
      const key = locationKey(location);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(location);
    }
    return out;
  }

  private toIntentLocations(
    rows: {
      kind: PreferredLocationKind;
      countryCode: string;
      region: string | null;
      city: string | null;
    }[],
    kind: PreferredLocationKind,
  ): JobIntentLocation[] {
    return rows
      .filter((row) => row.kind === kind)
      .map((row) => ({
        countryCode: row.countryCode,
        region: row.region,
        city: row.city,
      }));
  }

  /** The shape a candidate who has stated nothing gets back. */
  private emptyResponse() {
    return {
      stated: false,
      preferredJobTitles: [],
      preferredLocations: [] as JobIntentLocation[],
      preferredWorkModes: [],
      preferredEmploymentTypes: [],
      preferredSeniorityLevels: [],
      desiredSalaryMin: null,
      desiredSalaryMax: null,
      salaryCurrency: null,
      payPeriod: null,
      willingToRelocate: null,
      preferredIndustries: [],
      preferredBenefits: [],
      excludedCompanies: [],
      excludedJobTitles: [],
      excludedLocations: [] as JobIntentLocation[],
      createdAt: null,
      updatedAt: null,
    };
  }
}

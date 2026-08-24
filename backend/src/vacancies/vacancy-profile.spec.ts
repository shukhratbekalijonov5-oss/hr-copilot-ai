import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVacancyDto } from './dto/create-vacancy.dto';
import { VacanciesService } from './vacancies.service';
import {
  assertVacancyProfile,
  normalizeVacancyProfile,
} from './vacancy-profile.validation';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { VACANCY_ERROR_CODES } from '../common/vacancy-access/vacancy-policy';
import type { PrismaService } from '../prisma/prisma.service';

const ORG = 'org-a';
/** The vacancy creator — the only HR user allowed to edit it. */
const OWNER = 'user-owner';
/** A same-organization colleague who did NOT create it. */
const COLLEAGUE = 'user-colleague';
const VACANCY = 'vacancy-1';

/**
 * The structured vacancy profile.
 *
 * The rules under test are the ones that keep a job HONEST: a range that runs
 * backwards, an amount with no currency, a citizenship restriction that
 * restricts nothing, and — the one that matters most for a PATCH — a fragment
 * that is individually valid but produces an invalid stored row.
 */
/**
 * The messages a failed profile validation carries.
 *
 * They live in the response BODY (a string[] the frontend splits into
 * per-field errors), not in `error.message` — so asserting on the exception's
 * message would silently match nothing.
 */
function profileErrors(
  profile: Parameters<typeof assertVacancyProfile>[0],
): string[] {
  try {
    assertVacancyProfile(profile);
  } catch (error) {
    const body = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return body.message;
  }
  return [];
}

describe('Structured vacancy profile', () => {
  describe('cross-field rules', () => {
    it('rejects a salary range that runs backwards', () => {
      expect(() =>
        assertVacancyProfile({
          salaryMin: 70_000_000,
          salaryMax: 55_000_000,
          currency: 'KRW',
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts a single-point range where min equals max', () => {
      expect(() =>
        assertVacancyProfile({
          salaryMin: 60_000_000,
          salaryMax: 60_000_000,
          currency: 'KRW',
        }),
      ).not.toThrow();
    });

    it('requires a currency once any salary bound is given', () => {
      expect(profileErrors({ salaryMax: 70_000_000 })).toEqual([
        expect.stringMatching(/^currency must /),
      ]);
      // …and only then. A vacancy that states no pay is perfectly valid.
      expect(profileErrors({})).toEqual([]);
    });

    it('rejects a preferred experience below the minimum', () => {
      expect(
        profileErrors({ minExperienceYears: 5, preferredExperienceYears: 3 }),
      ).toEqual([expect.stringMatching(/^preferredExperienceYears must /)]);
      expect(() =>
        assertVacancyProfile({
          minExperienceYears: 5,
          preferredExperienceYears: 7,
        }),
      ).not.toThrow();
    });

    it('rejects a SPECIFIC citizenship requirement with no nationalities', () => {
      expect(
        profileErrors({
          citizenshipRequirement: 'SPECIFIC',
          eligibleNationalities: [],
        }),
      ).toEqual([expect.stringMatching(/^eligibleNationalities must /)]);
    });

    it('leaves an unstated work-authorization policy unstated', () => {
      // The whole point of the tri-state: silence is not a "no".
      expect(() =>
        assertVacancyProfile({ citizenshipRequirement: 'NONE' }),
      ).not.toThrow();
    });

    it('reports every broken rule at once, field-prefixed for the form', () => {
      try {
        assertVacancyProfile({
          salaryMin: 9,
          salaryMax: 1,
          minExperienceYears: 8,
          preferredExperienceYears: 2,
        });
        throw new Error('expected a validation failure');
      } catch (error) {
        const messages = (error as BadRequestException).getResponse() as {
          message: string[];
        };
        expect(messages.message).toHaveLength(3);
        // The leading token is the field name the frontend highlights.
        expect(messages.message.every((m) => /^[a-z]\w+ must /.test(m))).toBe(
          true,
        );
      }
    });
  });

  describe('normalization', () => {
    it('drops office days when the role became fully remote', () => {
      const normalized = normalizeVacancyProfile({
        workMode: 'REMOTE',
        officeDaysPerWeek: 2,
      });
      expect(normalized.officeDaysPerWeek).toBeNull();
    });

    it('drops a remote-country allow-list from an on-site role', () => {
      const normalized = normalizeVacancyProfile({
        workMode: 'ONSITE',
        remoteCountriesAllowed: ['UZ'],
      });
      expect(normalized.remoteCountriesAllowed).toEqual([]);
    });

    it('drops nationalities when the restriction is lifted', () => {
      const normalized = normalizeVacancyProfile({
        citizenshipRequirement: 'NONE',
        eligibleNationalities: ['KR'],
      });
      expect(normalized.eligibleNationalities).toEqual([]);
    });

    it('never invents a value — only clears', () => {
      const untouched = normalizeVacancyProfile({ workMode: 'HYBRID' });
      expect(untouched).toEqual({ workMode: 'HYBRID' });
    });
  });
});

function createPrismaMock() {
  const mock = {
    organization: { findUnique: jest.fn().mockResolvedValue({ slug: 'acme' }) },
    vacancy: {
      create: jest.fn().mockResolvedValue({ id: VACANCY }),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ id: VACANCY }),
    },
    application: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) =>
      typeof arg === 'function' ? arg(mock) : Promise.all(arg),
  );
  return mock;
}

describe('VacanciesService — structured profile write path', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: VacanciesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new VacanciesService(
      prisma as unknown as PrismaService,
      { getSignedUrl: jest.fn() } as never,
      new TenantService(),
      { enqueueVacancyIndexSync: jest.fn().mockResolvedValue('j') } as never,
      { purgeVacancyConversationsTx: jest.fn().mockResolvedValue([]) } as never,
      { publish: jest.fn() } as never,
      // The REAL ownership policy over the same mock, so 403s are exercised.
      new OwnedVacancyService(prisma as unknown as PrismaService),
    );
  });

  /** The vacancy exists in ORG, created by OWNER. */
  function ownedByOwner(stored: Record<string, unknown> = {}) {
    prisma.vacancy.findFirst.mockResolvedValue({
      id: VACANCY,
      title: 'Senior DevOps Engineer',
      status: 'OPEN',
      createdById: OWNER,
    });
    prisma.vacancy.findUniqueOrThrow.mockResolvedValue(stored);
  }

  it('persists a fully specified vacancy, languages included', async () => {
    await service.create(ORG, OWNER, {
      title: 'Senior DevOps Engineer',
      salaryMin: 55_000_000,
      salaryMax: 70_000_000,
      currency: 'KRW',
      payPeriod: 'YEARLY',
      country: 'KR',
      city: 'Seoul',
      workMode: 'HYBRID',
      officeDaysPerWeek: 2,
      foreignApplicantsAccepted: true,
      visaSponsorship: 'YES',
      eligibleVisaTypes: ['E-7'],
      seniorityLevel: 'SENIOR',
      minExperienceYears: 5,
      preferredExperienceYears: 7,
      benefits: ['HEALTH_INSURANCE', 'EDUCATION_BUDGET'],
      openingsCount: 2,
      hiringUrgency: 'HIGH',
      languages: [
        { languageCode: 'ko', level: 'B1', required: true },
        { languageCode: 'en', level: 'B2', required: false },
      ],
    });

    const { data } = prisma.vacancy.create.mock.calls[0][0];
    expect(data).toMatchObject({
      salaryMin: 55_000_000,
      currency: 'KRW',
      workMode: 'HYBRID',
      officeDaysPerWeek: 2,
      visaSponsorship: 'YES',
      seniorityLevel: 'SENIOR',
      benefits: ['HEALTH_INSURANCE', 'EDUCATION_BUDGET'],
      openingsCount: 2,
    });
    expect(data.languages.create).toEqual([
      { languageCode: 'ko', level: 'B1', required: true },
      { languageCode: 'en', level: 'B2', required: false },
    ]);
  });

  it('accepts the yyyy-mm-dd a date input produces', async () => {
    // A <input type="date"> sends "2026-09-30"; Prisma refuses anything that
    // is not a full ISO-8601 DateTime, so the two have to be reconciled
    // server-side or every deadline a recruiter picks is a 500.
    await service.create(ORG, OWNER, {
      title: 'Senior DevOps Engineer',
      applicationDeadline: '2026-09-30',
      expectedStartDate: '2026-11-01',
    });

    const { data } = prisma.vacancy.create.mock.calls[0][0];
    expect(data.applicationDeadline).toBe('2026-09-30T00:00:00.000Z');
    expect(data.expectedStartDate).toBe('2026-11-01T00:00:00.000Z');
    // Midnight UTC, so rendering it back with slice(0, 10) returns the very
    // day that was typed rather than the one before it.
    expect(String(data.applicationDeadline).slice(0, 10)).toBe('2026-09-30');
  });

  it('passes a full timestamp through untouched', async () => {
    await service.create(ORG, OWNER, {
      title: 'Senior DevOps Engineer',
      applicationDeadline: '2026-09-30T15:30:00.000Z',
    });
    expect(
      prisma.vacancy.create.mock.calls[0][0].data.applicationDeadline,
    ).toBe('2026-09-30T15:30:00.000Z');
  });

  it('still creates a title-only vacancy, inventing nothing', async () => {
    await service.create(ORG, OWNER, { title: 'Office Manager' });

    const { data } = prisma.vacancy.create.mock.calls[0][0];
    expect(data.title).toBe('Office Manager');
    // Every structured field must be ABSENT, not defaulted: this employer
    // stated no salary, no work mode and no visa policy.
    for (const key of ['salaryMin', 'currency', 'workMode', 'seniorityLevel']) {
      expect(data[key]).toBeUndefined();
    }
    expect(data.languages).toBeUndefined();
  });

  it('judges a PATCH against the MERGED row, not the fragment', async () => {
    // Individually valid: 40,000,000 is a fine number. Against the stored
    // minimum of 55,000,000 it is a backwards range.
    ownedByOwner({ salaryMin: 55_000_000, currency: 'KRW' });

    await expect(
      service.update(ORG, OWNER, VACANCY, { salaryMax: 40_000_000 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
  });

  it('accepts the same PATCH when the merged row is coherent', async () => {
    ownedByOwner({ salaryMin: 55_000_000, currency: 'KRW' });

    await service.update(ORG, OWNER, VACANCY, { salaryMax: 80_000_000 });

    expect(prisma.vacancy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ salaryMax: 80_000_000 }),
      }),
    );
  });

  it('clears the stale office days when a hybrid role turns remote', async () => {
    ownedByOwner({ workMode: 'HYBRID', officeDaysPerWeek: 3 });

    await service.update(ORG, OWNER, VACANCY, { workMode: 'REMOTE' });

    // The recruiter never sent officeDaysPerWeek — but leaving 3 behind would
    // describe a remote job with three office days.
    expect(prisma.vacancy.update.mock.calls[0][0].data).toMatchObject({
      workMode: 'REMOTE',
      officeDaysPerWeek: null,
    });
  });

  it('leaves unsent fields alone instead of nulling them', async () => {
    ownedByOwner({
      salaryMin: 1,
      salaryMax: 2,
      currency: 'USD',
      workMode: 'ONSITE',
    });

    await service.update(ORG, OWNER, VACANCY, { openingsCount: 3 });

    const { data } = prisma.vacancy.update.mock.calls[0][0];
    expect(data.openingsCount).toBe(3);
    expect(data).not.toHaveProperty('salaryMin');
    expect(data).not.toHaveProperty('currency');
  });

  it('replaces the language set wholesale, and [] clears it', async () => {
    ownedByOwner();

    await service.update(ORG, OWNER, VACANCY, {
      languages: [{ languageCode: 'uz', level: 'NATIVE' }],
    });
    expect(prisma.vacancy.update.mock.calls[0][0].data.languages).toEqual({
      deleteMany: {},
      create: [{ languageCode: 'uz', level: 'NATIVE', required: true }],
    });

    prisma.vacancy.update.mockClear();
    await service.update(ORG, OWNER, VACANCY, { languages: [] });
    expect(prisma.vacancy.update.mock.calls[0][0].data.languages).toEqual({
      deleteMany: {},
      create: [],
    });
  });

  it('does not touch languages when the field is absent', async () => {
    ownedByOwner();

    await service.update(ORG, OWNER, VACANCY, { department: 'Platform' });

    expect(prisma.vacancy.update.mock.calls[0][0].data).not.toHaveProperty(
      'languages',
    );
  });

  it('lets the owner edit', async () => {
    ownedByOwner();
    await expect(
      service.update(ORG, OWNER, VACANCY, { seniorityLevel: 'LEAD' }),
    ).resolves.toBeDefined();
  });

  it('refuses a same-org colleague, before reading or writing anything', async () => {
    ownedByOwner();

    await expect(
      service.update(ORG, COLLEAGUE, VACANCY, { salaryMin: 1 }),
    ).rejects.toThrow(ForbiddenException);
    // …and with the stable code the frontend renders a specific message for.
    await expect(
      service.update(ORG, COLLEAGUE, VACANCY, { salaryMin: 1 }),
    ).rejects.toMatchObject({
      response: { code: VACANCY_ERROR_CODES.VACANCY_NOT_OWNED },
    });
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
    // Ownership is settled before the profile is even loaded.
    expect(prisma.vacancy.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('keeps loading a vacancy created before the structured fields existed', async () => {
    // Exactly what Prisma returns for a pre-migration row: legacy text only,
    // array columns empty, the two NOT NULL columns at their "unstated"
    // defaults.
    ownedByOwner({
      salaryMin: null,
      salaryMax: null,
      currency: null,
      workMode: null,
      benefits: [],
      eligibleNationalities: [],
      citizenshipRequirement: 'NONE',
      visaSponsorship: 'UNKNOWN',
    });

    await expect(
      service.update(ORG, OWNER, VACANCY, { department: 'Engineering' }),
    ).resolves.toBeDefined();
  });
});

/**
 * The DTO layer — the per-field half of validation.
 *
 * Run through class-validator exactly as the global ValidationPipe does, so
 * these assert what the HTTP boundary actually rejects. The frontend does the
 * same checks for immediate feedback; that is a convenience, and this is the
 * authority.
 */
describe('CreateVacancyDto', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    const dto = plainToInstance(CreateVacancyDto, {
      title: 'Senior DevOps Engineer',
      ...payload,
    });
    const failures = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return failures.map((failure) => failure.property);
  }

  it('accepts a title-only vacancy', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('rejects office days outside a week', async () => {
    expect(await errorsFor({ officeDaysPerWeek: 8 })).toEqual([
      'officeDaysPerWeek',
    ]);
    expect(await errorsFor({ officeDaysPerWeek: -1 })).toEqual([
      'officeDaysPerWeek',
    ]);
    // 0 is meaningful: an on-site-registered role with no fixed office days.
    expect(await errorsFor({ officeDaysPerWeek: 0 })).toEqual([]);
  });

  it('rejects a free-text currency', async () => {
    expect(await errorsFor({ currency: 'won' })).toEqual(['currency']);
    expect(await errorsFor({ currency: 'KRW' })).toEqual([]);
  });

  it('rejects a country name where a code belongs', async () => {
    expect(await errorsFor({ country: 'South Korea' })).toEqual(['country']);
    expect(await errorsFor({ country: 'KR' })).toEqual([]);
  });

  it('rejects a malformed language row', async () => {
    expect(
      await errorsFor({ languages: [{ languageCode: 'Korean', level: 'B1' }] }),
    ).toEqual(['languages']);
    expect(
      await errorsFor({ languages: [{ languageCode: 'ko', level: 'FLUENT' }] }),
    ).toEqual(['languages']);
    expect(
      await errorsFor({ languages: [{ languageCode: 'ko', level: 'B1' }] }),
    ).toEqual([]);
  });

  it('accepts visa classes from any country, not just Korean ones', async () => {
    expect(
      await errorsFor({ eligibleVisaTypes: ['E-7', 'H-1B', 'Tier 2'] }),
    ).toEqual([]);
  });

  it('rejects an unknown benefit', async () => {
    expect(await errorsFor({ benefits: ['FREE_COFFEE'] })).toEqual([
      'benefits',
    ]);
  });

  it('rejects a negative openings count', async () => {
    expect(await errorsFor({ openingsCount: 0 })).toEqual(['openingsCount']);
  });

  it('refuses smuggled fields outright', async () => {
    // whitelist + forbidNonWhitelisted is what stops a client naming its own
    // organizationId or createdById.
    expect(await errorsFor({ createdById: 'someone-else' })).toEqual([
      'createdById',
    ]);
  });
});

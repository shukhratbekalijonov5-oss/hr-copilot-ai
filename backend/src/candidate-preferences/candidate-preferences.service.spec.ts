import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CandidatePreferencesService } from './candidate-preferences.service';
import { PutJobPreferencesDto } from './dto/job-preferences.dto';
import { emptyJobIntent, hasAnyIntent } from './candidate-job-intent';
import { resolveJobSearchIntent } from './job-search-context';
import type { PrismaService } from '../prisma/prisma.service';

const ACCOUNT = 'account-1';
const PREFERENCES_ID = 'prefs-1';

/**
 * An in-memory stand-in for the two tables, faithful about the two things
 * these tests are actually about: the unique record per account, and the fact
 * that a write REPLACES the location rows rather than adding to them.
 */
function createPrismaMock() {
  const store: {
    record: Record<string, unknown> | null;
    locations: Record<string, unknown>[];
  } = { record: null, locations: [] };

  const mock = {
    store,
    candidateAccount: {
      findUnique: jest.fn().mockResolvedValue({ id: ACCOUNT }),
    },
    candidateJobPreferences: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          store.record
            ? { ...store.record, locations: [...store.locations] }
            : null,
        ),
      ),
      upsert: jest.fn(({ create, update }: never) => {
        const data = (store.record ? update : create) as Record<
          string,
          unknown
        >;
        store.record = {
          id: PREFERENCES_ID,
          candidateAccountId: ACCOUNT,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          ...(store.record ?? {}),
          ...data,
          updatedAt: new Date('2026-08-22T00:00:00.000Z'),
        };
        return Promise.resolve({ id: PREFERENCES_ID });
      }),
      delete: jest.fn(() => {
        store.record = null;
        // The FK cascade, made explicit.
        store.locations = [];
        return Promise.resolve({});
      }),
    },
    candidatePreferredLocation: {
      deleteMany: jest.fn(() => {
        store.locations = [];
        return Promise.resolve({ count: 0 });
      }),
      createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
        store.locations.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation(
    (fn: (tx: unknown) => Promise<unknown>) => fn(mock),
  );
  return mock;
}

/** The complete profile from the task's own example. */
const INITIAL: PutJobPreferencesDto = {
  preferredJobTitles: ['DevOps Engineer', 'Platform Engineer'],
  preferredLocations: [
    { countryCode: 'KR', city: 'Seoul' },
    { countryCode: 'KR', city: 'Busan' },
  ],
  preferredWorkModes: ['REMOTE', 'HYBRID'],
  preferredEmploymentTypes: ['FULL_TIME'],
  preferredSeniorityLevels: ['MID', 'SENIOR'],
  desiredSalaryMin: 50_000_000,
  salaryCurrency: 'KRW',
  payPeriod: 'YEARLY',
  willingToRelocate: true,
  preferredIndustries: ['Technology', 'Fintech'],
};

describe('CandidatePreferencesService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: CandidatePreferencesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new CandidatePreferencesService(
      prisma as unknown as PrismaService,
    );
  });

  describe('Rule N1 — one current version, nothing left behind', () => {
    it('stores what the candidate stated', async () => {
      const saved = await service.replace(ACCOUNT, INITIAL);

      expect(saved.preferredJobTitles).toEqual([
        'DevOps Engineer',
        'Platform Engineer',
      ]);
      expect(saved.preferredLocations).toEqual([
        { countryCode: 'KR', region: null, city: 'Seoul' },
        { countryCode: 'KR', region: null, city: 'Busan' },
      ]);
      expect(saved.desiredSalaryMin).toBe(50_000_000);
      expect(saved.willingToRelocate).toBe(true);
    });

    it('leaves NOTHING of the previous roles after an edit', async () => {
      await service.replace(ACCOUNT, INITIAL);
      await service.replace(ACCOUNT, {
        ...INITIAL,
        preferredJobTitles: ['DevOps Engineer', 'Cloud Engineer'],
      });

      const intent = await service.resolveIntent(ACCOUNT);
      expect(intent.roles).toEqual(['DevOps Engineer', 'Cloud Engineer']);
      expect(intent.roles).not.toContain('Platform Engineer');
    });

    it('leaves NOTHING of the previous locations after an edit', async () => {
      await service.replace(ACCOUNT, INITIAL);
      await service.replace(ACCOUNT, {
        ...INITIAL,
        preferredLocations: [
          { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
        ],
      });

      const intent = await service.resolveIntent(ACCOUNT);
      expect(intent.locations).toEqual([
        { countryCode: 'CA', region: 'Ontario', city: 'Toronto' },
      ]);
      expect(intent.countries).toEqual(['CA']);
      // The row itself is gone, not merely filtered out of the response —
      // a merge would leave Seoul alive and retrievable as current intent.
      expect(prisma.store.locations).toHaveLength(1);
      expect(JSON.stringify(prisma.store.locations)).not.toContain('Seoul');
    });

    it('clears compensation entirely when the salary is removed', async () => {
      await service.replace(ACCOUNT, INITIAL);
      await service.replace(ACCOUNT, {
        ...INITIAL,
        desiredSalaryMin: null,
        salaryCurrency: null,
        payPeriod: null,
      });

      const intent = await service.resolveIntent(ACCOUNT);
      expect(intent.compensation).toBeNull();
      // Not just the amount: a stale KRW/YEARLY would still be readable.
      expect(prisma.store.record).toMatchObject({
        desiredSalaryMin: null,
        salaryCurrency: null,
        payPeriod: null,
      });
    });

    it('drops a whole dimension when the new state omits it', async () => {
      await service.replace(ACCOUNT, INITIAL);
      // PUT semantics: absent means not stated, so the industries are gone.
      await service.replace(ACCOUNT, { preferredJobTitles: ['SRE'] });

      const intent = await service.resolveIntent(ACCOUNT);
      expect(intent.preferredIndustries).toEqual([]);
      expect(intent.workModes).toEqual([]);
      expect(intent.compensation).toBeNull();
      expect(intent.relocation).toBeNull();
      expect(intent.locations).toEqual([]);
    });

    it('returns an empty intent after deletion, with the locations gone', async () => {
      await service.replace(ACCOUNT, INITIAL);
      await service.remove(ACCOUNT);

      expect(await service.resolveIntent(ACCOUNT)).toEqual(
        emptyJobIntent(ACCOUNT),
      );
      expect(prisma.store.locations).toEqual([]);
    });

    it('refuses to delete what does not exist', async () => {
      await expect(service.remove(ACCOUNT)).rejects.toThrow(NotFoundException);
    });

    it('re-creates cleanly, with nothing from the deleted profile', async () => {
      await service.replace(ACCOUNT, INITIAL);
      await service.remove(ACCOUNT);
      await service.replace(ACCOUNT, {
        preferredJobTitles: ['Cloud Engineer'],
        preferredLocations: [{ countryCode: 'CA', city: 'Toronto' }],
      });

      const intent = await service.resolveIntent(ACCOUNT);
      expect(intent.roles).toEqual(['Cloud Engineer']);
      expect(intent.locations).toEqual([
        { countryCode: 'CA', region: null, city: 'Toronto' },
      ]);
      expect(intent.compensation).toBeNull();
    });
  });

  describe('unknown is a value, not a missing one', () => {
    it('reports a candidate who has stated nothing', async () => {
      const intent = await service.resolveIntent(ACCOUNT);

      expect(intent.stated).toBe(false);
      expect(hasAnyIntent(intent)).toBe(false);
      // Empty everywhere — which means "no restriction", never "reject all".
      expect(intent.workModes).toEqual([]);
      expect(intent.compensation).toBeNull();
      expect(intent.relocation).toBeNull();
    });

    it('keeps a stated-but-blank profile distinguishable from no profile', async () => {
      await service.replace(ACCOUNT, {});
      const intent = await service.resolveIntent(ACCOUNT);

      // The candidate HAS been here and cleared everything — a different
      // product situation from never having said anything, even though every
      // field looks the same.
      expect(intent.stated).toBe(true);
      expect(hasAnyIntent(intent)).toBe(false);
    });

    it('never turns a missing salary into zero', async () => {
      await service.replace(ACCOUNT, { preferredJobTitles: ['SRE'] });
      const intent = await service.resolveIntent(ACCOUNT);

      expect(intent.compensation).toBeNull();
      expect(prisma.store.record).toMatchObject({ desiredSalaryMin: null });
    });

    it('never turns an unanswered relocation question into false', async () => {
      await service.replace(ACCOUNT, {
        preferredLocations: [{ countryCode: 'DE', city: 'Berlin' }],
      });
      const intent = await service.resolveIntent(ACCOUNT);

      // …and specifically not inferred from having a foreign location.
      expect(intent.relocation).toBeNull();
    });

    it('keeps an explicit false distinct from unstated', async () => {
      await service.replace(ACCOUNT, { willingToRelocate: false });
      expect((await service.resolveIntent(ACCOUNT)).relocation).toBe(false);
    });
  });

  describe('compensation invariant', () => {
    it('rejects an amount with no currency', async () => {
      await expect(
        service.replace(ACCOUNT, {
          desiredSalaryMin: 50_000_000,
          payPeriod: 'YEARLY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an amount with no pay period', async () => {
      // "50,000,000 KRW" cannot be compared with any job's pay without it.
      await expect(
        service.replace(ACCOUNT, {
          desiredSalaryMin: 50_000_000,
          salaryCurrency: 'KRW',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects units with no amount', async () => {
      await expect(
        service.replace(ACCOUNT, {
          salaryCurrency: 'KRW',
          payPeriod: 'YEARLY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('exposes compensation only as a complete triple', async () => {
      await service.replace(ACCOUNT, INITIAL);
      expect((await service.resolveIntent(ACCOUNT)).compensation).toEqual({
        minAmount: 50_000_000,
        maxAmount: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      });
    });
  });

  describe('normalization', () => {
    it('de-duplicates roles case-insensitively, keeping the first spelling', async () => {
      const saved = await service.replace(ACCOUNT, {
        preferredJobTitles: ['DevOps Engineer', 'devops engineer', '  SRE  '],
      });
      expect(saved.preferredJobTitles).toEqual(['DevOps Engineer', 'SRE']);
    });

    it('de-duplicates locations and upper-cases the country', async () => {
      const saved = await service.replace(ACCOUNT, {
        preferredLocations: [
          { countryCode: 'KR', city: 'Seoul' },
          { countryCode: 'KR', city: '  seoul ' },
          { countryCode: 'KR' },
        ],
      });
      // "KR/Seoul" twice is one place; a bare "KR" is a different, broader one.
      expect(saved.preferredLocations).toEqual([
        { countryCode: 'KR', region: null, city: 'Seoul' },
        { countryCode: 'KR', region: null, city: null },
      ]);
    });

    it('drops blank region and city rather than storing empty strings', async () => {
      const saved = await service.replace(ACCOUNT, {
        preferredLocations: [{ countryCode: 'JP', region: '   ', city: '' }],
      });
      expect(saved.preferredLocations).toEqual([
        { countryCode: 'JP', region: null, city: null },
      ]);
    });

    it('de-duplicates enum lists', async () => {
      const saved = await service.replace(ACCOUNT, {
        preferredWorkModes: ['REMOTE', 'REMOTE', 'HYBRID'],
      });
      expect(saved.preferredWorkModes).toEqual(['REMOTE', 'HYBRID']);
    });

    it('keeps preferred and excluded places apart', async () => {
      const saved = await service.replace(ACCOUNT, {
        preferredLocations: [{ countryCode: 'KR', city: 'Seoul' }],
        excludedLocations: [
          { countryCode: 'US', region: 'California', city: 'Los Angeles' },
        ],
      });

      expect(saved.preferredLocations).toEqual([
        { countryCode: 'KR', region: null, city: 'Seoul' },
      ]);
      expect(saved.excludedLocations).toEqual([
        { countryCode: 'US', region: 'California', city: 'Los Angeles' },
      ]);
      const intent = await service.resolveIntent(ACCOUNT);
      // The excluded country must NOT leak into where they want to work.
      expect(intent.countries).toEqual(['KR']);
      expect(intent.exclusions.locations).toHaveLength(1);
    });
  });

  describe('ownership', () => {
    it('resolves the account from the authenticated user only', async () => {
      await service.requireAccountId('user-1');
      expect(prisma.candidateAccount.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true },
      });
    });

    it('refuses a user with no candidate account', async () => {
      prisma.candidateAccount.findUnique.mockResolvedValueOnce(null);
      await expect(service.requireAccountId('user-x')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

/** The HTTP boundary — what the global ValidationPipe actually rejects. */
describe('PutJobPreferencesDto', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    const dto = plainToInstance(PutJobPreferencesDto, payload);
    const failures = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return failures.map((failure) => failure.property);
  }

  it('accepts an empty body — stating nothing is valid', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('rejects a country name where an ISO code belongs', async () => {
    expect(
      await errorsFor({ preferredLocations: [{ countryCode: 'South Korea' }] }),
    ).toEqual(['preferredLocations']);
    expect(
      await errorsFor({ preferredLocations: [{ countryCode: 'KR' }] }),
    ).toEqual([]);
  });

  it('rejects a location with no country at all', async () => {
    // A bare "Springfield" is not a place anyone can match against.
    expect(
      await errorsFor({ preferredLocations: [{ city: 'Springfield' }] }),
    ).toEqual(['preferredLocations']);
  });

  it('rejects an unsupported currency', async () => {
    expect(await errorsFor({ salaryCurrency: 'won' })).toEqual([
      'salaryCurrency',
    ]);
  });

  it('rejects a negative or zero salary', async () => {
    expect(await errorsFor({ desiredSalaryMin: -1 })).toEqual([
      'desiredSalaryMin',
    ]);
    expect(await errorsFor({ desiredSalaryMin: 0 })).toEqual([
      'desiredSalaryMin',
    ]);
  });

  it('rejects an unknown work mode, seniority or employment type', async () => {
    expect(await errorsFor({ preferredWorkModes: ['ANYWHERE'] })).toEqual([
      'preferredWorkModes',
    ]);
    expect(await errorsFor({ preferredSeniorityLevels: ['GURU'] })).toEqual([
      'preferredSeniorityLevels',
    ]);
    expect(
      await errorsFor({ preferredEmploymentTypes: ['Full-time'] }),
    ).toEqual(['preferredEmploymentTypes']);
  });

  it('rejects an over-long or over-large list', async () => {
    expect(await errorsFor({ preferredJobTitles: ['x'.repeat(121)] })).toEqual([
      'preferredJobTitles',
    ]);
    expect(
      await errorsFor({
        preferredJobTitles: Array.from({ length: 21 }, (_, i) => `Role ${i}`),
      }),
    ).toEqual(['preferredJobTitles']);
  });

  it('refuses a client-supplied account id outright', async () => {
    // The subject is always the authenticated caller; there is no route,
    // body or query anywhere on this surface that names an account.
    expect(await errorsFor({ candidateAccountId: 'someone-else' })).toEqual([
      'candidateAccountId',
    ]);
  });
});

/**
 * Saved preferences and one search request are DIFFERENT things.
 *
 * The rule under test is the one that decides whether a job platform feels
 * broken: a candidate whose saved country is Korea searches "Berlin" and must
 * get Berlin — not an empty page justified by their own saved default.
 */
describe('resolveJobSearchIntent', () => {
  const saved = {
    ...emptyJobIntent(ACCOUNT),
    stated: true,
    roles: ['DevOps Engineer'],
    countries: ['KR'],
    locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
    workModes: ['REMOTE' as const],
    compensation: {
      minAmount: 50_000_000,
      maxAmount: null,
      currency: 'KRW',
      payPeriod: 'YEARLY' as const,
    },
    exclusions: {
      companies: ['Company X'],
      jobTitles: [],
      locations: [],
    },
  };

  it('uses the saved preference when the request says nothing', () => {
    const resolved = resolveJobSearchIntent(saved);
    expect(resolved.countries).toEqual({ value: ['KR'], source: 'PREFERENCE' });
    expect(resolved.workModes.source).toBe('PREFERENCE');
  });

  it('lets an explicit search override the saved default for that search', () => {
    const resolved = resolveJobSearchIntent(saved, {
      query: 'Senior Backend Engineer',
      countries: ['DE'],
    });

    // Berlin is NOT rejected for disagreeing with the saved country.
    expect(resolved.countries).toEqual({ value: ['DE'], source: 'REQUEST' });
    expect(resolved.query).toEqual({
      value: 'Senior Backend Engineer',
      source: 'REQUEST',
    });
  });

  it('overrides only the dimensions the request actually names', () => {
    const resolved = resolveJobSearchIntent(saved, { countries: ['DE'] });

    expect(resolved.countries.source).toBe('REQUEST');
    // Untouched dimensions keep the saved default.
    expect(resolved.workModes).toEqual({
      value: ['REMOTE'],
      source: 'PREFERENCE',
    });
    expect(resolved.compensation.source).toBe('PREFERENCE');
  });

  it('never mutates the saved intent', () => {
    const before = JSON.stringify(saved);
    resolveJobSearchIntent(saved, { countries: ['DE'], workModes: ['ONSITE'] });
    // Running a search is not a preference update.
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('marks a dimension nobody stated as UNSPECIFIED, not empty-as-reject', () => {
    const resolved = resolveJobSearchIntent(emptyJobIntent(ACCOUNT));

    expect(resolved.countries).toEqual({ value: [], source: 'UNSPECIFIED' });
    expect(resolved.workModes.source).toBe('UNSPECIFIED');
    expect(resolved.compensation).toEqual({
      value: null,
      source: 'UNSPECIFIED',
    });
  });

  it('keeps saved exclusions no matter what the request asks', () => {
    // An ad-hoc search must not be able to drop a standing "never show me this".
    const resolved = resolveJobSearchIntent(saved, { countries: ['DE'] });
    expect(resolved.exclusions.companies).toEqual(['Company X']);
  });

  it('treats an empty explicit list as "not asked", not as a restriction', () => {
    const resolved = resolveJobSearchIntent(saved, { countries: [] });
    expect(resolved.countries).toEqual({ value: ['KR'], source: 'PREFERENCE' });
  });
});

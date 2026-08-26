import {
  searchableChanged,
  ExternalIngestionService,
} from './external-ingestion.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NormalizedExternalJobInput } from './external-job.contract';

function input(
  over: Partial<NormalizedExternalJobInput> = {},
): NormalizedExternalJobInput {
  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: 'gh-1',
    sourceUrl: 'https://boards.greenhouse.io/abc/jobs/1',
    originalUrl: null,
    companyName: 'ABC Corp',
    companyWebsiteUrl: 'https://abc.com',
    companyCountryCode: 'KR',
    title: 'Backend Engineer',
    description: 'Build things.',
    requirementsText: null,
    countryCode: 'KR',
    region: null,
    city: 'Seoul',
    workMode: null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: 'FULL_TIME',
    seniorityLevel: 'SENIOR',
    salaryMin: 40_000_000,
    salaryMax: null,
    currency: 'KRW',
    payPeriod: 'YEARLY',
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
    closedAtSource: false,
    ...over,
  };
}

interface MockSource {
  provider: string;
  sourceKey: string;
  urlKeys: string[];
}

function createPrismaMock() {
  const state = {
    jobs: new Map<string, Record<string, unknown>>(),
    sources: [] as Record<string, unknown>[],
  };
  /** Jobs by id, as the foreign key would resolve them. */
  const byId = () =>
    new Map([...state.jobs.values()].map((job) => [job.id as string, job]));

  const prisma = {
    state,
    externalCompany: {
      upsert: jest.fn().mockResolvedValue({ id: 'company-1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-1',
        normalizedName: 'abc',
        domain: 'abc.com',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    externalJob: {
      findUnique: jest.fn(
        ({ where }: { where: { dedupeFingerprint?: string; id?: string } }) => {
          if (where.id) return Promise.resolve(byId().get(where.id) ?? null);
          return Promise.resolve(
            state.jobs.get(where.dedupeFingerprint ?? '') ?? null,
          );
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, never> }) => {
        const created = data.sources as unknown as {
          create: { provider: string; sourceKey: string; urlKeys: string[] };
        };
        const job = {
          id: `job-${state.jobs.size + 1}`,
          status: (data.status as string) ?? 'ACTIVE',
          externalCompanyId: 'company-1',
          canonicalUrl: data.canonicalUrl,
          countryCode: data.countryCode,
          city: data.city,
          company: { domain: 'abc.com' },
          // The real schema creates the source row with the job, so the mock
          // does too — otherwise a re-observation would look like a brand new
          // source and the idempotency assertion would pass for the wrong
          // reason.
          sources: [
            {
              provider: created.create.provider,
              sourceKey: created.create.sourceKey,
              urlKeys: created.create.urlKeys ?? [],
            },
          ],
          dedupeFingerprint: data.dedupeFingerprint,
        };
        state.jobs.set(data.dedupeFingerprint, job);
        return Promise.resolve({ id: job.id });
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id?: string };
          data: Record<string, unknown>;
        }) => {
          // Keep the fake's status in step, the way the row would be.
          const job = where.id ? byId().get(where.id) : undefined;
          if (job && typeof data.status === 'string') job.status = data.status;
          return Promise.resolve({});
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        for (const [key, job] of state.jobs) {
          if (job.id === where.id) state.jobs.delete(key);
        }
        return Promise.resolve({});
      }),
    },
    externalJobSource: {
      /**
       * The URL-identity lookup, modelled the way the GIN index behaves:
       * every source row whose `urlKeys` intersect the incoming set, one row
       * per distinct job.
       */
      findMany: jest.fn((args: Record<string, never>) => {
        const where = args.where as unknown as {
          urlKeys?: { hasSome: string[] };
        };
        const wanted = new Set(where?.urlKeys?.hasSome ?? []);
        if (wanted.size === 0) return Promise.resolve([]);
        const matched: { externalJobId: string }[] = [];
        for (const job of state.jobs.values()) {
          const sources = job.sources as MockSource[];
          if (
            sources.some((source) =>
              (source.urlKeys ?? []).some((key) => wanted.has(key)),
            )
          ) {
            matched.push({ externalJobId: job.id as string });
          }
        }
        return Promise.resolve(matched);
      }),
      upsert: jest.fn((args: Record<string, never>) => {
        state.sources.push(args);
        // Attach it to its job, as the foreign key would.
        const where = args.where as unknown as {
          provider_sourceKey: { provider: string; sourceKey: string };
        };
        const create = args.create as unknown as {
          externalJobId: string;
          urlKeys?: string[];
        };
        for (const job of state.jobs.values()) {
          const sources = job.sources as MockSource[];
          const known = sources.some(
            (source) =>
              source.provider === where.provider_sourceKey.provider &&
              source.sourceKey === where.provider_sourceKey.sourceKey,
          );
          if (!known && job.id === create?.externalJobId) {
            sources.push({
              ...where.provider_sourceKey,
              urlKeys: create.urlKeys ?? [],
            });
          }
        }
        return Promise.resolve({ id: 'source-1' });
      }),
    },
  };
  return prisma;
}

function build() {
  const prisma = createPrismaMock();
  const service = new ExternalIngestionService(
    prisma as unknown as PrismaService,
  );
  // reconcileJob re-reads the job; the mock has no full row, so it is stubbed
  // out here and exercised by its own tests instead.
  jest.spyOn(service, 'reconcileJob').mockResolvedValue(undefined);
  return { service, prisma };
}

describe('ingesting the same posting twice', () => {
  it('creates once and updates thereafter', () => {
    // Idempotency is the whole point: a provider sweep runs forever and
    // re-observes most of the same postings every time.
    return (async () => {
      const { service } = build();

      const first = await service.ingestBatch([input()]);
      expect(first).toMatchObject({ created: 1, updated: 0 });

      const second = await service.ingestBatch([input()]);
      expect(second).toMatchObject({ created: 0, updated: 1 });
    })();
  });

  it('keys the source row on (provider, sourceKey) so the DB enforces it', async () => {
    const { service, prisma } = build();

    await service.ingestBatch([input()]);
    await service.ingestBatch([input()]);

    const upsert = prisma.externalJobSource.upsert.mock
      .calls[0][0] as unknown as { where: { provider_sourceKey: unknown } };
    expect(upsert.where.provider_sourceKey).toEqual({
      provider: 'GREENHOUSE',
      sourceKey: 'gh-1',
    });
  });
});

describe('one canonical job, many sources', () => {
  it('a second provider describing the same job MERGES onto it', async () => {
    const { service } = build();

    await service.ingestBatch([input()]);
    const result = await service.ingestBatch([
      input({
        provider: 'LEVER',
        sourceJobId: 'lever-9',
        sourceUrl: 'https://jobs.lever.co/abc/lever-9',
      }),
    ]);

    // Merged, not created: the candidate sees one job with two provenance
    // links rather than the same job twice.
    expect(result).toMatchObject({ merged: 1, created: 0 });
  });

  it('an ambiguous duplicate is kept SEPARATE rather than falsely merged', async () => {
    const { service } = build();

    // No domain, no city — company name and title agree and nothing else does.
    await service.ingestBatch([
      input({ companyWebsiteUrl: null, city: null, countryCode: null }),
    ]);
    const result = await service.ingestBatch([
      input({
        provider: 'SARAMIN',
        sourceJobId: 'sa-1',
        sourceUrl: 'https://saramin.example/jobs/1',
        companyWebsiteUrl: null,
        city: null,
        countryCode: null,
      }),
    ]);

    // A duplicate is cosmetic and self-correcting; a false merge deletes a
    // real job with no trace.
    expect(result).toMatchObject({ unmerged: 1, merged: 0 });
  });

  /*
   * The two tests below give each posting its OWN url, which is not decoration.
   * A provider's job URL contains its job id, so two requisitions cannot share
   * one — and a fixture where they do describes a payload no provider can
   * produce. It also now merges, correctly: two sightings publishing the same
   * application URL are one job, whatever their company names say.
   */
  it('a different company with the same title is never merged', async () => {
    const { service } = build();

    await service.ingestBatch([input()]);
    const result = await service.ingestBatch([
      input({
        companyName: 'XYZ Corp',
        companyWebsiteUrl: 'https://xyz.com',
        sourceJobId: 'gh-2',
        sourceUrl: 'https://boards.greenhouse.io/xyz/jobs/2',
      }),
    ]);

    expect(result).toMatchObject({ created: 1, merged: 0 });
  });

  it('the same company and title in a different city stays separate', async () => {
    const { service } = build();

    await service.ingestBatch([input({ city: 'Seoul' })]);
    const result = await service.ingestBatch([
      input({
        city: 'Busan',
        sourceJobId: 'gh-3',
        sourceUrl: 'https://boards.greenhouse.io/abc/jobs/3',
      }),
    ]);

    expect(result).toMatchObject({ created: 1 });
  });

  it('merges two sightings that publish the same application URL', async () => {
    const { service } = build();

    // The company careers case: a page on the employer's own domain whose
    // apply link is the ATS posting already ingested. Nothing else agrees —
    // the company name is written differently and the page states no city —
    // and the URL alone carries the merge.
    await service.ingestBatch([input()]);
    const result = await service.ingestBatch([
      input({
        provider: 'COMPANY_CAREERS',
        accessMethod: 'PUBLIC_ENDPOINT',
        sourceJobId: 'abc-careers:abc.com/careers/backend-engineer',
        sourceUrl: 'https://abc.com/careers/backend-engineer',
        originalUrl: 'https://boards.greenhouse.io/abc/jobs/1',
        companyName: 'ABC',
        city: null,
        countryCode: null,
        employmentType: null,
      }),
    ]);

    expect(result).toMatchObject({ merged: 1, created: 0, unmerged: 0 });
  });
});

describe('one bad posting never costs the run', () => {
  it('counts a failure and keeps ingesting the rest', async () => {
    const { service, prisma } = build();
    prisma.externalCompany.upsert
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValue({ id: 'company-1' });

    const result = await service.ingestBatch([
      input({ sourceJobId: 'bad' }),
      input({ sourceJobId: 'good-1' }),
      input({ sourceJobId: 'good-2', city: 'Busan' }),
    ]);

    expect(result.failed).toBe(1);
    expect(result.created + result.updated + result.merged).toBe(2);
  });

  it('logs the identifier but never the payload', async () => {
    // Provider responses carry contact details and free text; log files are
    // not where those belong.
    const { service, prisma } = build();
    prisma.externalCompany.upsert.mockRejectedValueOnce(new Error('boom'));
    const warn = jest
      .spyOn(
        (service as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await service.ingestBatch([input({ description: 'SECRET CONTACT INFO' })]);

    const message = warn.mock.calls[0][0];
    expect(message).toContain('GREENHOUSE');
    expect(message).toContain('gh-1');
    expect(message).not.toContain('SECRET CONTACT INFO');
  });
});

describe('what is stored', () => {
  it('preserves the source currency exactly as posted', async () => {
    const { service, prisma } = build();

    await service.ingestBatch([input()]);

    const created = prisma.externalJob.create.mock.calls[0][0] as unknown as {
      data: Record<string, unknown>;
    };
    // No conversion on the way in. The employer's number is a fact; the USD
    // figure a candidate reads is derived later, at comparison time.
    expect(created.data.salaryMin).toBe(40_000_000);
    expect(created.data.currency).toBe('KRW');
    expect(created.data.payPeriod).toBe('YEARLY');
  });

  it('keeps unknown fields unknown', async () => {
    const { service, prisma } = build();

    await service.ingestBatch([
      input({
        salaryMin: null,
        currency: null,
        payPeriod: null,
        workMode: null,
        seniorityLevel: null,
      }),
    ]);

    const { data } = prisma.externalJob.create.mock.calls[0][0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(data.salaryMin).toBeNull();
    expect(data.currency).toBeNull();
    expect(data.workMode).toBeNull();
    expect(data.seniorityLevel).toBeNull();
    // Work authorization is never inferred from a country or a company.
    expect(data.visaSponsorship).toBe('UNKNOWN');
    expect(data.existingWorkAuthorizationRequired).toBeNull();
  });

  it('records provenance on every source row', async () => {
    const { service, prisma } = build();

    await service.ingestBatch([input()]);

    const { data } = prisma.externalJob.create.mock.calls[0][0] as unknown as {
      data: { sources: { create: Record<string, unknown> } };
    };
    const source = data.sources.create;
    expect(source.provider).toBe('GREENHOUSE');
    expect(source.accessMethod).toBe('OFFICIAL_API');
    expect(source.sourceKey).toBe('gh-1');
    expect(source.sourceUrl).toContain('greenhouse.io');
    expect(source.payloadFingerprint).toEqual(expect.any(String));
  });

  it('a posting the source explicitly says is closed is hard-deleted, not archived', async () => {
    const { service, prisma } = build();

    const outcome = await service.ingestBatch([
      input({ closedAtSource: true }),
    ]);

    const { data } = prisma.externalJob.create.mock.calls[0][0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(data.status).toBe('CLOSED');
    expect(data.closedAt).toBeInstanceOf(Date);
    // Positive, authoritative closure → live-only lifecycle deletes the row
    // immediately (no CLOSED archive) and reports the id for Qdrant.
    expect(prisma.externalJob.delete).toHaveBeenCalledTimes(1);
    expect(outcome.deletedJobIds).toHaveLength(1);
  });
});

/**
 * The absence sweep — the only path that can retire a job nobody declared
 * closed. Every test here is about refusing to do it on weak evidence.
 */
describe('markAbsent', () => {
  function absenceMock(
    sources: { id: string; sourceKey: string; externalJobId: string }[],
    statusAfter: 'ACTIVE' | 'CLOSED' | 'UNAVAILABLE' = 'UNAVAILABLE',
  ) {
    const updated: Record<string, unknown>[] = [];
    let served = false;
    const prisma = {
      externalJobSource: {
        // The argument is typed so the WHERE clause can be asserted below.
        findMany: jest.fn((args: { where: Record<string, unknown> }) => {
          void args;
          // One page, then empty — the paging loop's terminating condition.
          if (served) return Promise.resolve([]);
          served = true;
          return Promise.resolve(sources);
        }),
        updateMany: jest.fn((args: Record<string, unknown>) => {
          updated.push(args);
          return Promise.resolve({ count: 1 });
        }),
      },
      externalJob: {
        findUnique: jest.fn(() => Promise.resolve({ status: statusAfter })),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new ExternalIngestionService(
      prisma as unknown as PrismaService,
    );
    jest.spyOn(service, 'reconcileJob').mockResolvedValue(undefined);
    return { service, prisma, updated };
  }

  const SOURCES = [
    { id: 's1', sourceKey: 'acme:1', externalJobId: 'job-1' },
    { id: 's2', sourceKey: 'acme:2', externalJobId: 'job-2' },
  ];

  it('retires a source missing from a complete, successful listing', async () => {
    const { service, updated } = absenceMock(SOURCES);

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(['acme:1']),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    expect(result.sourcesRetired).toBe(1);
    const data = (updated[0] as { data: { status: string } }).data;
    // GONE, not CLOSED: the source stopped listing it, which is not the same
    // claim as the employer ending the role.
    expect(data.status).toBe('GONE');
  });

  it('HARD-DELETES a job whose every claim departed — no UNAVAILABLE archive row', async () => {
    const { service, prisma } = absenceMock(SOURCES, 'UNAVAILABLE');

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(['acme:1']),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    // job-2's only source vanished from a complete successful listing → the
    // canonical row is deleted (FK CASCADE takes sources/saved/trackers),
    // and the id is handed back so Qdrant follows PostgreSQL.
    expect(prisma.externalJob.delete).toHaveBeenCalledWith({
      where: { id: 'job-2' },
    });
    expect(result.jobsClosed).toBe(1);
    expect(result.deletedJobIds).toEqual(['job-2']);
  });

  it('a job that stays ACTIVE through another live source is NOT deleted', async () => {
    const { service, prisma } = absenceMock(SOURCES, 'ACTIVE');

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(['acme:1']),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    expect(prisma.externalJob.delete).not.toHaveBeenCalled();
    expect(result.deletedJobIds).toEqual([]);
  });

  it('retires nothing when the run failed', async () => {
    const { service, prisma } = absenceMock(SOURCES);

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(),
      runSucceeded: false,
      absenceImpliesClosed: true,
    });

    expect(result).toEqual({
      sourcesRetired: 0,
      jobsClosed: 0,
      deletedJobIds: [],
    });
    // It does not even look: a failed run is not evidence of anything —
    // and under the live-only lifecycle that also means it DELETES nothing.
    expect(prisma.externalJobSource.findMany).not.toHaveBeenCalled();
    expect(prisma.externalJob.delete).not.toHaveBeenCalled();
  });

  it('retires nothing for a provider whose listings are not complete', async () => {
    const { service, prisma } = absenceMock(SOURCES);

    await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: false,
    });

    expect(prisma.externalJobSource.updateMany).not.toHaveBeenCalled();
  });

  it('touches nothing when every known posting was observed', async () => {
    const { service, prisma } = absenceMock(SOURCES);

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(['acme:1', 'acme:2']),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    expect(result.sourcesRetired).toBe(0);
    expect(prisma.externalJobSource.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the diff to one listing', async () => {
    const { service, prisma } = absenceMock(SOURCES);

    await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    // Sweeping one board must never consider another board's postings.
    const where = prisma.externalJobSource.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      provider: 'GREENHOUSE',
      sourceScope: 'acme',
      status: 'ACTIVE',
    });
  });

  it('never deletes a row', async () => {
    const { service, prisma } = absenceMock(SOURCES);

    await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    // History is what lets a later sweep notice the posting came back.
    expect(
      (prisma.externalJobSource as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
    expect(
      (prisma.externalJobSource as unknown as Record<string, unknown>)
        .deleteMany,
    ).toBeUndefined();
  });

  it('counts only jobs that actually left the current universe', async () => {
    // A job whose other source is still live stays ACTIVE and is not counted.
    const { service } = absenceMock(SOURCES, 'ACTIVE');

    const result = await service.markAbsent({
      provider: 'GREENHOUSE',
      scopeKey: 'acme',
      observedSourceKeys: new Set(),
      runSucceeded: true,
      absenceImpliesClosed: true,
    });

    expect(result.sourcesRetired).toBe(2);
    expect(result.jobsClosed).toBe(0);
  });
});

/**
 * What counts as a change a SEARCHER could notice.
 *
 * This predicate decides whether the search's universe revision moves, which
 * decides whether every candidate's stored search is thrown away. Both
 * directions are load-bearing: missing a real change serves a stale order,
 * and reacting to a crawler touch invalidates the whole cache several times a
 * day for nothing.
 */
describe('searchableChanged', () => {
  const job = {
    title: 'Backend Engineer',
    status: 'ACTIVE',
    employerPostedAt: new Date('2026-08-01T00:00:00Z'),
  };

  it('notices a newly learned publication date', () => {
    // Newest-first ordering reads this column, so a date that appeared where
    // there was none changes what the search returns.
    expect(
      searchableChanged(
        { ...job, employerPostedAt: null },
        { ...job, employerPostedAt: new Date('2026-08-01T00:00:00Z') },
      ),
    ).toBe(true);
  });

  it('notices a publication date that moved', () => {
    expect(
      searchableChanged(job, {
        ...job,
        employerPostedAt: new Date('2026-08-20T00:00:00Z'),
      }),
    ).toBe(true);
  });

  it('ignores a re-observation that changed nothing', () => {
    // The invariant that keeps the cache useful: a sweep re-reads every
    // posting every few hours and must not invalidate a single search.
    expect(searchableChanged(job, { ...job })).toBe(false);
  });

  it('ignores crawler timestamps entirely', () => {
    // They are not in the searchable set, so they cannot be passed here —
    // and if a future edit adds one, this fails.
    expect(
      searchableChanged(job, {
        ...job,
        lastSeenAt: new Date(),
        lastVerifiedAt: new Date(),
        firstSeenAt: new Date(),
      } as never),
    ).toBe(false);
  });
});

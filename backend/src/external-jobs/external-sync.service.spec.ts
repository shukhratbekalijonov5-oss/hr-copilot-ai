import { ExternalSyncService, resolveRunStatus } from './external-sync.service';
import { ExternalProviderRegistry } from './provider-registry';
import { ExternalJobProvider } from './external-job.provider';
import type { PrismaService } from '../prisma/prisma.service';
import type { ExternalIngestionService } from './external-ingestion.service';
import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from './external-job.contract';

/**
 * Run orchestration: counters, run status, and — the part that matters — when
 * a sweep is allowed to retire a job it did not see.
 */

const DESCRIPTOR: ExternalProviderDescriptor = {
  provider: 'GREENHOUSE',
  accessMethod: 'OFFICIAL_API',
  allowedHosts: ['boards-api.greenhouse.io'],
  maxConcurrency: 1,
  minRequestIntervalMs: 0,
  stalenessMs: 1_000,
  absenceImpliesClosed: true,
};

function jobInput(id: string): NormalizedExternalJobInput {
  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: id,
    sourceUrl: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    originalUrl: null,
    companyName: 'Acme',
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title: `Role ${id}`,
    description: null,
    requirementsText: null,
    countryCode: 'GB',
    region: null,
    city: 'London',
    workMode: null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: null,
    seniorityLevel: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
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
  };
}

class FakeProvider extends ExternalJobProvider {
  readonly descriptor = DESCRIPTOR;
  get configured(): boolean {
    return true;
  }
  constructor(
    private readonly pages: (ProviderFetchPage | Error)[],
    readonly seen: (string | null)[] = [],
  ) {
    super();
  }
  fetchPage(cursor: string | null): Promise<ProviderFetchPage> {
    this.seen.push(cursor);
    const next = this.pages.shift();
    if (!next) throw new Error('fetchPage called more times than expected');
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
}

function page(over: Partial<ProviderFetchPage> = {}): ProviderFetchPage {
  return {
    jobs: [],
    nextCursor: null,
    rejected: [],
    scopeKey: 'acme',
    complete: true,
    ...over,
  };
}

function build(pages: (ProviderFetchPage | Error)[]) {
  const runs: Record<string, unknown>[] = [];
  const prisma = {
    externalIngestionRun: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        runs.push({ id: 'run-1', ...data });
        return Promise.resolve({ id: 'run-1' });
      }),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(runs[0], data);
        return Promise.resolve({});
      }),
    },
  } as unknown as PrismaService;

  const ingestion = {
    ingestBatch: jest.fn((jobs: NormalizedExternalJobInput[]) =>
      Promise.resolve({
        created: jobs.length,
        updated: 0,
        merged: 0,
        failed: 0,
        unmerged: 0,
      }),
    ),
    markAbsent: jest
      .fn()
      .mockResolvedValue({ sourcesRetired: 0, jobsClosed: 0 }),
  } as unknown as jest.Mocked<ExternalIngestionService>;

  const provider = new FakeProvider(pages);
  const registry = new ExternalProviderRegistry([provider]);
  const service = new ExternalSyncService(prisma, registry, ingestion);
  return { service, ingestion, runs, provider, registry };
}

describe('ExternalSyncService', () => {
  describe('a successful sweep', () => {
    it('records counters on the run row', async () => {
      const { service, runs } = build([
        page({ jobs: [jobInput('1'), jobInput('2')] }),
      ]);
      const outcome = await service.syncProvider('GREENHOUSE');
      expect(outcome).toMatchObject({
        status: 'SUCCEEDED',
        created: 2,
        fetched: 2,
      });
      expect(runs[0]).toMatchObject({
        status: 'SUCCEEDED',
        jobsFetched: 2,
        jobsCreated: 2,
        jobsFailed: 0,
      });
    });

    it('records which listings the run covered', async () => {
      const { service, runs } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'globex' }),
        page({ jobs: [jobInput('2')], scopeKey: 'globex' }),
      ]);
      await service.syncProvider('GREENHOUSE');
      expect(runs[0].sourceScope).toBe('acme,globex');
    });

    it('walks every board the provider offers', async () => {
      const { service, provider } = build([
        page({ nextCursor: 'globex' }),
        page({ scopeKey: 'globex', nextCursor: 'initech' }),
        page({ scopeKey: 'initech' }),
      ]);
      await service.syncProvider('GREENHOUSE');
      expect(provider.seen).toEqual([null, 'globex', 'initech']);
    });

    it('passes each page its own scope to the ingestion layer', async () => {
      const { service, ingestion } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'globex' }),
        page({ jobs: [jobInput('2')], scopeKey: 'globex' }),
      ]);
      await service.syncProvider('GREENHOUSE');
      expect(ingestion.ingestBatch).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'acme',
        expect.anything(),
      );
      expect(ingestion.ingestBatch).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'globex',
        expect.anything(),
      );
    });
  });

  describe('idempotency accounting', () => {
    it('reports updates rather than creations on a second sweep', async () => {
      const { service, ingestion, runs } = build([
        page({ jobs: [jobInput('1'), jobInput('2')] }),
      ]);
      (ingestion.ingestBatch as jest.Mock).mockResolvedValue({
        created: 0,
        updated: 2,
        merged: 0,
        failed: 0,
        unmerged: 0,
      });
      await service.syncProvider('GREENHOUSE');
      expect(runs[0]).toMatchObject({ jobsCreated: 0, jobsUpdated: 2 });
    });
  });

  describe('malformed postings', () => {
    it('counts a provider-level rejection without failing the run', async () => {
      const { service, runs } = build([
        page({
          jobs: Array.from({ length: 100 }, (_, i) => jobInput(String(i))),
          rejected: [{ sourceJobId: '999', reason: 'no url' }],
        }),
      ]);
      const outcome = await service.syncProvider('GREENHOUSE');
      expect(outcome).toMatchObject({ created: 100, failed: 1, fetched: 101 });
      // Some postings failed, so the run is PARTIAL — which is exactly the
      // state that must not be read as "I saw the whole board".
      expect(runs[0].status).toBe('PARTIAL');
    });
  });

  describe('provider outage', () => {
    it('records a FAILED run and closes nothing when the first page dies', async () => {
      const { service, ingestion, runs } = build([new Error('socket hang up')]);
      const outcome = await service.syncProvider('GREENHOUSE');
      expect(outcome!.status).toBe('FAILED');
      expect(runs[0].error).toBe('socket hang up');
      // The rule the whole lifecycle rests on: an outage costs freshness,
      // never inventory.
      expect(ingestion.markAbsent).not.toHaveBeenCalled();
      expect(outcome!.closed).toBe(0);
    });

    it('records PARTIAL when a later board dies after an earlier one worked', async () => {
      const { service, runs } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'globex' }),
        new Error('503'),
      ]);
      const outcome = await service.syncProvider('GREENHOUSE');
      expect(outcome!.status).toBe('PARTIAL');
      expect(runs[0].jobsCreated).toBe(1);
    });

    it('never retires anything when the run did not succeed', async () => {
      const { service, ingestion } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'globex' }),
        new Error('timeout'),
      ]);
      await service.syncProvider('GREENHOUSE');
      // The first board WAS completely enumerated, but the run as a whole was
      // not successful — markAbsent is still told so, and refuses.
      const call = (ingestion.markAbsent as jest.Mock).mock.calls[0]?.[0];
      if (call) expect(call.runSucceeded).toBe(false);
    });
  });

  describe('completeness gating', () => {
    it('retires absent postings when the listing was complete', async () => {
      const { service, ingestion } = build([page({ jobs: [jobInput('1')] })]);
      await service.syncProvider('GREENHOUSE');
      expect(ingestion.markAbsent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'GREENHOUSE',
          scopeKey: 'acme',
          runSucceeded: true,
          absenceImpliesClosed: true,
        }),
      );
    });

    it('hands over exactly the source keys it observed', async () => {
      const { service, ingestion } = build([
        page({ jobs: [jobInput('11'), jobInput('22')] }),
      ]);
      await service.syncProvider('GREENHOUSE');
      const call = (ingestion.markAbsent as jest.Mock).mock.calls[0][0];
      expect([...call.observedSourceKeys].sort()).toEqual(['11', '22']);
    });

    it('skips the absence sweep for a partial listing', async () => {
      // A truncated board diffed against reality retires every job that was
      // merely on the page we did not get.
      const { service, ingestion } = build([
        page({ jobs: [jobInput('1')], complete: false }),
      ]);
      await service.syncProvider('GREENHOUSE');
      expect(ingestion.markAbsent).not.toHaveBeenCalled();
    });

    it('disqualifies a whole board when ANY of its pages was partial', async () => {
      const { service, ingestion } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'acme' }),
        page({ jobs: [jobInput('2')], complete: false }),
      ]);
      await service.syncProvider('GREENHOUSE');
      expect(ingestion.markAbsent).not.toHaveBeenCalled();
    });

    it('sweeps the complete board and spares the partial one', async () => {
      const { service, ingestion } = build([
        page({ jobs: [jobInput('1')], nextCursor: 'globex' }),
        page({ jobs: [jobInput('2')], scopeKey: 'globex', complete: false }),
      ]);
      await service.syncProvider('GREENHOUSE');
      const scopes = (ingestion.markAbsent as jest.Mock).mock.calls.map(
        (call) => call[0].scopeKey,
      );
      expect(scopes).toEqual(['acme']);
    });

    it('counts jobs that left the current universe', async () => {
      const { service, ingestion, runs } = build([
        page({ jobs: [jobInput('1')] }),
      ]);
      (ingestion.markAbsent as jest.Mock).mockResolvedValue({
        sourcesRetired: 3,
        jobsClosed: 2,
      });
      const outcome = await service.syncProvider('GREENHOUSE');
      expect(outcome!.closed).toBe(2);
      expect(runs[0].jobsClosed).toBe(2);
    });

    it('does not fail the run when the absence sweep itself errors', async () => {
      const { service, ingestion } = build([page({ jobs: [jobInput('1')] })]);
      (ingestion.markAbsent as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );
      const outcome = await service.syncProvider('GREENHOUSE');
      // The jobs were stored. Anything stale is caught next sweep.
      expect(outcome!.status).toBe('SUCCEEDED');
    });
  });

  describe('unregistered providers', () => {
    it('does nothing and opens no run', async () => {
      const { service, runs } = build([]);
      await expect(service.syncProvider('LEVER')).resolves.toBeNull();
      expect(runs).toHaveLength(0);
    });
  });

  describe('runaway protection', () => {
    it('stops walking rather than following a cursor forever', async () => {
      const pages = Array.from({ length: 600 }, () =>
        page({ nextCursor: 'acme' }),
      );
      const { service, provider } = build(pages);
      await service.syncProvider('GREENHOUSE');
      expect(provider.seen.length).toBeLessThanOrEqual(500);
    });
  });
});

describe('resolveRunStatus', () => {
  it('is FAILED when the fetch died with nothing stored', () => {
    expect(
      resolveRunStatus({ fetchFailed: true, ingested: 0, failed: 0 }),
    ).toBe('FAILED');
  });

  it('is PARTIAL when the fetch died after storing something', () => {
    expect(
      resolveRunStatus({ fetchFailed: true, ingested: 5, failed: 0 }),
    ).toBe('PARTIAL');
  });

  it('is PARTIAL when some postings failed', () => {
    expect(
      resolveRunStatus({ fetchFailed: false, ingested: 5, failed: 1 }),
    ).toBe('PARTIAL');
  });

  it('is SUCCEEDED only when everything worked', () => {
    expect(
      resolveRunStatus({ fetchFailed: false, ingested: 5, failed: 0 }),
    ).toBe('SUCCEEDED');
  });

  it('is SUCCEEDED for an empty board rather than a failure', () => {
    expect(
      resolveRunStatus({ fetchFailed: false, ingested: 0, failed: 0 }),
    ).toBe('SUCCEEDED');
  });
});

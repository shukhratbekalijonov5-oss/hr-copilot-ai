import { ExternalSearchService } from './external-search.service';
import type {
  ExternalSearchRetrieval,
  ExternalSearchRow,
  ExternalSearchScope,
} from './external-search.retrieval';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import type { FxRateService } from '../../fx/fx-rate.service';
import type { AiServiceClient } from '../../ai/ai-service.client';
import { emptyJobIntent } from '../../candidate-preferences/candidate-job-intent';
import type { CandidateJobIntent } from '../../candidate-preferences/candidate-job-intent';

/**
 * The orchestration: which inputs are allowed to REMOVE jobs, which may only
 * reorder them, and what happens when the semantic half is unavailable.
 *
 * The retrieval layer is faked here on purpose. Its SQL is proven against the
 * real database (indexes, `additionalLocations` containment, the location
 * predicate); what is proven HERE is that the service asks it the right
 * question — which is where the hard/soft boundary actually lives.
 */

const ACCOUNT = 'acct-1';

function jobRow(over: Partial<ExternalSearchRow> = {}): ExternalSearchRow {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    status: 'ACTIVE',
    countryCode: 'KR',
    region: null,
    city: 'Seoul',
    additionalLocations: [],
    workMode: 'HYBRID',
    remoteCountriesAllowed: [],
    employmentType: 'FULL_TIME',
    seniorityLevel: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    benefits: [],
    industries: [],
    canonicalUrl: 'https://boards.example.org/1',
    employerPostedAt: null,
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: null,
    companyName: 'Acme',
    companyWebsiteUrl: null,
    ...over,
  };
}

function build(options: {
  intent?: CandidateJobIntent;
  rows?: ExternalSearchRow[];
  lexical?: { externalJobId: string; score: number }[];
  semanticThrows?: boolean;
  semanticHits?: { externalJobId: string; similarity: number }[];
  aiEnabled?: boolean;
}) {
  const rows = options.rows ?? [jobRow()];
  const scopes: ExternalSearchScope[] = [];

  const retrieval = {
    universeRevision: jest
      .fn()
      .mockResolvedValue('1775:2026-08-24T00:00:00.000Z'),
    countHardUniverse: jest.fn().mockResolvedValue(rows.length),
    lexicalCandidates: jest.fn((scope: ExternalSearchScope) => {
      scopes.push(scope);
      return Promise.resolve(
        options.lexical ??
          rows.map((row) => ({ externalJobId: row.id, score: 0.8 })),
      );
    }),
    revalidate: jest.fn().mockResolvedValue(rows),
    filterSemantic: (hits: { externalJobId: string; similarity: number }[]) =>
      hits,
    /*
     * The real one orders in SQL. Here it just records that the newest path
     * was taken and returns the same rows — what these tests are about is
     * which path the service chooses and how it orders the result, not the
     * index plan, which is proven against the real database in e2e.
     */
    newestCandidates: jest.fn((scope: ExternalSearchScope) => {
      scopes.push(scope);
      return Promise.resolve(rows.map((row) => row.id));
    }),
  } as unknown as ExternalSearchRetrieval;

  const runs = new Map<string, Record<string, unknown>>();
  const entries: Record<string, unknown>[] = [];
  let runSeq = 0;

  const prisma = {
    candidateExternalSearchRun: {
      findUnique: jest.fn(({ where }: { where: Record<string, never> }) => {
        const key = where.candidateAccountId_requestFingerprint as unknown as
          | { candidateAccountId: string; requestFingerprint: string }
          | undefined;
        if (key) {
          return Promise.resolve(
            runs.get(`${key.candidateAccountId}|${key.requestFingerprint}`) ??
              null,
          );
        }
        const byId = [...runs.values()].find((run) => run.id === where.id);
        return Promise.resolve(byId ?? null);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(({ data }: { data: Record<string, never> }) => {
        runSeq += 1;
        const run = {
          ...data,
          id: `run-${runSeq}`,
          expiresAt: new Date(Date.now() + 60_000),
        } as unknown as Record<string, unknown>;
        runs.set(
          `${String(data.candidateAccountId)}|${String(data.requestFingerprint)}`,
          run,
        );
        return Promise.resolve({ id: run.id });
      }),
    },
    candidateExternalSearchEntry: {
      createMany: jest.fn(({ data }: { data: Record<string, unknown>[] }) => {
        entries.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = 20,
        }: {
          where: { runId: string };
          skip?: number;
          take?: number;
        }) =>
          Promise.resolve(
            entries
              .filter((entry) => entry.runId === where.runId)
              .sort((a, b) => (a.rank as number) - (b.rank as number))
              .slice(skip, skip + take),
          ),
      ),
    },
    externalJob: {
      findMany: jest.fn(({ where }: { where: Record<string, never> }) => {
        const wanted = new Set(
          (where.id as unknown as { in: string[] })?.in ?? [],
        );
        return Promise.resolve(
          rows
            .filter((row) => wanted.has(row.id))
            .map((row) => ({
              ...row,
              company: {
                name: row.companyName,
                websiteUrl: row.companyWebsiteUrl,
              },
              sources: [
                {
                  provider: 'GREENHOUSE',
                  originalUrl: row.canonicalUrl,
                  sourceUrl: row.canonicalUrl,
                },
              ],
            })),
        );
      }),
    },
    $transaction: jest.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(prisma)),
  } as unknown as PrismaService;

  const preferences = {
    requireAccountId: jest.fn().mockResolvedValue(ACCOUNT),
    resolveIntent: jest
      .fn()
      .mockResolvedValue(options.intent ?? emptyJobIntent(ACCOUNT)),
  } as unknown as CandidatePreferencesService;

  const fx = {
    current: jest.fn().mockResolvedValue({ table: null, snapshot: null }),
  } as unknown as FxRateService;

  const ai = {
    enabled: options.aiEnabled ?? true,
    searchExternalJobs: jest.fn(() =>
      options.semanticThrows
        ? Promise.reject(new Error('qdrant down'))
        : Promise.resolve(options.semanticHits ?? []),
    ),
  } as unknown as AiServiceClient;

  const flags = {
    flagsFor: jest
      .fn()
      .mockResolvedValue({ saved: new Set<string>(), tracking: new Map() }),
  } as unknown as import('../candidate/candidate-external-flags.service').CandidateExternalFlagsService;

  const service = new ExternalSearchService(
    prisma,
    retrieval,
    preferences,
    fx,
    ai,
    flags,
  );
  return {
    service,
    retrieval,
    prisma,
    preferences,
    ai,
    flags,
    scopes,
    entries,
  };
}

describe('the hard/soft boundary', () => {
  it('makes an EXPLICIT country a hard filter', async () => {
    const { service, scopes } = build({});
    await service.search('user-1', { countries: ['ca'] });
    expect(scopes[0].strictCountries).toEqual(['CA']);
  });

  it('makes a SAVED country a ranking signal, never a filter', async () => {
    /*
     * The bug this prevents was already found and fixed once on the internal
     * side: someone whose profile says Seoul searches "Backend Engineer" and
     * is shown only Seoul jobs, with no way to tell that is what happened.
     */
    const intent: CandidateJobIntent = {
      ...emptyJobIntent(ACCOUNT),
      stated: true,
      countries: ['KR'],
      locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
    };
    const { service, scopes } = build({ intent });

    const page = await service.search('user-1', { query: 'Backend Engineer' });

    expect(scopes[0].strictCountries).toEqual([]);
    expect(page.applied.countries.source).toBe('PREFERENCE');
  });

  it('lets an explicit country override the saved one', async () => {
    const intent: CandidateJobIntent = {
      ...emptyJobIntent(ACCOUNT),
      stated: true,
      countries: ['KR'],
      locations: [{ countryCode: 'KR', region: null, city: 'Seoul' }],
    };
    const { service, scopes } = build({ intent });
    const page = await service.search('user-1', { countries: ['DE'] });
    expect(scopes[0].strictCountries).toEqual(['DE']);
    expect(page.applied.countries.source).toBe('REQUEST');
  });

  it('never lets work mode, employment or salary shrink the universe', async () => {
    const { service, scopes, retrieval } = build({});
    await service.search('user-1', {
      query: 'Backend Engineer',
      workModes: ['REMOTE'],
      employmentTypes: ['FULL_TIME'],
      seniorityLevels: ['SENIOR'],
      minCompensation: {
        minAmount: 100_000,
        currency: 'USD',
        payPeriod: 'YEARLY',
      },
    });
    // They reach the scope only to STEER a zero-query candidate set; the hard
    // universe is the text query and nothing else.
    expect(scopes[0].strictCountries).toEqual([]);
    expect(retrieval.countHardUniverse).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'Backend Engineer',
        strictCountries: [],
      }),
    );
  });

  it("applies the candidate's own explicit exclusions", async () => {
    // The one preference-shaped thing that removes a job — and one the
    // candidate asked for by name.
    const intent: CandidateJobIntent = {
      ...emptyJobIntent(ACCOUNT),
      stated: true,
      exclusions: { companies: ['Acme'], jobTitles: [], locations: [] },
    };
    const { service } = build({
      intent,
      rows: [jobRow({ companyName: 'Acme' })],
    });
    const page = await service.search('user-1', { query: 'Backend Engineer' });
    expect(page.results).toHaveLength(0);
  });
});

describe('semantic retrieval is an accelerator, never a dependency', () => {
  it('degrades to lexical-only when Qdrant is down', async () => {
    const { service } = build({ semanticThrows: true });
    const page = await service.search('user-1', { query: 'Backend Engineer' });

    // Results, not a 500. Losing the semantic branch costs recall and nothing
    // else, and the caller is told rather than left to wonder.
    expect(page.degraded).toBe(true);
    expect(page.results).toHaveLength(1);
  });

  it('degrades when the AI service is not configured at all', async () => {
    const { service, ai } = build({ aiEnabled: false });
    const page = await service.search('user-1', { query: 'Backend Engineer' });
    expect(page.degraded).toBe(true);
    expect(ai.searchExternalJobs).not.toHaveBeenCalled();
    expect(page.results).toHaveLength(1);
  });

  it('finds a job the semantic index never knew about', async () => {
    /*
     * A gap in the vector index must not make a job disappear. Postgres holds
     * it, the lexical branch retrieves it, and the search returns it.
     */
    const { service } = build({
      rows: [jobRow({ id: 'unindexed' })],
      lexical: [{ externalJobId: 'unindexed', score: 0.9 }],
      semanticHits: [],
    });
    const page = await service.search('user-1', { query: 'Backend Engineer' });
    expect(page.results.map((r) => r.externalJobId)).toEqual(['unindexed']);
  });

  it('cannot resurrect a job PostgreSQL no longer returns', async () => {
    /*
     * THE stale-point test. Qdrant proposes a job that closed an hour ago;
     * revalidation returns nothing for it; the candidate sees nothing.
     */
    const { service, retrieval } = build({
      rows: [],
      lexical: [],
      semanticHits: [{ externalJobId: 'closed-job', similarity: 0.99 }],
    });
    (retrieval.revalidate as jest.Mock).mockResolvedValue([]);

    const page = await service.search('user-1', { query: 'Backend Engineer' });

    expect(retrieval.revalidate).toHaveBeenCalledWith(
      ['closed-job'],
      expect.anything(),
    );
    expect(page.results).toEqual([]);
  });

  it('does not semantic-search an empty query', async () => {
    // Embedding "" returns the catalogue's centroid — the least specific jobs
    // there are. A browse is answered by structure and recency instead.
    const { service, ai } = build({});
    const page = await service.search('user-1', {});
    expect(ai.searchExternalJobs).not.toHaveBeenCalled();
    expect(page.degraded).toBe(false);
  });
});

describe('snapshots and pagination', () => {
  const many = Array.from({ length: 45 }, (_, index) =>
    jobRow({ id: `job-${String(index).padStart(2, '0')}` }),
  );

  it('pages without duplicates and with a stable total', async () => {
    const { service } = build({ rows: many });
    const first = await service.search('user-1', {
      query: 'Backend',
      pageSize: 20,
    });
    const second = await service.search('user-1', {
      query: 'Backend',
      pageSize: 20,
      page: 2,
    });

    expect(first.total).toBe(second.total);
    expect(first.matched).toBe(second.matched);
    expect(first.results).toHaveLength(20);
    expect(second.results).toHaveLength(20);
    const ids = new Set([
      ...first.results.map((r) => r.externalJobId),
      ...second.results.map((r) => r.externalJobId),
    ]);
    expect(ids.size).toBe(40);
  });

  it('reuses the stored run rather than recomputing', async () => {
    const { service, retrieval } = build({ rows: many });
    const first = await service.search('user-1', { query: 'Backend' });
    const second = await service.search('user-1', {
      query: 'Backend',
      page: 2,
    });

    expect(second.runId).toBe(first.runId);
    expect(second.diagnostics.fromCache).toBe(true);
    // Retrieval ran once for two pages.
    expect((retrieval.lexicalCandidates as jest.Mock).mock.calls).toHaveLength(
      1,
    );
  });

  it('returns the same order for the same page twice', async () => {
    const { service } = build({ rows: many });
    const once = await service.search('user-1', { query: 'Backend', page: 2 });
    const twice = await service.search('user-1', { query: 'Backend', page: 2 });
    expect(twice.results.map((r) => r.externalJobId)).toEqual(
      once.results.map((r) => r.externalJobId),
    );
  });

  it('computes a NEW run when the query changes', async () => {
    const { service } = build({ rows: many });
    const backend = await service.search('user-1', { query: 'Backend' });
    const marketing = await service.search('user-1', { query: 'Marketing' });
    expect(marketing.runId).not.toBe(backend.runId);
  });

  it('reports the honest total even when the funnel truncated', async () => {
    const { service, retrieval } = build({ rows: many });
    (retrieval.countHardUniverse as jest.Mock).mockResolvedValue(4_000);
    const page = await service.search('user-1', { query: 'Backend' });

    /*
     * Two numbers, two questions. `matched` is how many jobs answer the
     * search; `total` is how many this snapshot can page through. Collapsing
     * them either tells the candidate their search found less than it did, or
     * offers them pages that do not exist.
     */
    expect(page.matched).toBe(4_000);
    expect(page.total).toBe(45);
    expect(page.ranked).toBe(45);
    expect(page.truncated).toBe(true);
  });

  it('coalesces two concurrent identical searches into one computation', async () => {
    const { service, retrieval } = build({ rows: many });
    const [a, b] = await Promise.all([
      service.search('user-1', { query: 'Backend' }),
      service.search('user-1', { query: 'Backend' }),
    ]);
    expect(a.runId).toBe(b.runId);
    expect((retrieval.lexicalCandidates as jest.Mock).mock.calls).toHaveLength(
      1,
    );
  });
});

describe('Rule N1 — only CURRENT candidate data', () => {
  it('reads the intent fresh on every search', async () => {
    const { service, preferences } = build({});
    await service.search('user-1', { query: 'Backend' });
    await service.search('user-1', { query: 'Backend' });
    // Even the cached path re-reads intent: a stale snapshot must be
    // unreachable, not merely unused.
    expect((preferences.resolveIntent as jest.Mock).mock.calls.length).toBe(2);
  });

  it('recomputes when the saved intent changes', async () => {
    const { service, preferences } = build({});
    const before = await service.search('user-1', { query: 'Backend' });

    (preferences.resolveIntent as jest.Mock).mockResolvedValue({
      ...emptyJobIntent(ACCOUNT),
      stated: true,
      workModes: ['REMOTE'],
    });
    const after = await service.search('user-1', { query: 'Backend' });

    expect(after.runId).not.toBe(before.runId);
  });

  it('returns to the unpreferenced ranking when preferences are deleted', async () => {
    const stated: CandidateJobIntent = {
      ...emptyJobIntent(ACCOUNT),
      stated: true,
      workModes: ['REMOTE'],
    };
    const { service, preferences } = build({ intent: stated });
    const withPrefs = await service.search('user-1', { query: 'Backend' });

    (preferences.resolveIntent as jest.Mock).mockResolvedValue(
      emptyJobIntent(ACCOUNT),
    );
    const deleted = await service.search('user-1', { query: 'Backend' });

    expect(deleted.runId).not.toBe(withPrefs.runId);
    expect(deleted.applied.workModes.value).toEqual([]);
    expect(deleted.applied.workModes.source).toBe('UNSPECIFIED');
  });

  it('recomputes when the external universe changes', async () => {
    const { service, retrieval } = build({});
    const before = await service.search('user-1', { query: 'Backend' });
    (retrieval.universeRevision as jest.Mock).mockResolvedValue(
      '1800:2026-08-25T00:00:00.000Z',
    );
    const after = await service.search('user-1', { query: 'Backend' });
    expect(after.runId).not.toBe(before.runId);
  });
});

describe('the response', () => {
  it('carries apply and provenance without leaking ingestion internals', async () => {
    const { service } = build({});
    const page = await service.search('user-1', { query: 'Backend' });
    const [result] = page.results;

    expect(result.applyUrl).toBe('https://boards.example.org/1');
    expect(result.provenance.applyVia).toBe('GREENHOUSE');
    expect(result.provenance.sourceCount).toBe(1);

    // Nothing about how the catalogue is built.
    const serialized = JSON.stringify(result);
    for (const leak of [
      'payloadFingerprint',
      'dedupeFingerprint',
      'sourceKey',
      'urlKeys',
      'claims',
      'ingestionRun',
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('echoes what was applied and where it came from', async () => {
    const { service } = build({});
    const page = await service.search('user-1', {
      query: 'Backend Engineer',
      workModes: ['REMOTE'],
    });
    expect(page.applied.query).toBe('Backend Engineer');
    expect(page.applied.workModes.source).toBe('REQUEST');
    expect(page.algorithmVersion).toBe('external-search-v1');
  });
});

/**
 * Sorting.
 *
 * RELEVANCE must be untouched by this feature — a search that did not ask for
 * a sort has to come back exactly as it did before — and NEWEST must be a
 * genuinely different computation, not the same list re-sorted afterwards.
 */
describe('sort', () => {
  const dated = (id: string, at: string | null, title = 'Backend Engineer') =>
    jobRow({
      id,
      title,
      employerPostedAt: at ? new Date(at) : null,
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    });

  it('defaults to relevance and does not touch the funnel', async () => {
    const { service, retrieval } = build({ rows: [dated('a', null)] });
    const page = await service.search('user-1', { query: 'Backend Engineer' });

    expect(page.sort).toBe('RELEVANCE');
    expect(retrieval.lexicalCandidates).toHaveBeenCalled();
    expect(
      (retrieval as unknown as { newestCandidates: jest.Mock })
        .newestCandidates,
    ).not.toHaveBeenCalled();
  });

  it('takes the indexed date path for NEWEST, not the relevance funnel', async () => {
    // The distinction that matters: asking the relevance funnel for the newest
    // returns the newest of the 300 most RELEVANT, silently missing the job
    // posted this morning.
    const { service, retrieval } = build({ rows: [dated('a', null)] });
    await service.search('user-1', {
      query: 'Backend Engineer',
      sort: 'NEWEST',
    });

    expect(
      (retrieval as unknown as { newestCandidates: jest.Mock })
        .newestCandidates,
    ).toHaveBeenCalled();
    expect(retrieval.lexicalCandidates).not.toHaveBeenCalled();
  });

  it('never calls the semantic index for NEWEST', async () => {
    const { service, ai } = build({ rows: [dated('a', null)] });
    await service.search('user-1', {
      query: 'Backend Engineer',
      sort: 'NEWEST',
    });

    // Semantic recall widens a set for a ranking that rewards meaning. In a
    // date-ordered list it would lift jobs that do not contain the query above
    // ones that do, purely for being newer.
    expect(ai.searchExternalJobs).not.toHaveBeenCalled();
  });

  it('never runs degraded in NEWEST, even with the vector store down', async () => {
    const { service } = build({
      rows: [dated('a', null)],
      semanticThrows: true,
    });
    const page = await service.search('user-1', {
      query: 'Backend Engineer',
      sort: 'NEWEST',
    });
    expect(page.degraded).toBe(false);
  });

  it('orders by publication date, newest first', async () => {
    const { service } = build({
      rows: [
        dated('old', '2026-01-05T00:00:00Z'),
        dated('new', '2026-08-20T00:00:00Z'),
        dated('mid', '2026-05-01T00:00:00Z'),
      ],
    });
    const page = await service.search('user-1', {
      sort: 'NEWEST',
      pageSize: 10,
    });
    expect(page.results.map((r) => r.externalJobId)).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('keeps undated jobs reachable, after the dated ones', async () => {
    const { service } = build({
      rows: [dated('undated', null), dated('dated', '2026-08-20T00:00:00Z')],
    });
    const page = await service.search('user-1', {
      sort: 'NEWEST',
      pageSize: 10,
    });
    expect(page.results.map((r) => r.externalJobId)).toEqual([
      'dated',
      'undated',
    ]);
    // Present, not hidden: changing the sort must not make jobs disappear.
    expect(page.total).toBe(2);
  });

  it('returns the publication date in the response', async () => {
    const { service } = build({
      rows: [dated('a', '2026-08-20T09:30:00Z')],
    });
    const page = await service.search('user-1', { sort: 'NEWEST' });
    expect(page.results[0].employerPostedAt).toEqual(
      new Date('2026-08-20T09:30:00Z'),
    );
  });

  it('gives the two sorts different snapshots', async () => {
    // They are computed from different candidate sets, so sharing a stored run
    // would serve one order under the other's name.
    const { service } = build({ rows: [dated('a', '2026-08-20T00:00:00Z')] });
    const relevance = await service.search('user-1', { query: 'x' });
    const newest = await service.search('user-1', {
      query: 'x',
      sort: 'NEWEST',
    });
    expect(newest.runId).not.toBe(relevance.runId);
  });

  it('reuses the stored run for the same newest request', async () => {
    const { service } = build({ rows: [dated('a', '2026-08-20T00:00:00Z')] });
    const first = await service.search('user-1', { sort: 'NEWEST' });
    const second = await service.search('user-1', { sort: 'NEWEST' });
    expect(second.runId).toBe(first.runId);
    expect(second.diagnostics.fromCache).toBe(true);
  });

  it('reports no text score in NEWEST rather than a zero', async () => {
    /*
     * NEWEST takes its candidates from the date index, so nothing ever
     * measured how well each job answers the query. Reporting 0 would state
     * that they answer it badly — about jobs that are in the list precisely
     * because they matched it. Null is what actually happened.
     */
    const { service } = build({ rows: [dated('a', '2026-08-20T00:00:00Z')] });
    const page = await service.search('user-1', {
      query: 'Backend Engineer',
      sort: 'NEWEST',
    });
    expect(page.results[0].textScore).toBeNull();
    expect(page.results[0].band).toBeTruthy();
  });

  it('keeps the text query hard in NEWEST', async () => {
    const { service, scopes } = build({ rows: [dated('a', null)] });
    await service.search('user-1', {
      query: 'Backend Engineer',
      sort: 'NEWEST',
    });
    // Newest within the MATCHED universe. Not the newest jobs in the
    // catalogue with the query quietly ignored.
    expect(scopes[scopes.length - 1].query).toBe('Backend Engineer');
  });

  it('keeps an explicit country hard in NEWEST', async () => {
    const { service, scopes } = build({ rows: [dated('a', null)] });
    await service.search('user-1', { countries: ['ca'], sort: 'NEWEST' });
    expect(scopes[scopes.length - 1].strictCountries).toEqual(['CA']);
  });
});

describe('candidate marks are decoration, never ranking', () => {
  it('attaches saved and tracking flags without touching order or scores', async () => {
    const rows = [
      jobRow({ id: 'job-a', title: 'Backend Engineer' }),
      jobRow({ id: 'job-b', title: 'Backend Developer' }),
    ];

    // First: what the ranking says when the candidate has NO marks.
    const bare = build({ rows });
    const before = await bare.service.search('user-1', {
      query: 'Backend Engineer',
    });

    // Then: the same search for a candidate who saved and tracked job-b.
    const marked = build({ rows });
    const tracker = {
      id: 'trk-1',
      status: 'APPLIED',
      appliedAt: new Date('2026-08-20T12:00:00.000Z'),
    };
    (marked.flags.flagsFor as jest.Mock).mockResolvedValue({
      saved: new Set(['job-b']),
      tracking: new Map([['job-b', tracker]]),
    });
    const after = await marked.service.search('user-1', {
      query: 'Backend Engineer',
    });

    // Identical order, identical scores: a bookmark records interest, it
    // does not create relevance. The flags live beside the ranking fields.
    expect(after.results.map((r) => r.externalJobId)).toEqual(
      before.results.map((r) => r.externalJobId),
    );
    expect(after.results.map((r) => r.score)).toEqual(
      before.results.map((r) => r.score),
    );
    const jobB = after.results.find((r) => r.externalJobId === 'job-b');
    const jobA = after.results.find((r) => r.externalJobId === 'job-a');
    expect(jobB?.saved).toBe(true);
    expect(jobB?.applicationTracking).toEqual(tracker);
    expect(jobA?.saved).toBe(false);
    expect(jobA?.applicationTracking).toBeNull();
  });

  it('asks for the marks once per page, for exactly the page ids', async () => {
    const rows = [jobRow({ id: 'job-a' }), jobRow({ id: 'job-b' })];
    const { service, flags } = build({ rows });
    await service.search('user-1', { query: 'Backend Engineer' });

    // One bulk lookup for the page — a per-card lookup would be N+1 here.
    expect(flags.flagsFor as jest.Mock).toHaveBeenCalledTimes(1);
    const [account, ids] = (flags.flagsFor as jest.Mock).mock.calls[0] as [
      string,
      string[],
    ];
    expect(account).toBe('acct-1');
    expect([...ids].sort()).toEqual(['job-a', 'job-b']);
  });
});

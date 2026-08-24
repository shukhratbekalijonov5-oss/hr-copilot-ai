import { PublicJobsService } from './public-jobs.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CandidateAccountService } from '../candidate-account/candidate-account.service';
import { VacancyStatus } from '../generated/prisma/enums';

/**
 * Find Jobs semantics: what a search RESTRICTS versus what it merely ORDERS.
 *
 * The rule under test, in one line: searching "Backend Engineer" returns every
 * backend vacancy in the catalogue, and every other control the page offers
 * decides only what the candidate reads first. The one exception is a location
 * picked for this search, which genuinely narrows.
 *
 * These tests come in two halves, and both are needed. Asserting on the WHERE
 * clause proves nothing soft leaks into SQL — a filter that shrinks the
 * universe cannot be caught by looking at an order. Asserting on the returned
 * order proves the soft dimensions actually do something — a "soft" filter
 * that is silently ignored would pass every universe test and still be broken.
 */

const KRW_PER_USD = 1385.7418;
const FX_TABLE = {
  baseCurrency: 'USD',
  rates: { USD: 1, KRW: KRW_PER_USD, CAD: 1.3763, EUR: 0.856 },
};

let clock = 0;

/**
 * One catalogue row, in the shape the list query selects.
 *
 * Each row is NEWER than the last, so the fixture's declaration order is the
 * exact REVERSE of `createdAt desc`. That is deliberate: the best-aligned job
 * is declared first and is therefore the oldest, so any test asserting it
 * ranks top fails unless the alignment actually moved it there. With the two
 * orders agreeing, an inert ranking would pass every one of these.
 */
function vacancy(slug: string, over: Record<string, unknown> = {}) {
  clock += 1000;
  return {
    id: `id-${slug}`,
    publicSlug: slug,
    title: 'Backend Engineer',
    department: null,
    location: null,
    employmentType: 'Full-time',
    experienceLevel: null,
    createdAt: new Date(1_700_000_000_000 + clock),
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    salaryNegotiable: false,
    country: null,
    region: null,
    city: null,
    workMode: null,
    seniorityLevel: null,
    remoteCountriesAllowed: [],
    benefits: [],
    domainExperience: [],
    organization: { name: 'Acme' },
    ...over,
  };
}

/**
 * The catalogue the matrix runs against: eight backend vacancies that differ
 * on one soft dimension each, plus a frontend job that must never appear in a
 * backend search.
 */
function catalogue() {
  return [
    vacancy('be-remote-ft-senior-40m-krw', {
      title: 'Senior Backend Engineer',
      workMode: 'REMOTE',
      employmentType: 'Full-time',
      seniorityLevel: 'SENIOR',
      country: 'KR',
      city: 'Seoul',
      salaryMin: 40_000_000,
      currency: 'KRW',
      payPeriod: 'YEARLY',
    }),
    vacancy('be-hybrid-ft-mid', {
      workMode: 'HYBRID',
      employmentType: 'Full-time',
      seniorityLevel: 'MID',
      country: 'KR',
      city: 'Seoul',
    }),
    vacancy('be-onsite-contract-junior', {
      title: 'Backend Developer',
      workMode: 'ONSITE',
      employmentType: 'Contract',
      seniorityLevel: 'JUNIOR',
      country: 'CA',
      city: 'Toronto',
    }),
    vacancy('be-remote-parttime-lead', {
      title: 'Node.js Backend Engineer',
      workMode: 'REMOTE',
      employmentType: 'Part-time',
      seniorityLevel: 'LEAD',
      country: 'CA',
    }),
    vacancy('be-unknown-everything'),
    vacancy('be-low-pay', {
      workMode: 'ONSITE',
      seniorityLevel: 'INTERN',
      salaryMin: 15_000_000,
      currency: 'KRW',
      payPeriod: 'YEARLY',
    }),
    vacancy('be-eur-pay', {
      workMode: 'HYBRID',
      seniorityLevel: 'SENIOR',
      salaryMin: 40_000,
      currency: 'EUR',
      payPeriod: 'YEARLY',
    }),
    vacancy('be-usd-pay', {
      workMode: 'REMOTE',
      seniorityLevel: 'SENIOR',
      salaryMin: 30_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
    }),
  ];
}

/** The only clause shapes this service is allowed to build. */
interface WhereClause {
  OR?: WhereClause[];
  title?: { contains: string };
  description?: { contains: string };
  country?: { in: string[] };
  workMode?: string | { in: string[] };
  remoteCountriesAllowed?: { hasSome: string[] };
  seniorityLevel?: { in: string[] };
  employmentType?: { in: string[] };
  location?: { contains: string };
}

interface FindManyArgs {
  where: { status?: string; AND?: WhereClause[] };
  skip?: number;
  take?: number;
  orderBy?: Record<string, string>;
  select?: Record<string, unknown>;
}

/**
 * Applies the WHERE the service built.
 *
 * Without this the stub would return the whole catalogue no matter what was
 * filtered, and every "nothing was removed" assertion would be true of the
 * mock rather than of the code. It understands exactly the clauses this
 * service is allowed to produce — plus the ones it must NOT, so a filter that
 * sneaks back in visibly shrinks the results.
 */
function applyWhere(
  rows: ReturnType<typeof catalogue>,
  where: FindManyArgs['where'],
): ReturnType<typeof catalogue> {
  const matches = (
    row: (typeof rows)[number],
    clause: WhereClause,
  ): boolean => {
    if (clause.OR) return clause.OR.some((branch) => matches(row, branch));
    if (clause.title) {
      return row.title
        .toLowerCase()
        .includes(clause.title.contains.toLowerCase());
    }
    // The description clause travels with the title one; the fixtures have no
    // descriptions, so it can only ever match through its sibling.
    if (clause.description) return false;
    if (clause.country) return clause.country.in.includes(row.country ?? '');
    if (clause.remoteCountriesAllowed) {
      return (
        row.workMode === 'REMOTE' &&
        row.remoteCountriesAllowed.some((code) =>
          clause.remoteCountriesAllowed!.hasSome.includes(code),
        )
      );
    }
    // Everything below is a dimension that must be SOFT. Honouring it makes a
    // regression show up as missing results rather than passing silently.
    if (clause.workMode && typeof clause.workMode !== 'string') {
      return clause.workMode.in.includes(row.workMode ?? '');
    }
    if (clause.seniorityLevel) {
      return clause.seniorityLevel.in.includes(row.seniorityLevel ?? '');
    }
    if (clause.employmentType) {
      return clause.employmentType.in.includes(row.employmentType ?? '');
    }
    if (clause.location) {
      return (row.location ?? '').includes(clause.location.contains);
    }
    return true;
  };

  const clauses = where.AND ?? [];
  return rows.filter((row) => clauses.every((clause) => matches(row, clause)));
}

function createPrismaMock(rows: ReturnType<typeof catalogue>) {
  return {
    vacancy: {
      findMany: jest.fn(({ where, skip, take }: FindManyArgs) => {
        const matched = applyWhere(rows, where);
        const from = skip ?? 0;
        return Promise.resolve(matched.slice(from, from + (take ?? 50)));
      }),
      count: jest.fn(({ where }: FindManyArgs) =>
        Promise.resolve(applyWhere(rows, where).length),
      ),
      findFirst: jest.fn(),
    },
    application: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : Promise.resolve(null),
    ),
  };
}

function build(rows = catalogue(), table: unknown = FX_TABLE) {
  const prisma = createPrismaMock(rows);
  const fx = { current: jest.fn().mockResolvedValue({ table }) };
  const service = new PublicJobsService(
    prisma as unknown as PrismaService,
    {} as unknown as CandidateAccountService,
    { publish: jest.fn() } as never,
    fx as never,
  );
  return { service, prisma, fx };
}

const BASE = { page: 1, limit: 50, skip: 0 };

/** The WHERE the service built, flattened for inspection. */
function whereOf(prisma: ReturnType<typeof createPrismaMock>) {
  const where = prisma.vacancy.findMany.mock.calls[0][0].where as Record<
    string,
    unknown
  >;
  return { where, json: JSON.stringify(where) };
}

async function slugs(service: PublicJobsService, query: object) {
  const { data } = await service.list({ ...BASE, ...query });
  return (data as { publicSlug: string }[]).map((job) => job.publicSlug);
}

/** Each result's slug with the alignment score that placed it. */
async function ranked(service: PublicJobsService, query: object) {
  const { data } = await service.list({ ...BASE, ...query });
  return (
    data as { publicSlug: string; searchAlignment: { score: number } }[]
  ).map((job) => ({ slug: job.publicSlug, score: job.searchAlignment.score }));
}

/** Slugs whose TITLE answers the text query — what the database would return. */
function titleMatches(needle: string): string[] {
  return catalogue()
    .filter((row) => row.title.toLowerCase().includes(needle.toLowerCase()))
    .map((row) => row.publicSlug);
}

/** Scores must never increase as the reader goes down the list. */
function isDescending(scores: number[]): boolean {
  return scores.every((score, i) => i === 0 || scores[i - 1] >= score);
}

describe('the primary query owns the result universe', () => {
  it('a role search restricts by TEXT and nothing else', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, search: 'Backend Engineer' });

    const { where, json } = whereOf(prisma);
    expect(where.status).toBe(VacancyStatus.OPEN);
    expect(json).toContain('Backend Engineer');
    // The text query is the ONLY narrowing clause.
    expect((where.AND as unknown[]).length).toBe(1);
  });

  it("title variants are the database's business, not a second filter", async () => {
    // "Senior Backend Engineer", "Backend Developer" and "Node.js Backend
    // Engineer" all sit in the fixture and all come back: nothing in this
    // service re-checks a title after the query returned it.
    const { service } = build();

    const found = await slugs(service, { search: 'Backend' });

    expect(found).toEqual(
      expect.arrayContaining([
        'be-remote-ft-senior-40m-krw',
        'be-onsite-contract-junior',
        'be-remote-parttime-lead',
      ]),
    );
  });

  it('a saved ROLE preference never becomes a keyword', async () => {
    // Only `search` reaches the text clause, and it is request-only. A saved
    // "Frontend Engineer" cannot smuggle itself into a backend search.
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      search: 'Backend Engineer',
      preferredCountries: ['KR'],
    });

    expect(whereOf(prisma).json).not.toContain('Frontend');
  });
});

describe('explicit location is the one hard secondary filter', () => {
  it('a chosen country restricts the universe', async () => {
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      search: 'Backend Engineer',
      countries: ['KR'],
    });

    const { json } = whereOf(prisma);
    expect(json).toContain('"country"');
    expect(json).toContain('KR');
  });

  it('a REMOTE role open to the chosen country counts as being in it', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, countries: ['KR'] });

    expect(whereOf(prisma).json).toContain('remoteCountriesAllowed');
  });

  it('a SAVED country is soft and never reaches the query', async () => {
    // The rule: someone whose profile says Seoul who searches "Backend
    // Engineer" is asking about backend engineering. Their saved city ranks
    // Seoul first; it must not hide Toronto.
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      search: 'Backend Engineer',
      preferredCountries: ['KR'],
    });

    const { where, json } = whereOf(prisma);
    expect(json).not.toContain('"country"');
    expect((where.AND as unknown[]).length).toBe(1); // the text query only
  });

  it('a saved country ORDERS the same universe it must not shrink', async () => {
    const { service } = build();

    const found = await ranked(service, { preferredCountries: ['KR'] });

    expect(found).toHaveLength(catalogue().length);
    // Both Korean jobs lead — which of the two comes first is a tie the
    // recency tie-break settles, and asserting either would be asserting the
    // tie-break rather than the preference.
    expect(
      found
        .slice(0, 2)
        .map((r) => r.slug)
        .sort(),
    ).toEqual(['be-hybrid-ft-mid', 'be-remote-ft-senior-40m-krw']);
    expect(isDescending(found.map((r) => r.score))).toBe(true);
    // Canada is ranked lower, not removed.
    expect(found.map((r) => r.slug)).toContain('be-onsite-contract-junior');
  });

  it('an explicit country overrides a saved one without inheriting it', async () => {
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      countries: ['CA'],
      preferredCountries: ['KR'],
    });

    const { json } = whereOf(prisma);
    expect(json).toContain('CA');
    // The saved KR must not have been AND-ed in beside the requested CA.
    expect(json).not.toContain('KR');
  });
});

describe('work arrangement is soft', () => {
  it('remote ranks first and nothing is removed', async () => {
    const { service } = build();

    const found = await slugs(service, { workModes: ['REMOTE'] });

    expect(found).toHaveLength(catalogue().length);
    expect(found.slice(0, 3)).toEqual(
      expect.arrayContaining([
        'be-remote-ft-senior-40m-krw',
        'be-remote-parttime-lead',
        'be-usd-pay',
      ]),
    );
    expect(found).toContain('be-hybrid-ft-mid');
    expect(found).toContain('be-onsite-contract-junior');
  });

  it('work mode never reaches the WHERE clause', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, workModes: ['REMOTE'] } as never);

    expect(whereOf(prisma).json).not.toContain('workMode');
  });

  it('a job whose employer named no work mode is not punished', async () => {
    // UNKNOWN scores null and drops out of the average, so this job keeps
    // whatever the rest of the search says about it rather than sinking.
    const { service } = build();

    const found = await slugs(service, { workModes: ['REMOTE'] });

    expect(found).toContain('be-unknown-everything');
  });
});

describe('employment type is soft', () => {
  it('full-time ranks above contract, and contract remains', async () => {
    const { service } = build();

    const found = await slugs(service, { employmentTypes: ['FULL_TIME'] });

    expect(found).toHaveLength(catalogue().length);
    expect(found).toContain('be-onsite-contract-junior');
    expect(found.indexOf('be-hybrid-ft-mid')).toBeLessThan(
      found.indexOf('be-onsite-contract-junior'),
    );
  });

  it('employment type never reaches the WHERE clause', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, employmentTypes: ['FULL_TIME'] } as never);

    expect(whereOf(prisma).json).not.toContain('employmentType');
  });
});

describe('experience level is soft, and uses the shared ladder', () => {
  it('senior strongest, adjacent next, junior still present', async () => {
    const { service } = build();

    const found = await ranked(service, { seniorityLevels: ['SENIOR'] });
    const order = found.map((r) => r.slug);

    expect(found).toHaveLength(catalogue().length);
    // Every SENIOR job scores 100 and leads; the ladder then places LEAD (one
    // rung away, half credit) above JUNIOR (two rungs, none).
    expect(
      found
        .slice(0, 3)
        .map((r) => r.slug)
        .sort(),
    ).toEqual(['be-eur-pay', 'be-remote-ft-senior-40m-krw', 'be-usd-pay']);
    expect(found.slice(0, 3).every((r) => r.score === 100)).toBe(true);
    expect(order.indexOf('be-remote-parttime-lead')).toBeLessThan(
      order.indexOf('be-onsite-contract-junior'),
    );
    expect(isDescending(found.map((r) => r.score))).toBe(true);
    expect(order).toContain('be-onsite-contract-junior');
  });

  it('seniority never reaches the WHERE clause', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, seniorityLevels: ['SENIOR'] } as never);

    expect(whereOf(prisma).json).not.toContain('seniorityLevel');
  });
});

describe('salary is soft, and global', () => {
  const SALARY = {
    salaryMin: 20_000,
    salaryCurrency: 'USD',
    payPeriod: 'YEARLY',
  };

  it('a KRW job answers a USD floor through the FX snapshot', async () => {
    const { service } = build();

    const found = await slugs(service, SALARY);

    // 40,000,000 KRW ≈ 28,865 USD clears a 20,000 USD floor; 15,000,000 KRW
    // ≈ 10,824 USD does not — and both are still listed.
    expect(found).toHaveLength(catalogue().length);
    expect(found.indexOf('be-remote-ft-senior-40m-krw')).toBeLessThan(
      found.indexOf('be-low-pay'),
    );
  });

  it('a job paying below the floor is ranked down, never removed', async () => {
    const { service } = build();

    expect(await slugs(service, SALARY)).toContain('be-low-pay');
  });

  it('a job with no stated salary stays exactly where it was', async () => {
    const { service } = build();

    expect(await slugs(service, SALARY)).toContain('be-unknown-everything');
  });

  it('an FX outage removes nothing', async () => {
    // No rate table: the KRW and EUR jobs become NOT_COMPARABLE, which is
    // neutral. Our outage must never read as a fact about a job.
    const { service } = build(catalogue(), null);

    const found = await slugs(service, SALARY);

    expect(found).toHaveLength(catalogue().length);
    expect(found).toContain('be-remote-ft-senior-40m-krw');
    expect(found).toContain('be-eur-pay');
  });

  it('salary never reaches the WHERE clause', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, ...SALARY } as never);

    const { where, json } = whereOf(prisma);
    expect(json).not.toContain('salaryMin');
    expect(where.AND).toBeUndefined();
  });

  it('choosing USD does NOT restrict results to USD postings', async () => {
    // The currency says how to READ the number the candidate typed. Reading it
    // as "only USD jobs" would hide most of the planet from anyone who thinks
    // in dollars.
    const { service } = build();

    const found = await slugs(service, SALARY);

    expect(found).toContain('be-remote-ft-senior-40m-krw'); // KRW
    expect(found).toContain('be-eur-pay'); // EUR
    expect(found).toContain('be-usd-pay'); // USD
  });

  it('an incomplete salary triple is not a filter at all', async () => {
    const { service, prisma } = build();

    // An amount with no currency cannot mean anything, so it means nothing.
    await service.list({ ...BASE, salaryMin: 20_000 });

    expect(whereOf(prisma).where.AND).toBeUndefined();
    expect(prisma.vacancy.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    });
  });
});

describe('everything combined', () => {
  const EVERYTHING = {
    search: 'Backend Engineer',
    workModes: ['REMOTE'],
    employmentTypes: ['FULL_TIME'],
    seniorityLevels: ['SENIOR'],
    salaryMin: 20_000,
    salaryCurrency: 'USD',
    payPeriod: 'YEARLY',
  };

  it('four soft dimensions at once still remove nothing', async () => {
    const { service, prisma } = build();

    const found = await slugs(service, EVERYTHING);

    // The text query is the only thing that removed anything: the result is
    // exactly what the title search matched, no smaller.
    expect(found.sort()).toEqual(titleMatches('Backend Engineer').sort());
    expect((whereOf(prisma).where.AND as unknown[]).length).toBe(1);
  });

  it('the best all-round answer leads, the weakest trails, all are reachable', async () => {
    const { service } = build();

    const found = await ranked(service, EVERYTHING);
    const order = found.map((r) => r.slug);

    // Two jobs answer all four soft dimensions perfectly and share the lead.
    expect(found[0].score).toBe(100);
    expect(
      found
        .slice(0, 2)
        .map((r) => r.slug)
        .sort(),
    ).toEqual(['be-remote-ft-senior-40m-krw', 'be-usd-pay']);
    expect(isDescending(found.map((r) => r.score))).toBe(true);
    // The weakest all-round answer is last, and still reachable.
    expect(order).toContain('be-unknown-everything');
    expect(order[order.length - 1]).not.toBe(found[0].slug);
  });

  it('a job the employer said nothing about does NOT tie one that answered everything', async () => {
    // The bug this pins: reusing AI Job Match's aggregation drops unstated
    // dimensions from the average, so `be-unknown-everything` — silent on work
    // mode, seniority and pay — answered one of four questions and scored a
    // perfect 100, tying the job that answered all four. The least informative
    // posting led the page.
    const { service } = build();

    const found = await ranked(service, EVERYTHING);
    const byslug = new Map(found.map((r) => [r.slug, r.score]));

    expect(byslug.get('be-remote-ft-senior-40m-krw')).toBe(100);
    expect(byslug.get('be-unknown-everything')).toBeLessThan(100);
    // Ranked lower, never removed, and never called a mismatch.
    expect(found.map((r) => r.slug)).toContain('be-unknown-everything');
  });

  it('silence still outranks a stated conflict', async () => {
    // Unknown is not a penalty dressed up: a job that says nothing keeps the
    // weight it could not answer, while a job that CONTRADICTS the search
    // loses those dimensions outright.
    const { service } = build();

    const found = await ranked(service, { workModes: ['REMOTE'] });
    const byslug = new Map(found.map((r) => [r.slug, r.score]));

    expect(byslug.get('be-unknown-everything')).toBeGreaterThan(
      byslug.get('be-onsite-contract-junior') as number,
    );
  });

  it('adding an explicit location — and only that — shrinks the universe', async () => {
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      ...EVERYTHING,
      countries: ['KR'],
    } as never);

    const clauses = whereOf(prisma).where.AND as unknown[];
    expect(clauses).toHaveLength(2); // text + location, nothing else
    expect(JSON.stringify(clauses)).toContain('KR');
  });
});

describe('ordering the whole universe, then paginating it', () => {
  it('ranks every result before slicing a page', async () => {
    const { service, prisma } = build();

    await service.list({
      ...BASE,
      page: 2,
      limit: 3,
      skip: 3,
      workModes: ['REMOTE'],
    } as never);

    // No skip/take on the query: the database hands over the universe and the
    // ORDER is decided across all of it. Ranking one DB page would let a
    // stronger job sit unread on page three.
    const call = prisma.vacancy.findMany.mock.calls[0][0];
    expect(call.skip).toBeUndefined();
    expect(call.take).toBe(1000);
  });

  it('paging forward walks the ranking without repeating or dropping', async () => {
    const { service } = build();
    const all = await slugs(service, { workModes: ['REMOTE'] });

    const pages: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const { data } = await service.list({
        page,
        limit: 3,
        skip: (page - 1) * 3,
        workModes: ['REMOTE'],
      } as never);
      pages.push(
        ...(data as { publicSlug: string }[]).map((j) => j.publicSlug),
      );
    }

    expect(pages).toEqual(all.slice(0, pages.length));
    expect(new Set(pages).size).toBe(pages.length);
  });

  it('reports the size of the ranked universe, not of the page', async () => {
    const { service } = build();

    const result = await service.list({
      page: 1,
      limit: 2,
      skip: 0,
      workModes: ['REMOTE'],
    } as never);

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(catalogue().length);
  });

  it('equal alignment falls back to a stable, deterministic order', async () => {
    // Two jobs the search cannot tell apart must not swap between requests, or
    // a reader paging forward sees one twice and never sees the other.
    const { service } = build();

    const first = await slugs(service, { workModes: ['REMOTE'] });
    const second = await slugs(service, { workModes: ['REMOTE'] });

    expect(first).toEqual(second);
  });

  it('with nothing soft asked, the catalogue keeps its own order', async () => {
    const { service, prisma } = build();

    await service.list({ ...BASE, search: 'Backend' });

    // Straight to the database, paginated there — no ranking to do.
    const call = prisma.vacancy.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(call.take).toBe(50);
  });
});

describe('the ordering is explained, not asserted', () => {
  it('a ranked result carries the alignments that placed it', async () => {
    const { service } = build();

    const { data } = await service.list({
      ...BASE,
      workModes: ['REMOTE'],
      seniorityLevels: ['SENIOR'],
    } as never);

    const top = (data as Record<string, never>[])[0];
    const alignment = top.searchAlignment as unknown as {
      score: number;
      alignments: { dimension: string; reason: string }[];
    };
    expect(alignment.score).toBe(100);
    expect(alignment.alignments.map((a) => a.dimension).sort()).toEqual([
      'seniority',
      'workMode',
    ]);
  });

  it('an unranked list explains nothing, because it decided nothing', async () => {
    const { service } = build();

    const { data } = await service.list({ ...BASE });

    expect((data as Record<string, unknown>[])[0]).not.toHaveProperty(
      'searchAlignment',
    );
  });
});

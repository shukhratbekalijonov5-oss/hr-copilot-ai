import { ExternalJobCardService } from './external-job-card.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The card loader behind the saved and tracking lists. Its one structural
 * difference from the search's own loader is the POINT of these tests: no
 * status filter, because a candidate's own lists must show a closed job
 * honestly rather than pretend it never existed.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    title: 'Backend Engineer',
    status: 'CLOSED',
    countryCode: 'US',
    region: null,
    city: 'NYC',
    additionalLocations: null,
    workMode: 'REMOTE',
    remoteCountriesAllowed: ['US'],
    employmentType: 'FULL_TIME',
    seniorityLevel: 'SENIOR',
    salaryMin: 100_000,
    salaryMax: 150_000,
    currency: 'USD',
    payPeriod: 'YEARLY',
    employerPostedAt: new Date('2026-08-01T12:00:00.000Z'),
    canonicalUrl: 'https://jobs.example.org/1',
    company: { name: 'Acme', websiteUrl: null },
    sources: [
      {
        provider: 'LEVER',
        originalUrl: 'https://other.example.org/1',
        sourceUrl: 'https://other.example.org/1',
        status: 'GONE',
      },
      {
        provider: 'GREENHOUSE',
        originalUrl: 'https://jobs.example.org/1',
        sourceUrl: 'https://api.example.org/1',
        status: 'ACTIVE',
      },
    ],
    ...over,
  };
}

function build(rows: unknown[] = [row()]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { externalJob: { findMany } } as unknown as PrismaService;
  return { service: new ExternalJobCardService(prisma), findMany };
}

describe('ExternalJobCardService', () => {
  it('runs no query for an empty page', async () => {
    const { service, findMany } = build();
    expect((await service.loadCards([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('loads by id WITHOUT a status filter — closed jobs stay visible', async () => {
    const { service, findMany } = build();
    const cards = await service.loadCards(['job-1']);

    // The search's loader restricts to ACTIVE|STALE, correctly, because a
    // search shows the current universe. This loader must not: the saved
    // and tracking lists are the candidate's own history.
    expect(findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['job-1'] },
    });
    expect(cards.get('job-1')?.status).toBe('CLOSED');
  });

  it('keeps provenance from ACTIVE sources first, falling back honestly', async () => {
    const { service } = build();
    const card = (await service.loadCards(['job-1'])).get('job-1');

    // The GONE source is real provenance but the ACTIVE one leads, so a
    // current job answers exactly as it does in a search response.
    expect(card?.provenance).toEqual({
      primarySource: 'GREENHOUSE',
      applyVia: 'GREENHOUSE',
      sourceCount: 2,
    });
    expect(card?.applyUrl).toBe('https://jobs.example.org/1');
  });

  it('never selects crawler timestamps or ingestion internals', async () => {
    const { service, findMany } = build();
    await service.loadCards(['job-1']);

    const select = findMany.mock.calls[0][0].select;
    for (const forbidden of [
      'firstSeenAt',
      'lastSeenAt',
      'lastVerifiedAt',
      'dedupeFingerprint',
      'searchableUpdatedAt',
      'normalizedTitle',
    ]) {
      expect(select).not.toHaveProperty(forbidden);
    }
    // The employer's own date IS selected — the only publication claim.
    expect(select.employerPostedAt).toBe(true);
  });
});

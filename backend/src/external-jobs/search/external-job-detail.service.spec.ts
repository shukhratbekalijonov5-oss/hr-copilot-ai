import { NotFoundException } from '@nestjs/common';
import { ExternalJobDetailService } from './external-job-detail.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * What one job looks like to the person reading it.
 *
 * The interesting assertions are all about ABSENCE. This service is the only
 * place a full external job row leaves the backend, so it is the one place a
 * future select could quietly start shipping an ingestion fingerprint or a
 * crawler timestamp to a job seeker's browser. The tests below fail when that
 * happens rather than after someone notices it in a payload.
 */

function row(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Backend Engineer',
    description: 'Build and operate the services behind the product.',
    requirementsText: 'Five years of Go.',
    status: 'ACTIVE',
    countryCode: 'US',
    region: 'NY',
    city: 'New York City',
    additionalLocations: [{ countryCode: 'CA', city: 'Toronto' }],
    workMode: 'REMOTE',
    remoteCountriesAllowed: ['US', 'CA'],
    employmentType: 'FULL_TIME',
    seniorityLevel: 'SENIOR',
    salaryMin: 200_000,
    salaryMax: 310_000,
    currency: 'USD',
    payPeriod: 'YEARLY',
    employerPostedAt: new Date('2026-08-20T10:00:00.000Z'),
    skills: ['Go'],
    industries: ['FINTECH'],
    benefits: ['HEALTH_INSURANCE'],
    languageCodes: ['en'],
    canonicalUrl: 'https://jobs.example.org/eng/1',
    company: { name: 'Acme', websiteUrl: 'https://acme.example' },
    sources: [
      {
        provider: 'GREENHOUSE',
        originalUrl: 'https://jobs.example.org/eng/1',
        sourceUrl: 'https://boards-api.example.org/1',
      },
    ],
    ...over,
  };
}

function build(result: unknown) {
  const findFirst = jest.fn().mockResolvedValue(result);
  const prisma = { externalJob: { findFirst } } as unknown as PrismaService;
  const preferences = {
    requireAccountId: jest.fn().mockResolvedValue('acct-1'),
  } as unknown as import('../../candidate-preferences/candidate-preferences.service').CandidatePreferencesService;
  const flagsFor = jest
    .fn()
    .mockResolvedValue({ saved: new Set<string>(), tracking: new Map() });
  const flags = {
    flagsFor,
  } as unknown as import('../candidate/candidate-external-flags.service').CandidateExternalFlagsService;
  return {
    service: new ExternalJobDetailService(prisma, preferences, flags),
    findFirst,
    flagsFor,
  };
}

const USER = 'user-1';

describe('ExternalJobDetailService', () => {
  it('reads only the current universe', async () => {
    const { service, findFirst } = build(row());
    await service.detail('11111111-1111-4111-8111-111111111111', USER);

    // The same status predicate the search uses. A detail view that could
    // render a CLOSED job would be a second opinion about what exists.
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      status: { in: ['ACTIVE', 'STALE'] },
    });
  });

  it('is a 404 when the job has left the universe', async () => {
    const { service } = build(null);
    await expect(
      service.detail('11111111-1111-4111-8111-111111111111', USER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the facts a reader needs to decide', async () => {
    const { service } = build(row());
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );

    expect(detail.title).toBe('Backend Engineer');
    expect(detail.company).toBe('Acme');
    expect(detail.description).toContain('services behind the product');
    expect(detail.location).toEqual({
      countryCode: 'US',
      region: 'NY',
      city: 'New York City',
    });
    expect(detail.additionalLocations).toEqual([
      { countryCode: 'CA', city: 'Toronto' },
    ]);
    // Stated remote geography travels; it is what stops a card from implying
    // that REMOTE means anywhere on earth.
    expect(detail.remoteCountriesAllowed).toEqual(['US', 'CA']);
    expect(detail.salary).toEqual({
      min: 200_000,
      max: 310_000,
      currency: 'USD',
      payPeriod: 'YEARLY',
    });
  });

  it('never exposes ingestion internals or crawler timestamps', async () => {
    const { service, findFirst } = build(row());
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );

    const serialized = JSON.stringify(detail);
    for (const forbidden of [
      'dedupeFingerprint',
      'sourceKey',
      'sourceScope',
      'claims',
      'urlKeys',
      'canonicalSourceId',
      'normalizedTitle',
      'searchDocument',
      // Crawler freshness. Present in the row and deliberately not selected:
      // rendering it as "posted" would attribute our sweep to the employer.
      'lastSeenAt',
      'firstSeenAt',
      'lastVerifiedAt',
      'searchableUpdatedAt',
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(findFirst.mock.calls[0][0].select).not.toHaveProperty(forbidden);
    }
  });

  it('summarizes provenance without naming the ingestion path', async () => {
    const { service } = build(
      row({
        canonicalUrl: 'https://acme.example/careers/eng-1',
        sources: [
          {
            provider: 'COMPANY_CAREERS',
            originalUrl: 'https://acme.example/careers/eng-1',
            sourceUrl: 'https://acme.example/careers',
          },
          {
            provider: 'GREENHOUSE',
            originalUrl: 'https://boards.example.org/acme/1',
            sourceUrl: 'https://boards-api.example.org/acme/1',
          },
        ],
      }),
    );
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );

    expect(detail.provenance).toEqual({
      primarySource: 'COMPANY_CAREERS',
      applyVia: 'COMPANY_CAREERS',
      sourceCount: 2,
    });
  });

  it('sends the applicant to the stored canonical URL and nowhere else', async () => {
    const { service } = build(row());
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );
    expect(detail.applyUrl).toBe('https://jobs.example.org/eng/1');
  });

  it('carries no score, band, reason or rank', async () => {
    const { service } = build(row());
    const detail = (await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    )) as unknown as Record<string, unknown>;

    // Personalization lives in the search response, which knows who asked.
    // Two candidates opening the same job read the same page.
    for (const field of ['score', 'band', 'reasons', 'textScore', 'rank']) {
      expect(detail).not.toHaveProperty(field);
    }
  });

  it("carries the caller's own marks, defaulting to none", async () => {
    const { service, flagsFor } = build(row());
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );

    // The only personalization on this page: the caller's own bookmark and
    // tracker. Looked up for exactly this one id, for exactly this caller.
    expect(detail.saved).toBe(false);
    expect(detail.applicationTracking).toBeNull();
    expect(flagsFor).toHaveBeenCalledWith('acct-1', [
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('reports saved and tracking when the caller has them', async () => {
    const { service, flagsFor } = build(row());
    const tracker = {
      id: 'trk-1',
      status: 'APPLIED',
      appliedAt: new Date('2026-08-24T00:00:00.000Z'),
    };
    flagsFor.mockResolvedValue({
      saved: new Set(['11111111-1111-4111-8111-111111111111']),
      tracking: new Map([['11111111-1111-4111-8111-111111111111', tracker]]),
    });
    const detail = await service.detail(
      '11111111-1111-4111-8111-111111111111',
      USER,
    );

    expect(detail.saved).toBe(true);
    expect(detail.applicationTracking).toEqual(tracker);
  });
});

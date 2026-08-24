import { NotFoundException } from '@nestjs/common';
import { ExternalPremiumAiContextService } from './external-premium-ai.context';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import type { FxRateService } from '../../fx/fx-rate.service';
import { emptyJobIntent } from '../../candidate-preferences/candidate-job-intent';

/**
 * The grounded context: what a model may see, and what makes a cached answer
 * from an older version of the candidate unreachable.
 */

const JOB = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'acct-1';

const ACCOUNT_ROW = {
  headline: 'Backend Engineer',
  summary: 'Six years on payments platforms.',
  location: 'Seoul, KR',
  skills: ['Go', 'PostgreSQL'],
  languages: ['en', 'ko'],
  experience: [{ title: 'Senior Engineer', company: 'Acme', period: '2021–' }],
  education: [{ degree: 'BSc', field: 'CS', school: 'SNU' }],
  evidenceRevision: 7,
  updatedAt: new Date('2026-08-20T10:00:00.000Z'),
};

const JOB_ROW: {
  id: string;
  title: string;
  status: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  [key: string]: unknown;
} = {
  id: JOB,
  title: 'Senior Backend Engineer',
  status: 'ACTIVE',
  countryCode: 'kr',
  region: null,
  city: 'Seoul',
  workMode: 'HYBRID',
  remoteCountriesAllowed: [],
  employmentType: 'FULL_TIME',
  seniorityLevel: 'SENIOR',
  salaryMin: null,
  salaryMax: null,
  currency: null,
  payPeriod: null,
  skills: ['Go', 'Kubernetes'],
  languageCodes: ['en'],
  benefits: [],
  industries: [],
  description: 'Own the payments platform.',
  requirementsText: null,
  searchableUpdatedAt: new Date('2026-08-22T09:00:00.000Z'),
  company: { name: 'Acme' },
};

function build(
  over: {
    account?: Partial<typeof ACCOUNT_ROW>;
    job?: Partial<typeof JOB_ROW> | null;
    links?: unknown[];
    documents?: unknown[];
    intent?: ReturnType<typeof emptyJobIntent>;
  } = {},
) {
  const prisma = {
    candidateAccount: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ ...ACCOUNT_ROW, ...over.account }),
    },
    candidateLink: {
      findMany: jest.fn().mockResolvedValue(over.links ?? []),
    },
    document: {
      findMany: jest.fn().mockResolvedValue(over.documents ?? []),
    },
    externalJob: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          over.job === null ? null : { ...JOB_ROW, ...over.job },
        ),
    },
  } as unknown as PrismaService;

  const preferences = {
    requireAccountId: jest.fn().mockResolvedValue(ACCOUNT),
    resolveIntent: jest
      .fn()
      .mockResolvedValue(over.intent ?? emptyJobIntent(ACCOUNT)),
  } as unknown as CandidatePreferencesService;

  const fx = {
    current: jest.fn().mockResolvedValue({ table: null, snapshot: null }),
  } as unknown as FxRateService;

  return {
    service: new ExternalPremiumAiContextService(prisma, preferences, fx),
    prisma,
  };
}

describe('the candidate half — current data only (Rule N1)', () => {
  it('reads live rows, never a snapshot or an application copy', async () => {
    const { service, prisma } = build();
    await service.load('user-1', JOB);

    // Every candidate read is keyed by the CURRENT account id. There is no
    // join to applications and no snapshot table in this path at all.
    const linkQuery = (prisma.candidateLink.findMany as jest.Mock).mock
      .calls[0][0];
    expect(linkQuery.where).toEqual({
      candidateAccountId: ACCOUNT,
      status: 'COMPLETED',
    });
    const documentQuery = (prisma.document.findMany as jest.Mock).mock
      .calls[0][0];
    expect(documentQuery.where).toEqual({
      candidateAccountId: ACCOUNT,
      status: 'COMPLETED',
    });
  });

  it('carries professional facts and no contact details', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);

    expect(context.candidate.headline).toBe('Backend Engineer');
    expect(context.candidate.skills).toEqual(['Go', 'PostgreSQL']);
    expect(context.candidate.experience).toEqual([
      'Senior Engineer · Acme · 2021–',
    ]);
    // The shape has nowhere to put an email, phone or address — a field that
    // does not exist cannot leak.
    expect(Object.keys(context.candidate).sort()).toEqual([
      'education',
      'evidenceExcerpts',
      'experience',
      'headline',
      'languages',
      'locationLabel',
      'preferences',
      'skills',
      'summary',
    ]);
  });

  it('includes CURRENT link text and forgets deleted sources by construction', async () => {
    const { service } = build({
      links: [
        {
          title: 'Portfolio',
          sections: [{ name: 'a', heading: 'h', text: 'Built a Go service.' }],
          updatedAt: new Date('2026-08-21T00:00:00.000Z'),
        },
      ],
    });
    const context = await service.load('user-1', JOB);

    expect(context.candidate.evidenceExcerpts).toContain(
      'Portfolio: Built a Go service.',
    );
    // A deleted link has no row; nothing here could resurrect one, because
    // the only source of excerpts is the live query above.
  });

  it('states no preferences when the candidate stated none', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);
    // Empty means "not stated" — never a default the model could describe.
    expect(context.candidate.preferences).toEqual([]);
  });
});

describe('the job half', () => {
  it('is read by id with NO status filter, and keeps the real state', async () => {
    const { service, prisma } = build({ job: { status: 'CLOSED' } });
    const context = await service.load('user-1', JOB);

    expect(
      (prisma.externalJob.findUnique as jest.Mock).mock.calls[0][0].where,
    ).toEqual({ id: JOB });
    // A saved job that closed can still be asked about; it is never
    // relabelled as open.
    expect(context.job.status).toBe('CLOSED');
  });

  it('is a 404 for an id that is not an external job', async () => {
    const { service } = build({ job: null });
    await expect(service.load('user-1', JOB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renders unstated salary as null, never as zero or "not specified"', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);
    expect(context.job.salaryLabel).toBeNull();
  });

  it('never turns unstated remote geography into worldwide', async () => {
    const { service } = build({
      job: {
        workMode: 'REMOTE',
        remoteCountriesAllowed: [],
        city: null,
        countryCode: null,
      },
    });
    const context = await service.load('user-1', JOB);
    expect(context.job.locationLabel).toBeNull();
  });
});

describe('the deterministic facts', () => {
  it('computes skill overlap by intersection over stored values', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);

    expect(context.facts.matchedSkills).toEqual(['Go']);
    expect(context.facts.missingSkills).toEqual(['Kubernetes']);
  });

  it('supplies no score and no band for a single-job read', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);
    // An external score is a ranking position against a query and a universe.
    // This endpoint has neither, so there is no honest number to state.
    expect(context.facts.score).toBeNull();
    expect(context.facts.band).toBeNull();
  });

  it('omits dimensions the employer said nothing about', async () => {
    const { service } = build();
    const context = await service.load('user-1', JOB);
    // UNKNOWN alignments are dropped: the employer's silence is not a
    // finding about the candidate.
    for (const note of context.facts.alignmentNotes) {
      expect(note).not.toContain('UNKNOWN');
    }
  });
});

describe('the fingerprint — what invalidates and what must not', () => {
  const base = {
    candidateAccountId: ACCOUNT,
    evidenceRevision: 7,
    profileUpdatedAt: new Date('2026-08-20T10:00:00.000Z'),
    evidenceUpdatedAt: 1_700_000_000_000,
    intentHash: '{}',
    jobId: JOB,
    jobRevision: new Date('2026-08-22T09:00:00.000Z'),
    jobStatus: 'ACTIVE',
  };

  it('is stable for identical state', () => {
    const { service } = build();
    expect(service.fingerprintOf(base)).toBe(service.fingerprintOf(base));
  });

  it.each([
    ['evidenceRevision', { evidenceRevision: 8 }],
    [
      'profileUpdatedAt',
      { profileUpdatedAt: new Date('2026-08-24T00:00:00Z') },
    ],
    ['evidenceUpdatedAt', { evidenceUpdatedAt: 1_700_000_999_999 }],
    ['intentHash', { intentHash: '{"roles":["SRE"]}' }],
    ['jobRevision', { jobRevision: new Date('2026-08-23T00:00:00Z') }],
    ['jobStatus', { jobStatus: 'CLOSED' }],
  ])('changes when %s changes', (_label, patch) => {
    const { service } = build();
    expect(service.fingerprintOf({ ...base, ...patch })).not.toBe(
      service.fingerprintOf(base),
    );
  });

  it('does NOT depend on crawler metadata', async () => {
    /*
     * The load path selects `searchableUpdatedAt` — which moves only when a
     * search-relevant field actually changed — and never `lastSeenAt`,
     * `lastVerifiedAt`, `firstSeenAt` or the row's own `updatedAt`. A sweep
     * that re-observes an unchanged posting must not throw away every
     * explanation.
     */
    const { service, prisma } = build();
    await service.load('user-1', JOB);

    const select = (prisma.externalJob.findUnique as jest.Mock).mock.calls[0][0]
      .select;
    for (const crawlerField of [
      'lastSeenAt',
      'lastVerifiedAt',
      'firstSeenAt',
      'updatedAt',
      'searchIndexedAt',
    ]) {
      expect(select).not.toHaveProperty(crawlerField);
    }
    expect(select.searchableUpdatedAt).toBe(true);
  });

  it('separates candidates — same job, different people, different key', () => {
    const { service } = build();
    expect(
      service.fingerprintOf({ ...base, candidateAccountId: 'acct-2' }),
    ).not.toBe(service.fingerprintOf(base));
  });
});

import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalMatchBreakdownService } from './external-match-breakdown.service';
import { PremiumAiCacheService } from './premium-ai.cache';
import {
  AI_MATCH_BREAKDOWN_UNAVAILABLE,
  MATCH_BREAKDOWN_VERSION,
} from './external-premium-ai.policy';
import type { ExternalPremiumAiContextService } from './external-premium-ai.context';
import type { AiServiceClient } from '../../ai/ai-service.client';
import type { RedisService } from '../../redis/redis.service';
import type { PrismaService } from '../../prisma/prisma.service';

const JOB = '44444444-4444-4444-8444-444444444444';

function build(options: { fingerprint?: string; aiEnabled?: boolean } = {}) {
  const load = jest.fn().mockResolvedValue({
    candidateAccountId: 'acct-1',
    candidate: {
      headline: 'Backend Engineer',
      summary: null,
      locationLabel: null,
      skills: ['Go', 'PostgreSQL'],
      languages: [],
      experience: [],
      education: [],
      preferences: [],
      evidenceExcerpts: [],
    },
    job: {
      jobId: JOB,
      title: 'Senior Backend Engineer',
      company: 'Acme',
      status: 'ACTIVE',
      locationLabel: 'Seoul, KR',
      workMode: 'HYBRID',
      employmentType: 'FULL_TIME',
      seniorityLevel: 'SENIOR',
      salaryLabel: null,
      skills: ['Go', 'Kubernetes'],
      languages: [],
      benefits: [],
      description: 'Build services.',
      requirementsText: null,
    },
    facts: {
      score: null,
      band: null,
      matchedSkills: ['Go'],
      missingSkills: ['Kubernetes'],
      alignmentNotes: [],
    },
    alignments: [
      { dimension: 'seniority', state: 'MATCH', reason: 'SENIORITY_MATCH' },
      { dimension: 'salary', state: 'UNKNOWN', reason: 'SALARY_UNKNOWN' },
    ],
    fingerprint: options.fingerprint ?? 'fp-1',
  });
  const context = { load } as unknown as ExternalPremiumAiContextService;

  const externalMatchBreakdown = jest.fn().mockResolvedValue({
    jobId: JOB,
    locale: 'en',
    summary: 'A grounded overview of how this job relates to your profile.',
    explanations: [
      { key: 'skills', explanation: 'Go matches; Kubernetes is not shown.' },
      { key: 'seniority', explanation: 'The stated level matches yours.' },
    ],
  });
  const ai = {
    enabled: options.aiEnabled ?? true,
    externalMatchBreakdown,
  } as unknown as AiServiceClient;

  const store = new Map<string, string>();
  const get = jest.fn((key: string) => Promise.resolve(store.get(key) ?? null));
  const set = jest.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve('OK');
  });
  const redis = { client: { get, set } } as unknown as RedisService;
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ preferredLocale: 'uz' }),
    },
  } as unknown as PrismaService;

  return {
    service: new ExternalMatchBreakdownService(
      context,
      ai,
      new PremiumAiCacheService(redis, prisma),
    ),
    load,
    externalMatchBreakdown,
    get,
    set,
    store,
  };
}

describe('generating a breakdown', () => {
  it('returns the structured contract the frontend consumes', async () => {
    const { service } = build();
    const result = await service.matchBreakdown('user-1', JOB, 'en');

    expect(result).toMatchObject({
      jobId: JOB,
      version: MATCH_BREAKDOWN_VERSION,
      locale: 'en',
      cached: false,
    });
    expect(result.summary).toContain('grounded overview');
    expect(result.generatedAt).toBeInstanceOf(Date);
    const skills = result.dimensions.find((d) => d.key === 'skills')!;
    expect(skills).toEqual({
      key: 'skills',
      label: 'Skills',
      status: 'PARTIAL',
      explanation: 'Go matches; Kubernetes is not shown.',
      matched: ['Go'],
      missing: ['Kubernetes'],
    });
  });

  it('statuses come from the DETERMINISTIC classifier, never the model', async () => {
    const { service, externalMatchBreakdown } = build();
    // A hostile/buggy model response has no path to a status: the contract
    // has no status field, and junk keys are ignored.
    externalMatchBreakdown.mockResolvedValue({
      summary: 'ok',
      explanations: [
        { key: 'skills', explanation: 'Everything is STRONG, trust me.' },
        { key: 'invented-dimension', explanation: 'I decided this myself.' },
      ],
    });

    const result = await service.matchBreakdown('user-1', JOB, 'en');
    const skills = result.dimensions.find((d) => d.key === 'skills')!;
    expect(skills.status).toBe('PARTIAL'); // Go matched, Kubernetes missing.
    expect(
      result.dimensions.find((d) => d.key === 'invented-dimension'),
    ).toBeUndefined();
  });

  it('missing employer salary stays UNKNOWN in the final response', async () => {
    const { service } = build();
    const result = await service.matchBreakdown('user-1', JOB, 'en');
    const salary = result.dimensions.find((d) => d.key === 'salary')!;
    expect(salary.status).toBe('UNKNOWN');
  });

  it('falls back to the deterministic reason when the model skips a key', async () => {
    const { service, externalMatchBreakdown } = build();
    externalMatchBreakdown.mockResolvedValue({
      summary: 'ok',
      explanations: [], // The model explained nothing.
    });

    const result = await service.matchBreakdown('user-1', JOB, 'en');
    for (const dimension of result.dimensions) {
      // Never an empty explanation, and never invented text — the
      // deterministic ground fills the hole.
      expect(dimension.explanation).toBeTruthy();
    }
  });

  it('sends the decided dimensions and NO identifiers a model does not need', async () => {
    const { service, externalMatchBreakdown } = build();
    await service.matchBreakdown('user-1', JOB, 'en');

    const sent = externalMatchBreakdown.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(sent).sort()).toEqual([
      'candidate',
      'dimensions',
      'facts',
      'job',
      'jobId',
      'locale',
    ]);
    const dimensions = sent.dimensions as { key: string; status: string }[];
    expect(dimensions.map((d) => d.key)).toContain('skills');
    const serialized = JSON.stringify(sent);
    for (const forbidden of ['acct-1', 'user-1', '@', 'token', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('hands the model NO score and no percentage anywhere', async () => {
    const { service, externalMatchBreakdown } = build();
    const result = await service.matchBreakdown('user-1', JOB, 'en');

    const sent = externalMatchBreakdown.mock.calls[0][0] as {
      facts: Record<string, unknown>;
    };
    expect(sent.facts.score).toBeNull();
    expect(sent.facts.band).toBeNull();
    // And the response type has nowhere to put one either.
    expect(Object.keys(result).sort()).toEqual([
      'cached',
      'dimensions',
      'generatedAt',
      'jobId',
      'locale',
      'summary',
      'version',
    ]);
  });
});

describe('the cache', () => {
  it('serves a repeat without calling the model at all', async () => {
    const { service, externalMatchBreakdown } = build();
    const first = await service.matchBreakdown('user-1', JOB, 'en');
    const second = await service.matchBreakdown('user-1', JOB, 'en');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.dimensions).toEqual(first.dimensions);
    expect(externalMatchBreakdown).toHaveBeenCalledTimes(1);
  });

  it('keys on its OWN version namespace, locale and fingerprint', async () => {
    const { service, set } = build();
    await service.matchBreakdown('user-1', JOB, 'en');

    const key = set.mock.calls[0][0];
    expect(key).toContain(MATCH_BREAKDOWN_VERSION);
    expect(key).toContain(':en:');
    expect(key).toContain('fp-1');
    for (const other of ['why-match', 'cover-letter', 'interview-prep']) {
      expect(key).not.toContain(other);
    }
  });

  it('regenerates when the fingerprint changes (Rule N1)', async () => {
    const { service, externalMatchBreakdown, load } = build();
    await service.matchBreakdown('user-1', JOB, 'en');

    load.mockResolvedValue({
      ...(await load.mock.results[0].value),
      fingerprint: 'fp-2',
    });
    const after = await service.matchBreakdown('user-1', JOB, 'en');

    expect(after.cached).toBe(false);
    expect(externalMatchBreakdown).toHaveBeenCalledTimes(2);
  });

  it('separates locales', async () => {
    const { service, externalMatchBreakdown } = build();
    await service.matchBreakdown('user-1', JOB, 'en');
    const korean = await service.matchBreakdown('user-1', JOB, 'ko');

    expect(korean.cached).toBe(false);
    expect(externalMatchBreakdown).toHaveBeenCalledTimes(2);
  });

  it("falls back to the account's own language when none is requested", async () => {
    const { service, externalMatchBreakdown } = build();
    const result = await service.matchBreakdown('user-1', JOB, undefined);

    expect(result.locale).toBe('uz');
    expect(externalMatchBreakdown.mock.calls[0][0]).toMatchObject({
      locale: 'uz',
    });
  });

  it('degrades to a generation when Redis is unavailable', async () => {
    const { service, get, externalMatchBreakdown } = build();
    get.mockRejectedValue(new Error('redis down'));

    const result = await service.matchBreakdown('user-1', JOB, 'en');
    expect(result.summary).toBeTruthy();
    expect(externalMatchBreakdown).toHaveBeenCalledTimes(1);
  });

  it('treats a cache entry with an invalid status as a miss', async () => {
    const { service, store, externalMatchBreakdown } = build();
    await service.matchBreakdown('user-1', JOB, 'en');
    // Corrupt the stored entry: an unknown status must not be served back.
    const key = [...store.keys()][0];
    const parsed = JSON.parse(store.get(key)!) as {
      dimensions: { status: string }[];
    };
    parsed.dimensions[0].status = 'AMAZING';
    store.set(key, JSON.stringify(parsed));

    const after = await service.matchBreakdown('user-1', JOB, 'en');
    expect(after.cached).toBe(false);
    expect(externalMatchBreakdown).toHaveBeenCalledTimes(2);
  });
});

describe('failure is contained and honest', () => {
  it('answers a provider failure with the stable unavailable code', async () => {
    const { service, externalMatchBreakdown } = build();
    externalMatchBreakdown.mockRejectedValue(
      new Error('gemini 429: quota exceeded for project acme-1234'),
    );

    const failure = service.matchBreakdown('user-1', JOB, 'en');
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await failure.catch((error: ServiceUnavailableException) => {
      const body = error.getResponse() as Record<string, unknown>;
      expect(body.code).toBe(AI_MATCH_BREAKDOWN_UNAVAILABLE);
      expect(JSON.stringify(body)).not.toContain('quota');
      expect(JSON.stringify(body)).not.toContain('acme-1234');
    });
  });

  it('treats an empty summary as a failure, and caches nothing', async () => {
    const { service, externalMatchBreakdown, set } = build();
    externalMatchBreakdown.mockResolvedValue({
      summary: '  ',
      explanations: [],
    });

    await expect(
      service.matchBreakdown('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses cleanly when no AI provider is configured', async () => {
    const { service, externalMatchBreakdown } = build({ aiEnabled: false });
    await expect(
      service.matchBreakdown('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(externalMatchBreakdown).not.toHaveBeenCalled();
  });

  it('still serves a CACHED breakdown while the provider is down', async () => {
    const { service, externalMatchBreakdown } = build();
    await service.matchBreakdown('user-1', JOB, 'en');
    externalMatchBreakdown.mockRejectedValue(new Error('provider down'));

    const cached = await service.matchBreakdown('user-1', JOB, 'en');
    expect(cached.cached).toBe(true);
  });
});

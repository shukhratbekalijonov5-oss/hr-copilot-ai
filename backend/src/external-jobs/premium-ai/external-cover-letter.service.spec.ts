import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalCoverLetterService } from './external-cover-letter.service';
import { PremiumAiCacheService } from './premium-ai.cache';
import {
  AI_COVER_LETTER_UNAVAILABLE,
  COVER_LETTER_VERSION,
  MAX_COVER_LETTER_CHARS,
} from './external-premium-ai.policy';
import type { ExternalPremiumAiContextService } from './external-premium-ai.context';
import type { AiServiceClient } from '../../ai/ai-service.client';
import type { RedisService } from '../../redis/redis.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The orchestration around the model: cache identity, bounds, emptiness-as-
 * failure, and containment. The model is always a fake — what is under test
 * is the contract this service enforces around it.
 */

const JOB = '22222222-2222-4222-8222-222222222222';

function build(options: { fingerprint?: string; aiEnabled?: boolean } = {}) {
  const load = jest.fn().mockResolvedValue({
    candidateAccountId: 'acct-1',
    candidate: { headline: 'Backend Engineer', skills: ['Go'] },
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
      skills: ['Go'],
      languages: [],
      benefits: [],
      description: 'Build services.',
      requirementsText: null,
    },
    facts: {
      score: null,
      band: null,
      matchedSkills: ['Go'],
      missingSkills: [],
      alignmentNotes: [],
    },
    fingerprint: options.fingerprint ?? 'fp-1',
  });
  const context = { load } as unknown as ExternalPremiumAiContextService;

  const externalCoverLetter = jest.fn().mockResolvedValue({
    jobId: JOB,
    locale: 'en',
    subject: 'Application for Senior Backend Engineer',
    content: 'Dear Hiring Team, I am writing to apply...',
  });
  const ai = {
    enabled: options.aiEnabled ?? true,
    externalCoverLetter,
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
      findUnique: jest.fn().mockResolvedValue({ preferredLocale: 'ko' }),
    },
  } as unknown as PrismaService;

  return {
    service: new ExternalCoverLetterService(
      context,
      ai,
      new PremiumAiCacheService(redis, prisma),
    ),
    load,
    externalCoverLetter,
    get,
    set,
    store,
  };
}

describe('generating a cover letter', () => {
  it('returns the structured contract the frontend consumes', async () => {
    const { service } = build();
    const result = await service.coverLetter('user-1', JOB, 'en');

    expect(result).toMatchObject({
      jobId: JOB,
      version: COVER_LETTER_VERSION,
      locale: 'en',
      subject: 'Application for Senior Backend Engineer',
      content: 'Dear Hiring Team, I am writing to apply...',
      cached: false,
    });
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('sends the grounded context and NO identifiers a model does not need', async () => {
    const { service, externalCoverLetter } = build();
    await service.coverLetter('user-1', JOB, 'en');

    const sent = externalCoverLetter.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(sent).sort()).toEqual([
      'candidate',
      'facts',
      'job',
      'jobId',
      'locale',
    ]);
    const serialized = JSON.stringify(sent);
    for (const forbidden of ['acct-1', 'user-1', '@', 'token', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('hands the model NO score — the deterministic pipeline owns numbers', async () => {
    const { service, externalCoverLetter } = build();
    await service.coverLetter('user-1', JOB, 'en');

    const facts = (
      externalCoverLetter.mock.calls[0][0] as {
        facts: Record<string, unknown>;
      }
    ).facts;
    expect(facts.score).toBeNull();
    expect(facts.band).toBeNull();
  });

  it('clamps a runaway letter instead of shipping pages downstream', async () => {
    const { service, externalCoverLetter } = build();
    externalCoverLetter.mockResolvedValue({
      subject: 'S'.repeat(1000),
      content: 'C'.repeat(100_000),
    });

    const result = await service.coverLetter('user-1', JOB, 'en');
    expect(result.subject.length).toBeLessThanOrEqual(200);
    expect(result.content.length).toBeLessThanOrEqual(MAX_COVER_LETTER_CHARS);
  });
});

describe('the cache', () => {
  it('serves a repeat without calling the model at all', async () => {
    const { service, externalCoverLetter } = build();
    const first = await service.coverLetter('user-1', JOB, 'en');
    const second = await service.coverLetter('user-1', JOB, 'en');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.content).toBe(first.content);
    expect(second.generatedAt).toEqual(first.generatedAt);
    expect(externalCoverLetter).toHaveBeenCalledTimes(1);
  });

  it('keys on its OWN version namespace, locale and fingerprint', async () => {
    const { service, set } = build();
    await service.coverLetter('user-1', JOB, 'en');

    const key = set.mock.calls[0][0];
    expect(key).toContain(COVER_LETTER_VERSION);
    expect(key).toContain(':en:');
    expect(key).toContain('fp-1');
    // Never collides with why-match's entries for the same context.
    expect(key).not.toContain('why-match');
  });

  it('regenerates when the candidate or job fingerprint changes (Rule N1)', async () => {
    const { service, externalCoverLetter, load } = build();
    await service.coverLetter('user-1', JOB, 'en');

    load.mockResolvedValue({
      ...(await load.mock.results[0].value),
      fingerprint: 'fp-2',
    });
    const after = await service.coverLetter('user-1', JOB, 'en');

    expect(after.cached).toBe(false);
    expect(externalCoverLetter).toHaveBeenCalledTimes(2);
  });

  it('separates locales — one letter per language', async () => {
    const { service, externalCoverLetter } = build();
    await service.coverLetter('user-1', JOB, 'en');
    const korean = await service.coverLetter('user-1', JOB, 'ko');

    expect(korean.cached).toBe(false);
    expect(externalCoverLetter).toHaveBeenCalledTimes(2);
    expect(externalCoverLetter.mock.calls[1][0]).toMatchObject({
      locale: 'ko',
    });
  });

  it("falls back to the account's own language when none is requested", async () => {
    const { service, externalCoverLetter } = build();
    const result = await service.coverLetter('user-1', JOB, undefined);

    expect(result.locale).toBe('ko');
    expect(externalCoverLetter.mock.calls[0][0]).toMatchObject({
      locale: 'ko',
    });
  });

  it('degrades to a generation when Redis is unavailable', async () => {
    const { service, get, externalCoverLetter } = build();
    get.mockRejectedValue(new Error('redis down'));

    const result = await service.coverLetter('user-1', JOB, 'en');
    expect(result.content).toBeTruthy();
    expect(externalCoverLetter).toHaveBeenCalledTimes(1);
  });
});

describe('failure is contained and honest', () => {
  it('answers a provider failure with the stable unavailable code', async () => {
    const { service, externalCoverLetter } = build();
    externalCoverLetter.mockRejectedValue(
      new Error('gemini 429: quota exceeded for project acme-1234'),
    );

    const failure = service.coverLetter('user-1', JOB, 'en');
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await failure.catch((error: ServiceUnavailableException) => {
      const body = error.getResponse() as Record<string, unknown>;
      expect(body.code).toBe(AI_COVER_LETTER_UNAVAILABLE);
      expect(JSON.stringify(body)).not.toContain('quota');
      expect(JSON.stringify(body)).not.toContain('acme-1234');
    });
  });

  it('treats an empty draft as a failure, and caches nothing', async () => {
    const { service, externalCoverLetter, set } = build();
    externalCoverLetter.mockResolvedValue({ subject: '  ', content: '' });

    await expect(
      service.coverLetter('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses cleanly when no AI provider is configured', async () => {
    const { service, externalCoverLetter } = build({ aiEnabled: false });
    await expect(
      service.coverLetter('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(externalCoverLetter).not.toHaveBeenCalled();
  });

  it('still serves a CACHED letter while the provider is down', async () => {
    const { service, externalCoverLetter } = build();
    await service.coverLetter('user-1', JOB, 'en');
    externalCoverLetter.mockRejectedValue(new Error('provider down'));

    const cached = await service.coverLetter('user-1', JOB, 'en');
    expect(cached.cached).toBe(true);
  });
});

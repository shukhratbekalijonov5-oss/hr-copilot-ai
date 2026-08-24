import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalWhyMatchService } from './external-why-match.service';
import {
  AI_EXPLANATION_UNAVAILABLE,
  WHY_MATCH_VERSION,
} from './external-premium-ai.policy';
import type { ExternalPremiumAiContextService } from './external-premium-ai.context';
import type { AiServiceClient } from '../../ai/ai-service.client';
import type { RedisService } from '../../redis/redis.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * The orchestration around the model: cache identity, bounds, and what
 * happens when generation fails.
 *
 * The model itself is always a fake here. What is under test is the contract
 * this service enforces around it — including the rule that a cache hit costs
 * no generation at all, which is what keeps this feature affordable.
 */

const JOB = '11111111-1111-4111-8111-111111111111';

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

  const externalWhyMatch = jest.fn().mockResolvedValue({
    jobId: JOB,
    locale: 'en',
    summary: 'This role lines up with your Go experience.',
    strengths: [{ title: 'Go', explanation: 'You have shipped Go services.' }],
    gaps: [],
  });
  const ai = {
    enabled: options.aiEnabled ?? true,
    externalWhyMatch,
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
    service: new ExternalWhyMatchService(context, ai, redis, prisma),
    load,
    externalWhyMatch,
    get,
    set,
    store,
  };
}

describe('generating an explanation', () => {
  it('returns the structured contract the frontend consumes', async () => {
    const { service } = build();
    const result = await service.whyMatch('user-1', JOB, 'en');

    expect(result).toMatchObject({
      jobId: JOB,
      version: WHY_MATCH_VERSION,
      locale: 'en',
      summary: 'This role lines up with your Go experience.',
      cached: false,
    });
    expect(result.strengths).toEqual([
      { title: 'Go', explanation: 'You have shipped Go services.' },
    ]);
    expect(result.gaps).toEqual([]);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('sends the grounded context and NO identifiers a model does not need', async () => {
    const { service, externalWhyMatch } = build();
    await service.whyMatch('user-1', JOB, 'en');

    const sent = externalWhyMatch.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      'candidate',
      'facts',
      'job',
      'jobId',
      'locale',
    ]);
    // No account id, user id, email, document id or token travels with it.
    const serialized = JSON.stringify(sent);
    for (const forbidden of ['acct-1', 'user-1', '@', 'token', 'password']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('hands the model NO score to disagree with', async () => {
    const { service, externalWhyMatch } = build();
    await service.whyMatch('user-1', JOB, 'en');

    const facts = (
      externalWhyMatch.mock.calls[0][0] as { facts: Record<string, unknown> }
    ).facts;
    // The deterministic pipeline owns the number. A single-job read has no
    // query and no universe, so there is no honest score to state — and the
    // model is given none to contradict.
    expect(facts.score).toBeNull();
    expect(facts.band).toBeNull();
  });

  it('clamps strengths and gaps even if the AI service did not', async () => {
    const { service, externalWhyMatch } = build();
    externalWhyMatch.mockResolvedValue({
      summary: 'ok',
      strengths: Array.from({ length: 9 }, (_, i) => ({
        title: `T${i}`,
        explanation: 'e',
      })),
      gaps: Array.from({ length: 5 }, (_, i) => ({
        title: `G${i}`,
        explanation: 'e',
      })),
    });

    const result = await service.whyMatch('user-1', JOB, 'en');
    expect(result.strengths).toHaveLength(4);
    expect(result.gaps).toHaveLength(2);
  });

  it('drops half-empty items rather than rendering a blank bullet', async () => {
    const { service, externalWhyMatch } = build();
    externalWhyMatch.mockResolvedValue({
      summary: 'ok',
      strengths: [
        { title: '', explanation: 'no title' },
        { title: 'no explanation', explanation: '  ' },
        { title: 'Real', explanation: 'Grounded.' },
      ],
      gaps: [],
    });

    const result = await service.whyMatch('user-1', JOB, 'en');
    expect(result.strengths).toEqual([
      { title: 'Real', explanation: 'Grounded.' },
    ]);
  });
});

describe('the cache', () => {
  it('serves a repeat without calling the model at all', async () => {
    const { service, externalWhyMatch } = build();
    const first = await service.whyMatch('user-1', JOB, 'en');
    const second = await service.whyMatch('user-1', JOB, 'en');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.summary).toBe(first.summary);
    // The whole point: one generation, however many reads.
    expect(externalWhyMatch).toHaveBeenCalledTimes(1);
  });

  it('keys on the version and locale, so neither can collide', async () => {
    const { service, set } = build();
    await service.whyMatch('user-1', JOB, 'en');

    const key = set.mock.calls[0][0];
    expect(key).toContain(WHY_MATCH_VERSION);
    expect(key).toContain(':en:');
    expect(key).toContain('fp-1');
  });

  it('regenerates when the candidate fingerprint changes (Rule N1)', async () => {
    const { service, externalWhyMatch, load } = build();
    await service.whyMatch('user-1', JOB, 'en');

    // The candidate edited their profile / deleted a link: the context
    // service returns a different fingerprint, so the old entry is not even
    // looked up — it is unreachable, not merely stale.
    load.mockResolvedValue({
      ...(await load.mock.results[0].value),
      fingerprint: 'fp-2',
    });
    const after = await service.whyMatch('user-1', JOB, 'en');

    expect(after.cached).toBe(false);
    expect(externalWhyMatch).toHaveBeenCalledTimes(2);
  });

  it('separates locales — a Korean answer never satisfies an English ask', async () => {
    const { service, externalWhyMatch } = build();
    await service.whyMatch('user-1', JOB, 'en');
    const korean = await service.whyMatch('user-1', JOB, 'ko');

    expect(korean.cached).toBe(false);
    expect(externalWhyMatch).toHaveBeenCalledTimes(2);
    expect(externalWhyMatch.mock.calls[1][0]).toMatchObject({ locale: 'ko' });
  });

  it("falls back to the account's own language when none is requested", async () => {
    const { service, externalWhyMatch } = build();
    const result = await service.whyMatch('user-1', JOB, undefined);

    expect(result.locale).toBe('ko');
    expect(externalWhyMatch.mock.calls[0][0]).toMatchObject({ locale: 'ko' });
  });

  it('degrades to a generation when Redis is unavailable', async () => {
    const { service, get, externalWhyMatch } = build();
    get.mockRejectedValue(new Error('redis down'));

    const result = await service.whyMatch('user-1', JOB, 'en');
    // A cache outage costs a re-generation, never the answer and never a
    // stale one.
    expect(result.summary).toBeTruthy();
    expect(externalWhyMatch).toHaveBeenCalledTimes(1);
  });
});

describe('failure is contained and honest', () => {
  it('answers a provider failure with the stable unavailable code', async () => {
    const { service, externalWhyMatch } = build();
    externalWhyMatch.mockRejectedValue(
      new Error('gemini 429: quota exceeded for project acme-1234'),
    );

    const failure = service.whyMatch('user-1', JOB, 'en');
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await failure.catch((error: ServiceUnavailableException) => {
      const body = error.getResponse() as Record<string, unknown>;
      expect(body.code).toBe(AI_EXPLANATION_UNAVAILABLE);
      // The provider's own words never reach a reader: quota, project ids
      // and model names are operational detail about a third party.
      expect(JSON.stringify(body)).not.toContain('quota');
      expect(JSON.stringify(body)).not.toContain('acme-1234');
    });
  });

  it('treats an empty summary as a failure, and caches nothing', async () => {
    const { service, externalWhyMatch, set } = build();
    externalWhyMatch.mockResolvedValue({
      summary: '   ',
      strengths: [],
      gaps: [],
    });

    await expect(service.whyMatch('user-1', JOB, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Caching emptiness would make one bad generation permanent.
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses cleanly when no AI provider is configured', async () => {
    const { service, externalWhyMatch } = build({ aiEnabled: false });
    await expect(service.whyMatch('user-1', JOB, 'en')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(externalWhyMatch).not.toHaveBeenCalled();
  });

  it('still serves a CACHED answer while the provider is down', async () => {
    const { service, externalWhyMatch } = build();
    await service.whyMatch('user-1', JOB, 'en');
    externalWhyMatch.mockRejectedValue(new Error('provider down'));

    const cached = await service.whyMatch('user-1', JOB, 'en');
    expect(cached.cached).toBe(true);
  });
});

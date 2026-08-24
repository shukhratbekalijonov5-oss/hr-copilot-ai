import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalInterviewPrepService } from './external-interview-prep.service';
import { PremiumAiCacheService } from './premium-ai.cache';
import {
  AI_INTERVIEW_PREP_UNAVAILABLE,
  INTERVIEW_PREP_VERSION,
  MAX_FOCUS_AREAS,
  MAX_INTERVIEW_QUESTIONS,
} from './external-premium-ai.policy';
import type { ExternalPremiumAiContextService } from './external-premium-ai.context';
import type { AiServiceClient } from '../../ai/ai-service.client';
import type { RedisService } from '../../redis/redis.service';
import type { PrismaService } from '../../prisma/prisma.service';

const JOB = '33333333-3333-4333-8333-333333333333';

const QUESTION = {
  question: 'How have you used Go in production?',
  whyAsked: 'The posting lists Go as required.',
  preparation: 'Walk through your payment-services work.',
};
const FOCUS = {
  title: 'Kubernetes gap',
  guidance: 'Be ready to state your real current level honestly.',
};

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
    fingerprint: options.fingerprint ?? 'fp-1',
  });
  const context = { load } as unknown as ExternalPremiumAiContextService;

  const externalInterviewPrep = jest.fn().mockResolvedValue({
    jobId: JOB,
    locale: 'en',
    questions: [QUESTION],
    focusAreas: [FOCUS],
  });
  const ai = {
    enabled: options.aiEnabled ?? true,
    externalInterviewPrep,
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
      findUnique: jest.fn().mockResolvedValue({ preferredLocale: 'ru' }),
    },
  } as unknown as PrismaService;

  return {
    service: new ExternalInterviewPrepService(
      context,
      ai,
      new PremiumAiCacheService(redis, prisma),
    ),
    load,
    externalInterviewPrep,
    get,
    set,
    store,
  };
}

describe('generating interview preparation', () => {
  it('returns the structured contract the frontend consumes', async () => {
    const { service } = build();
    const result = await service.interviewPrep('user-1', JOB, 'en');

    expect(result).toMatchObject({
      jobId: JOB,
      version: INTERVIEW_PREP_VERSION,
      locale: 'en',
      cached: false,
    });
    expect(result.questions).toEqual([QUESTION]);
    expect(result.focusAreas).toEqual([FOCUS]);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it('sends the grounded context and NO identifiers a model does not need', async () => {
    const { service, externalInterviewPrep } = build();
    await service.interviewPrep('user-1', JOB, 'en');

    const sent = externalInterviewPrep.mock.calls[0][0] as Record<
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

  it('hands the model NO score to invent a probability from', async () => {
    const { service, externalInterviewPrep } = build();
    await service.interviewPrep('user-1', JOB, 'en');

    const facts = (
      externalInterviewPrep.mock.calls[0][0] as {
        facts: Record<string, unknown>;
      }
    ).facts;
    expect(facts.score).toBeNull();
    expect(facts.band).toBeNull();
  });

  it('clamps questions at 8 and focus areas at 4', async () => {
    const { service, externalInterviewPrep } = build();
    externalInterviewPrep.mockResolvedValue({
      questions: Array.from({ length: 20 }, (_, i) => ({
        ...QUESTION,
        question: `Q${i}?`,
      })),
      focusAreas: Array.from({ length: 9 }, (_, i) => ({
        ...FOCUS,
        title: `T${i}`,
      })),
    });

    const result = await service.interviewPrep('user-1', JOB, 'en');
    expect(result.questions).toHaveLength(MAX_INTERVIEW_QUESTIONS);
    expect(result.focusAreas).toHaveLength(MAX_FOCUS_AREAS);
  });

  it('drops malformed items rather than rendering half-empty cards', async () => {
    const { service, externalInterviewPrep } = build();
    externalInterviewPrep.mockResolvedValue({
      questions: [
        { ...QUESTION, question: '  ' },
        { ...QUESTION, whyAsked: '' },
        { ...QUESTION, preparation: undefined },
        QUESTION,
      ],
      focusAreas: [{ title: 'No guidance', guidance: ' ' }, FOCUS],
    });

    const result = await service.interviewPrep('user-1', JOB, 'en');
    expect(result.questions).toEqual([QUESTION]);
    expect(result.focusAreas).toEqual([FOCUS]);
  });

  it('keeps a sparse honest answer sparse — 3 questions stay 3', async () => {
    const { service, externalInterviewPrep } = build();
    externalInterviewPrep.mockResolvedValue({
      questions: Array.from({ length: 3 }, (_, i) => ({
        ...QUESTION,
        question: `Q${i}?`,
      })),
      focusAreas: [],
    });

    const result = await service.interviewPrep('user-1', JOB, 'en');
    // Never padded up to 5: an invented question is a fabrication.
    expect(result.questions).toHaveLength(3);
    expect(result.focusAreas).toEqual([]);
  });
});

describe('the cache', () => {
  it('serves a repeat without calling the model at all', async () => {
    const { service, externalInterviewPrep } = build();
    const first = await service.interviewPrep('user-1', JOB, 'en');
    const second = await service.interviewPrep('user-1', JOB, 'en');

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.questions).toEqual(first.questions);
    expect(externalInterviewPrep).toHaveBeenCalledTimes(1);
  });

  it('keys on its OWN version namespace, locale and fingerprint', async () => {
    const { service, set } = build();
    await service.interviewPrep('user-1', JOB, 'en');

    const key = set.mock.calls[0][0];
    expect(key).toContain(INTERVIEW_PREP_VERSION);
    expect(key).toContain(':en:');
    expect(key).toContain('fp-1');
    expect(key).not.toContain('cover-letter');
    expect(key).not.toContain('why-match');
  });

  it('regenerates when the fingerprint changes (Rule N1)', async () => {
    const { service, externalInterviewPrep, load } = build();
    await service.interviewPrep('user-1', JOB, 'en');

    load.mockResolvedValue({
      ...(await load.mock.results[0].value),
      fingerprint: 'fp-2',
    });
    const after = await service.interviewPrep('user-1', JOB, 'en');

    expect(after.cached).toBe(false);
    expect(externalInterviewPrep).toHaveBeenCalledTimes(2);
  });

  it('separates locales', async () => {
    const { service, externalInterviewPrep } = build();
    await service.interviewPrep('user-1', JOB, 'en');
    const uzbek = await service.interviewPrep('user-1', JOB, 'uz');

    expect(uzbek.cached).toBe(false);
    expect(externalInterviewPrep).toHaveBeenCalledTimes(2);
    expect(externalInterviewPrep.mock.calls[1][0]).toMatchObject({
      locale: 'uz',
    });
  });

  it("falls back to the account's own language when none is requested", async () => {
    const { service, externalInterviewPrep } = build();
    const result = await service.interviewPrep('user-1', JOB, undefined);

    expect(result.locale).toBe('ru');
    expect(externalInterviewPrep.mock.calls[0][0]).toMatchObject({
      locale: 'ru',
    });
  });

  it('degrades to a generation when Redis is unavailable', async () => {
    const { service, get, externalInterviewPrep } = build();
    get.mockRejectedValue(new Error('redis down'));

    const result = await service.interviewPrep('user-1', JOB, 'en');
    expect(result.questions.length).toBeGreaterThan(0);
    expect(externalInterviewPrep).toHaveBeenCalledTimes(1);
  });
});

describe('failure is contained and honest', () => {
  it('answers a provider failure with the stable unavailable code', async () => {
    const { service, externalInterviewPrep } = build();
    externalInterviewPrep.mockRejectedValue(
      new Error('gemini 500: internal error at us-central1'),
    );

    const failure = service.interviewPrep('user-1', JOB, 'en');
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await failure.catch((error: ServiceUnavailableException) => {
      const body = error.getResponse() as Record<string, unknown>;
      expect(body.code).toBe(AI_INTERVIEW_PREP_UNAVAILABLE);
      expect(JSON.stringify(body)).not.toContain('us-central1');
    });
  });

  it('treats zero usable questions as a failure, and caches nothing', async () => {
    const { service, externalInterviewPrep, set } = build();
    externalInterviewPrep.mockResolvedValue({
      questions: [{ question: ' ', whyAsked: '', preparation: '' }],
      focusAreas: [FOCUS],
    });

    await expect(
      service.interviewPrep('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses cleanly when no AI provider is configured', async () => {
    const { service, externalInterviewPrep } = build({ aiEnabled: false });
    await expect(
      service.interviewPrep('user-1', JOB, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(externalInterviewPrep).not.toHaveBeenCalled();
  });

  it('still serves a CACHED preparation while the provider is down', async () => {
    const { service, externalInterviewPrep } = build();
    await service.interviewPrep('user-1', JOB, 'en');
    externalInterviewPrep.mockRejectedValue(new Error('provider down'));

    const cached = await service.interviewPrep('user-1', JOB, 'en');
    expect(cached.cached).toBe(true);
  });
});

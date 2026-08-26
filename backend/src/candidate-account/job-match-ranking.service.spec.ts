import { JobMatchRankingService } from './job-match-ranking.service';
import { buildProfileFacts } from '../matching/advanced/profile-facts';
import { emptyJobIntent } from '../candidate-preferences/candidate-job-intent';
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import { MATCH_ALGORITHM_VERSION } from '../matching/match-policy';
import { Prisma } from '../generated/prisma/client';

/**
 * The ranked snapshot: what decides the universe, what may shrink it, when it
 * recomputes, and how a page relates to the whole.
 *
 * The failure this guards against is specific and was real: a candidate with
 * 153 open vacancies available to them received about two matches, because a
 * top-K vector search decided the universe and a `limit` truncated it before
 * anything was ranked. So the properties asserted here are mostly about
 * COUNTS and STABILITY rather than about any single match being right — and,
 * since algorithm v2, about the one rule that shrinks a universe: the
 * candidate's own explicit exclusions, never a score.
 */

const ACCOUNT = 'acct-me';

/** One OPEN vacancy row exactly as RANKING_VACANCY_SELECT returns it. */
function vacRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `vac-${index}`,
    title: `Role ${index}`,
    description: null,
    country: null,
    region: null,
    city: null,
    workMode: null,
    remoteCountriesAllowed: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    employmentType: null,
    seniorityLevel: null,
    benefits: [],
    domainExperience: [],
    languages: [],
    organization: { name: `Org ${index}` },
    requirements: [],
    ...overrides,
  };
}

const CATALOGUE = Array.from({ length: 57 }, (_, i) => vacRow(i));

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    vacancy: {
      findMany: jest.fn().mockResolvedValue(CATALOGUE),
    },
    candidateJobMatchRun: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    candidateJobMatchEntry: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  prisma.$transaction = jest.fn((arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg)
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  return prisma;
}

function aiMatch(index: number, overrides: Record<string, unknown> = {}) {
  return {
    vacancyId: `vac-${index}`,
    organizationId: 'org-1',
    title: `Role ${index}`,
    match: index < 10 ? 'STRONG' : 'PARTIAL',
    score: Math.max(0, 100 - index),
    rank: index + 1,
    signals: { semantic: 0.5 },
    matchedSkills: ['react'],
    missingSkills: [],
    explanation: index < 20 ? 'because' : null,
    supportedRequirements: [],
    unsupportedRequirements: [],
    unclearRequirements: [],
    evidence: [],
    ...overrides,
  };
}

function build(overrides: { prisma?: any; ai?: any; fx?: any } = {}) {
  const prisma = overrides.prisma ?? createPrismaMock();
  const ai = overrides.ai ?? {
    enabled: true,
    candidateJobMatches: jest.fn().mockResolvedValue({
      matches: Array.from({ length: 57 }, (_, i) => aiMatch(i)),
      locale: 'en',
      vacanciesConsidered: 57,
      eligibleConsidered: 57,
      generated: true,
      capability: { skills: ['react'] },
      durationMs: 900,
    }),
    matchExplanations: jest
      .fn()
      .mockResolvedValue({ explanations: {}, generated: false }),
  };
  const producer = {
    enqueueVacancyIndexSync: jest.fn().mockResolvedValue('job-1'),
  };
  // FX defaults to "no usable snapshot": salary still compares in the
  // candidate's own currency, and a cross-currency pair reports
  // NOT_COMPARABLE — the degraded path is the one worth defaulting to.
  const fx = overrides.fx ?? {
    ensureSnapshot: jest.fn().mockResolvedValue({
      snapshot: null,
      freshness: 'UNAVAILABLE',
      ageMs: null,
      table: null,
    }),
    current: jest.fn().mockResolvedValue({
      snapshot: null,
      freshness: 'UNAVAILABLE',
      ageMs: null,
      table: null,
    }),
  };
  const service = new JobMatchRankingService(
    prisma as never,
    ai as never,
    producer as never,
    fx as never,
  );
  return { service, prisma, ai, producer, fx };
}

/** computeRun's input for one universe and one intent, defaults empty. */
async function computeInput(
  service: JobMatchRankingService,
  intent: CandidateJobIntent = emptyJobIntent(ACCOUNT),
) {
  return {
    candidateAccountId: ACCOUNT,
    profile: {} as never,
    profileFacts: buildProfileFacts({
      headline: null,
      summary: null,
      location: null,
      skills: [],
      languages: [],
      experience: [],
      education: [],
    }),
    locale: 'en' as const,
    evidenceRevision: 3,
    allowedSourceIds: ['doc-1'],
    explainLimit: 20,
    universe: await service.loadUniverse(),
    intent,
  };
}

function storedEntries(prisma: any) {
  return prisma.candidateJobMatchEntry.createMany.mock.calls[0][0]
    .data as Array<{
    vacancyId: string;
    rank: number;
    score: number;
    capabilityScore: number;
    intentScore: number | null;
  }>;
}

describe('JobMatchRankingService', () => {
  describe('what decides the universe', () => {
    it('asks the DATABASE for eligible vacancies, not the vector index', async () => {
      // The index drifts: cascade-deleted vacancies leave their points behind,
      // and 238 of 391 "OPEN" entries had no OPEN row behind them. Ranking the
      // database's answer makes those ghosts unreachable rather than unlikely.
      const { service, prisma } = build();

      await service.loadUniverse();

      const call = prisma.vacancy.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ status: 'OPEN' });
      expect(call.orderBy).toEqual({ id: 'asc' });
    });

    it('passes EVERY eligible id to the ranking', async () => {
      const { service, ai } = build();

      await service.computeRun(await computeInput(service));

      expect(
        ai.candidateJobMatches.mock.calls[0][0].eligibleVacancyIds,
      ).toHaveLength(57);
    });

    it('stores every ranked entry, not a page of them', async () => {
      const { service, prisma } = build();

      const run = await service.computeRun(await computeInput(service));

      expect(run.totalRanked).toBe(57);
      expect(run.totalRanked).toBe(run.totalEligible);
      expect(storedEntries(prisma)).toHaveLength(57);
    });

    it('keeps score-zero entries in the ranking — a low score is not a filter', async () => {
      // 0/100 means "weak compatibility", never "does not exist". The bottom
      // of the list must be as real and paginatable as the top.
      const ai = {
        enabled: true,
        candidateJobMatches: jest.fn().mockResolvedValue({
          matches: Array.from({ length: 57 }, (_, i) =>
            aiMatch(i, { score: i < 3 ? 0 : Math.max(0, 100 - i) }),
          ),
          locale: 'en',
          vacanciesConsidered: 57,
          eligibleConsidered: 57,
          generated: false,
          capability: {},
          durationMs: 100,
        }),
        matchExplanations: jest.fn(),
      };
      const { service, prisma } = build({ ai });

      const run = await service.computeRun(await computeInput(service));

      const entries = storedEntries(prisma);
      expect(run.totalRanked).toBe(57);
      expect(
        entries.filter((e) => e.score === 0).length,
      ).toBeGreaterThanOrEqual(3);
      // And they hold the LAST ranks rather than disappearing.
      expect(entries[entries.length - 1].score).toBe(0);
    });

    it('spends generation on the FIRST PAGE only', async () => {
      // Explaining 57 matches to show 20 is money spent on text nobody reads.
      const { service, ai } = build();

      await service.computeRun(await computeInput(service));

      expect(ai.candidateJobMatches.mock.calls[0][0].explainLimit).toBe(20);
      expect(ai.candidateJobMatches.mock.calls[0][0].explainOffset).toBe(0);
    });
  });

  describe('hard exclusions — the ONLY thing that shrinks the universe', () => {
    it("removes a vacancy from the candidate's own excluded company, and reports it", async () => {
      const intent = emptyJobIntent(ACCOUNT);
      intent.exclusions.companies = ['org 3'];
      const { service, ai } = build();

      const run = await service.computeRun(await computeInput(service, intent));

      expect(run.totalEligible).toBe(56);
      expect(run.totalExcluded).toBe(1);
      const sent = ai.candidateJobMatches.mock.calls[0][0]
        .eligibleVacancyIds as string[];
      expect(sent).toHaveLength(56);
      expect(sent).not.toContain('vac-3');
    });

    it('saved POSITIVE preferences never shrink the universe', async () => {
      // Preferred Seoul + REMOTE + a salary floor + a role: all soft. The
      // rankable universe stays whole; only order may move.
      const intent = emptyJobIntent(ACCOUNT);
      intent.stated = true;
      intent.roles = ['Backend Engineer'];
      intent.locations = [{ countryCode: 'KR', region: null, city: 'Seoul' }];
      intent.countries = ['KR'];
      intent.workModes = ['REMOTE'];
      intent.compensation = {
        minAmount: 50_000_000,
        maxAmount: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      };
      const { service, ai } = build();

      const run = await service.computeRun(await computeInput(service, intent));

      expect(run.totalEligible).toBe(57);
      expect(run.totalExcluded).toBe(0);
      expect(
        ai.candidateJobMatches.mock.calls[0][0].eligibleVacancyIds,
      ).toHaveLength(57);
    });

    it('an empty intent excludes nothing', async () => {
      const { service } = build();

      const run = await service.computeRun(await computeInput(service));

      expect(run.totalEligible).toBe(57);
      expect(run.totalExcluded).toBe(0);
    });
  });

  describe('an eligible vacancy missing from the index', () => {
    function subsetAi() {
      return {
        enabled: true,
        candidateJobMatches: jest.fn().mockResolvedValue({
          // 57 eligible, but the index only knew 55 of them.
          matches: Array.from({ length: 55 }, (_, i) => aiMatch(i)),
          locale: 'en',
          vacanciesConsidered: 55,
          eligibleConsidered: 57,
          generated: true,
          capability: {},
          durationMs: 500,
        }),
        matchExplanations: jest.fn(),
      };
    }

    it('is still RANKED — a retrieval gap must not shrink the universe', async () => {
      // Qdrant accelerates scoring; it never defines what exists. The two
      // unindexed vacancies enter the ranking with zero capability signal,
      // hold the last ranks, and remain reachable by pagination.
      const { service, prisma } = build({ ai: subsetAi() });

      const run = await service.computeRun(await computeInput(service));

      expect(run.totalRanked).toBe(57);
      expect(run.totalEligible).toBe(57);
      const entries = storedEntries(prisma);
      expect(entries).toHaveLength(57);
      const tail = entries.slice(-2).map((e) => e.vacancyId);
      expect(tail).toEqual(expect.arrayContaining(['vac-55', 'vac-56']));
      expect(entries[56].capabilityScore).toBe(0);
    });

    it('is queued for re-indexing so the gap heals', async () => {
      const { service, producer } = build({ ai: subsetAi() });

      await service.computeRun(await computeInput(service));

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledTimes(2);
      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
        vacancyId: 'vac-55',
      });
    });

    it('queues nothing when every eligible vacancy was ranked', async () => {
      const { service, producer } = build();

      await service.computeRun(await computeInput(service));

      expect(producer.enqueueVacancyIndexSync).not.toHaveBeenCalled();
    });

    it('a queue outage never fails the ranking that DID succeed', async () => {
      const ai = {
        enabled: true,
        candidateJobMatches: jest.fn().mockResolvedValue({
          matches: [aiMatch(0)],
          locale: 'en',
          vacanciesConsidered: 1,
          eligibleConsidered: 57,
          generated: false,
          capability: {},
          durationMs: 10,
        }),
        matchExplanations: jest.fn(),
      };
      const { service, producer } = build({ ai });
      producer.enqueueVacancyIndexSync.mockRejectedValue(
        new Error('redis down'),
      );

      await expect(
        service.computeRun(await computeInput(service)),
      ).resolves.toMatchObject({ totalRanked: 57 });
    });
  });

  describe('combining capability and intent', () => {
    it('an empty intent is a NO-OP: canonical score IS the capability score, in the same order', async () => {
      // The provable baseline: a candidate who stated nothing ranks exactly
      // as if preferences did not exist — same scores, same order.
      const { service, prisma } = build();

      await service.computeRun(await computeInput(service));

      const entries = storedEntries(prisma);
      entries.forEach((entry, index) => {
        expect(entry.score).toBe(entry.capabilityScore);
        expect(entry.intentScore).toBeNull();
        expect(entry.rank).toBe(index + 1);
      });
      // ai order was score desc by construction; the stored order matches it.
      expect(entries[0].vacancyId).toBe('vac-0');
      expect(entries[56].vacancyId).toBe('vac-56');
    });

    it('stated intent reorders within the bounded intent share — capability still dominates', async () => {
      const rows = [
        vacRow(0, { country: 'KR', city: 'Seoul', workMode: 'REMOTE' }),
        vacRow(1),
      ];
      const prisma = createPrismaMock();
      prisma.vacancy.findMany.mockResolvedValue(rows);
      const ai = {
        enabled: true,
        candidateJobMatches: jest.fn().mockResolvedValue({
          // Capability: vac-1 slightly ahead of vac-0.
          matches: [aiMatch(1, { score: 80 }), aiMatch(0, { score: 78 })],
          locale: 'en',
          vacanciesConsidered: 2,
          eligibleConsidered: 2,
          generated: false,
          capability: {},
          durationMs: 50,
        }),
        matchExplanations: jest.fn(),
      };
      const intent = emptyJobIntent(ACCOUNT);
      intent.stated = true;
      intent.locations = [{ countryCode: 'KR', region: null, city: 'Seoul' }];
      intent.countries = ['KR'];
      intent.workModes = ['REMOTE'];
      const { service, prisma: p } = build({ prisma, ai });

      await service.computeRun(await computeInput(service, intent));

      const entries = storedEntries(p);
      // vac-0 matches the stated location and work mode; vac-1 says nothing
      // (unknown = neutral, so it keeps its pure capability score). The two-
      // point capability edge is inside the intent share, so vac-0 overtakes.
      expect(entries[0].vacancyId).toBe('vac-0');
      expect(entries[0].intentScore).toBe(100);
      expect(entries[1].vacancyId).toBe('vac-1');
      expect(entries[1].intentScore).toBeNull();
      expect(entries[1].score).toBe(80);
      // Both remain in the ranking — a mismatch or unknown never removes.
      expect(entries).toHaveLength(2);
    });
  });

  describe('when a stored ranking may be reused', () => {
    const stored = {
      id: 'run-1',
      evidenceRevision: 5,
      vacancyFingerprint: 'fp',
      intentFingerprint: 'ih',
      algorithmVersion: MATCH_ALGORITHM_VERSION,
      totalRanked: 57,
      totalEligible: 57,
      totalExcluded: 0,
      capability: {},
      generatedAt: new Date(),
    };

    it('is reused when every input is unchanged', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({ ...stored });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp', 'ih'),
      ).resolves.toMatchObject({ id: 'run-1' });
    });

    it('is discarded when the candidate evidence moved on', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({ ...stored });
      const { service } = build({ prisma });

      // A deleted file or a refreshed link bumps the revision. Serving the old
      // ranking would rank jobs against evidence that no longer exists.
      await expect(
        service.currentRun(ACCOUNT, 6, 'fp', 'ih'),
      ).resolves.toBeNull();
    });

    it('is discarded when the vacancy catalogue changed', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({ ...stored });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp-new', 'ih'),
      ).resolves.toBeNull();
    });

    it("is discarded when the candidate's intent changed — Rule N1 reaches the cache", async () => {
      // Seoul → Toronto: the old snapshot, with every Seoul-flavored score
      // and reason inside it, must be unreachable from that moment on.
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({ ...stored });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp', 'ih-toronto'),
      ).resolves.toBeNull();
    });

    it('is discarded when the algorithm version moved — same data, new math', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({
        ...stored,
        algorithmVersion: 'v1',
      });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp', 'ih'),
      ).resolves.toBeNull();
    });

    it('a pre-v2 run (null fingerprints) can never be served', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({
        ...stored,
        intentFingerprint: null,
        algorithmVersion: null,
      });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp', 'ih'),
      ).resolves.toBeNull();
    });
  });

  describe('concurrent recomputes', () => {
    it('concurrent recomputes for one candidate share a single run', async () => {
      // Found live: six simultaneous requests (two tabs, or a prefetch racing
      // a click, after a preference change) each started their own
      // 155-vacancy run, and three of them died with a 500 — every
      // transaction deleted a row the others could not see yet, then collided
      // on the one-run-per-candidate unique index.
      const { service, prisma, ai } = build();
      const input = await computeInput(service);

      const results = await Promise.all([
        service.computeRun(input),
        service.computeRun(input),
        service.computeRun(input),
        service.computeRun(input),
      ]);

      // One computation, one write — and every caller still got an answer.
      expect(ai.candidateJobMatches).toHaveBeenCalledTimes(1);
      expect(prisma.candidateJobMatchRun.create).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(4);
      expect(new Set(results.map((r) => r.runId)).size).toBe(1);
    });

    it('callers with different intent do NOT share a ranking', async () => {
      // Sharing is keyed on the inputs. If the reader changed a preference
      // between two requests, the second must be answered from what it
      // actually asked about rather than handed its neighbour's stale intent.
      const { service, ai } = build();
      const empty = await computeInput(service);
      const stated = {
        ...empty,
        intent: {
          ...emptyJobIntent(ACCOUNT),
          stated: true,
          roles: ['Frontend Engineer'],
        },
      };

      await Promise.all([
        service.computeRun(empty),
        service.computeRun(stated as never),
      ]);

      expect(ai.candidateJobMatches).toHaveBeenCalledTimes(2);
    });

    it('a lost write race is retried, not surfaced as a failure', async () => {
      // A second API instance has its own in-flight map and cannot know about
      // ours. Losing that race is harmless — the winner stored a ranking built
      // from the same current state — so the job search must not 500.
      const prisma = createPrismaMock();
      const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      let attempts = 0;
      prisma.$transaction = jest.fn((fn: any) => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(conflict)
          : Promise.resolve(fn(prisma));
      });

      const { service } = build({ prisma });
      const result = await service.computeRun(await computeInput(service));

      expect(attempts).toBe(2);
      expect(result.totalRanked).toBeGreaterThan(0);
    });
  });

  describe('paging a stored ranking', () => {
    it('slices by rank, so pages line up with the committed order', async () => {
      const { service, prisma } = build();

      await service.page('run-1', 40, 20);

      expect(prisma.candidateJobMatchEntry.findMany).toHaveBeenCalledWith({
        where: { runId: 'run-1' },
        orderBy: { rank: 'asc' },
        skip: 40,
        take: 20,
      });
    });

    it('every ranked entry is reachable across pages, with no repeats', async () => {
      // The headline property: a ranking of 57 must be fully retrievable —
      // including its lowest-scoring tail, which is a page like any other.
      const stored = Array.from({ length: 57 }, (_, i) => ({
        id: `e-${i}`,
        vacancyId: `vac-${i}`,
        rank: i + 1,
      }));
      const prisma = createPrismaMock();
      prisma.candidateJobMatchEntry.findMany.mockImplementation(
        ({ skip, take }: { skip: number; take: number }) =>
          Promise.resolve(stored.slice(skip, skip + take)),
      );
      const { service } = build({ prisma });

      const seen: string[] = [];
      for (let page = 0; page < 3; page += 1) {
        const rows = await service.page('run-1', page * 20, 20);
        seen.push(...rows.map((row: { vacancyId: string }) => row.vacancyId));
      }

      expect(seen).toHaveLength(57);
      expect(new Set(seen).size).toBe(57);
      expect(seen).toEqual(stored.map((row) => row.vacancyId));
    });
  });

  describe('explanations', () => {
    it('serves stored prose without asking the model again', async () => {
      const { service, ai } = build();

      const { prose, pending } = await service.explainPage(
        [
          {
            id: 'e-1',
            vacancyId: 'vac-1',
            tier: 'STRONG',
            matchedSkills: [],
            missingSkills: [],
            supportedRequirements: [],
            unsupportedRequirements: [],
            unclearRequirements: [],
            explanations: { en: 'already written' },
          },
        ],
        'en',
      );

      expect(prose.get('vac-1')).toBe('already written');
      expect(pending).toBe(false);
      expect(ai.matchExplanations).not.toHaveBeenCalled();
    });

    it('asks only about entries missing prose IN THIS locale', async () => {
      const { service, ai } = build();
      ai.matchExplanations.mockResolvedValue({
        explanations: { 'vac-2': 'newly written' },
        generated: true,
      });

      const entry = (id: string, explanations: unknown) => ({
        id,
        vacancyId: id,
        tier: 'PARTIAL',
        matchedSkills: [],
        missingSkills: [],
        supportedRequirements: [],
        unsupportedRequirements: [],
        unclearRequirements: [],
        explanations,
      });

      const { prose } = await service.explainPage(
        [entry('vac-1', { ko: 'korean only' }), entry('vac-2', null)],
        'ko',
      );

      // vac-1 already has Korean; only vac-2 is asked about.
      const asked = ai.matchExplanations.mock.calls[0][0].items;
      expect(asked.map((i: { vacancyId: string }) => i.vacancyId)).toEqual([
        'vac-2',
      ]);
      expect(prose.get('vac-1')).toBe('korean only');
      expect(prose.get('vac-2')).toBe('newly written');
    });

    it('serves the page without waiting out a slow generation', async () => {
      // One batched call for twenty matches measured 11-44s live. A "show
      // more" click must not stall on that: the page comes back with whatever
      // prose exists, and the rest is written in the background.
      const { service, ai } = build();
      let resolveLate: (value: unknown) => void = () => undefined;
      ai.matchExplanations.mockReturnValue(
        new Promise((resolve) => {
          resolveLate = resolve;
        }),
      );

      const started = Date.now();
      const { prose, pending } = await service.explainPage(
        [
          {
            id: 'e-1',
            vacancyId: 'vac-1',
            tier: 'STRONG',
            matchedSkills: [],
            missingSkills: [],
            supportedRequirements: [],
            unsupportedRequirements: [],
            unclearRequirements: [],
            explanations: null,
          },
        ],
        'en',
        50, // a short wait, so the test does not sit for the real one
      );

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(prose.size).toBe(0);
      expect(pending).toBe(true);
      resolveLate({ explanations: {}, generated: false });
    });

    it('refuses to start more than two generations at once', async () => {
      // The 3A incident: paging a 154-job ranking started a background
      // generation per page, eight piled onto a single-worker model, and the
      // NEXT ranking request timed out at 120s. Over the cap a page is served
      // from stored prose and asks for nothing new.
      const { service, ai } = build();
      ai.matchExplanations.mockReturnValue(new Promise(() => undefined));

      const entry = (id: string) => ({
        id,
        vacancyId: id,
        tier: 'PARTIAL',
        matchedSkills: [],
        missingSkills: [],
        supportedRequirements: [],
        unsupportedRequirements: [],
        unclearRequirements: [],
        explanations: null,
      });

      const pages = await Promise.all([
        service.explainPage([entry('v1')], 'en', 5),
        service.explainPage([entry('v2')], 'en', 5),
        service.explainPage([entry('v3')], 'en', 5),
        service.explainPage([entry('v4')], 'en', 5),
      ]);

      expect(ai.matchExplanations).toHaveBeenCalledTimes(2);
      // Every page still came back, and honestly reports its prose as pending.
      expect(pages).toHaveLength(4);
      expect(pages.every((page) => page.pending)).toBe(true);
    });

    it('asks the model about at most one bounded batch per request', async () => {
      const { service, ai } = build();
      ai.matchExplanations.mockResolvedValue({
        explanations: {},
        generated: false,
      });

      const entries = Array.from({ length: 50 }, (_, i) => ({
        id: `v${i}`,
        vacancyId: `v${i}`,
        tier: 'PARTIAL',
        matchedSkills: [],
        missingSkills: [],
        supportedRequirements: [],
        unsupportedRequirements: [],
        unclearRequirements: [],
        explanations: null,
      }));

      await service.explainPage(entries, 'en', 5);

      expect(ai.matchExplanations.mock.calls[0][0].items).toHaveLength(20);
    });

    it('a generation outage costs prose, never the page', async () => {
      const { service, ai } = build();
      ai.matchExplanations.mockRejectedValue(new Error('provider down'));

      const { prose, pending } = await service.explainPage(
        [
          {
            id: 'e-1',
            vacancyId: 'vac-1',
            tier: 'STRONG',
            matchedSkills: [],
            missingSkills: [],
            supportedRequirements: [],
            unsupportedRequirements: [],
            unclearRequirements: [],
            explanations: null,
          },
        ],
        'en',
      );

      // The ranking is already stored and correct; the card renders without
      // words rather than the request failing — and reports the prose as
      // not-here-yet, which is what the reader is actually told.
      expect(prose.size).toBe(0);
      expect(pending).toBe(true);
    });
  });
});

describe('advanced insight persistence (algorithm v4)', () => {
  it('stores a deterministic insight payload on every indexed entry', async () => {
    const { service, prisma } = build();

    await service.computeRun(await computeInput(service));

    const data = prisma.candidateJobMatchEntry.createMany.mock.calls[0][0]
      .data as Array<{ vacancyId: string; insight: unknown }>;
    const withInsight = data.filter(
      (d) => d.insight && typeof d.insight === 'object',
    );
    // Every ai-ranked entry carries an insight; the fixture ranks all 57.
    expect(withInsight.length).toBe(57);
    const insight = withInsight[0].insight as {
      version: string;
      eligibility: string;
      dimensions: unknown[];
      requirementMatrix: unknown[];
      evidenceConfidence: number;
    };
    expect(insight.version).toBe('advanced-match-v1');
    expect(['ELIGIBLE', 'PARTIAL', 'BLOCKED']).toContain(insight.eligibility);
    expect(Array.isArray(insight.dimensions)).toBe(true);
    expect(typeof insight.evidenceConfidence).toBe('number');
  });

  it('an index-gap entry stores NO insight — analysis that never ran is not invented', async () => {
    const { service, prisma, ai } = build();
    // Rank only the first 10; the remaining eligible ids become gap entries.
    ai.candidateJobMatches.mockResolvedValue({
      matches: Array.from({ length: 10 }, (_, i) => aiMatch(i)),
      locale: 'en',
      vacanciesConsidered: 10,
      eligibleConsidered: 57,
      generated: false,
      capability: { skills: [] },
      durationMs: 100,
    });

    await service.computeRun(await computeInput(service));

    const data = prisma.candidateJobMatchEntry.createMany.mock.calls[0][0]
      .data as Array<{ insight: { version?: string } | null }>;
    // Gap entries store DbNull, not an insight payload.
    const withPayload = data.filter(
      (d) => d.insight?.version === 'advanced-match-v1',
    );
    expect(withPayload.length).toBe(10);
    expect(data.length).toBe(57);
  });

  it('captures the outgoing run scores as scoreChange metadata on replacement', async () => {
    const { service, prisma } = build();
    prisma.candidateJobMatchEntry.findMany.mockResolvedValueOnce([
      {
        vacancyId: 'vac-0',
        score: 40,
        insight: {
          requirementMatrix: [
            { text: 'React', status: 'MISSING', priority: 'MUST_HAVE' },
          ],
        },
      },
    ]);

    await service.computeRun(await computeInput(service));

    const data = prisma.candidateJobMatchEntry.createMany.mock.calls[0][0]
      .data as Array<{
      vacancyId: string;
      score: number;
      insight: {
        scoreChange: {
          previous: number;
          current: number;
          delta: number;
        } | null;
      };
    }>;
    const replaced = data.find((d) => d.vacancyId === 'vac-0')!;
    expect(replaced.insight.scoreChange).toMatchObject({
      previous: 40,
      current: replaced.score,
      delta: replaced.score - 40,
    });
    // A vacancy with no previous entry has no fabricated history.
    const fresh = data.find((d) => d.vacancyId === 'vac-1')!;
    expect(fresh.insight.scoreChange).toBeNull();
  });

  it('invalidate() strands the run (algorithmVersion null) instead of deleting it', async () => {
    const { service, prisma } = build();

    await service.invalidate('acct-1');

    expect(prisma.candidateJobMatchRun.updateMany).toHaveBeenCalledWith({
      where: { candidateAccountId: 'acct-1' },
      data: { algorithmVersion: null },
    });
    // A null version can never satisfy the reuse check, so the stale rows are
    // unreachable — but they survive to feed scoreChange on the next run.
  });
});

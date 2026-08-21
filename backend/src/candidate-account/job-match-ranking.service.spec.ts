import { JobMatchRankingService } from './job-match-ranking.service';

/**
 * The ranked snapshot: what decides the universe, when it recomputes, and how
 * a page relates to the whole.
 *
 * The failure this guards against is specific and was real: a candidate with
 * 153 open vacancies available to them received about two matches, because a
 * top-K vector search decided the universe and a `limit` truncated it before
 * anything was ranked. So the properties asserted here are mostly about
 * COUNTS and STABILITY rather than about any single match being right.
 */

const ACCOUNT = 'acct-me';

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    vacancy: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          Array.from({ length: 57 }, (_, i) => ({ id: `vac-${i}` })),
        ),
      count: jest.fn().mockResolvedValue(57),
      findFirst: jest
        .fn()
        .mockResolvedValue({ updatedAt: new Date('2026-08-21T10:00:00.000Z') }),
    },
    candidateJobMatchRun: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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

function aiMatch(index: number) {
  return {
    vacancyId: `vac-${index}`,
    organizationId: 'org-1',
    title: `Role ${index}`,
    match: index < 10 ? 'STRONG' : 'PARTIAL',
    score: 100 - index,
    rank: index + 1,
    signals: { semantic: 0.5 },
    matchedSkills: ['react'],
    missingSkills: [],
    explanation: index < 20 ? 'because' : null,
    supportedRequirements: [],
    unsupportedRequirements: [],
    unclearRequirements: [],
    evidence: [],
  };
}

function build(overrides: { prisma?: any; ai?: any } = {}) {
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
  const service = new JobMatchRankingService(
    prisma as never,
    ai as never,
    producer as never,
  );
  return { service, prisma, ai, producer };
}

describe('JobMatchRankingService', () => {
  describe('what decides the universe', () => {
    it('asks the DATABASE for eligible vacancies, not the vector index', async () => {
      // The index drifts: cascade-deleted vacancies leave their points behind,
      // and 238 of 391 "OPEN" entries had no OPEN row behind them. Ranking the
      // database's answer makes those ghosts unreachable rather than unlikely.
      const { service, prisma } = build();

      await service.eligibleVacancyIds();

      expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
        where: { status: 'OPEN' },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
    });

    it('passes EVERY eligible id to the ranking', async () => {
      const { service, ai } = build();

      await service.computeRun({
        candidateAccountId: ACCOUNT,
        profile: {} as never,
        locale: 'en',
        evidenceRevision: 3,
        allowedSourceIds: ['doc-1'],
        explainLimit: 20,
      });

      expect(
        ai.candidateJobMatches.mock.calls[0][0].eligibleVacancyIds,
      ).toHaveLength(57);
    });

    it('stores every ranked entry, not a page of them', async () => {
      const { service, prisma } = build();

      const run = await service.computeRun({
        candidateAccountId: ACCOUNT,
        profile: {} as never,
        locale: 'en',
        evidenceRevision: 3,
        allowedSourceIds: [],
        explainLimit: 20,
      });

      expect(run.totalRanked).toBe(57);
      expect(
        prisma.candidateJobMatchEntry.createMany.mock.calls[0][0].data,
      ).toHaveLength(57);
    });

    it('spends generation on the FIRST PAGE only', async () => {
      // Explaining 57 matches to show 20 is money spent on text nobody reads.
      const { service, ai } = build();

      await service.computeRun({
        candidateAccountId: ACCOUNT,
        profile: {} as never,
        locale: 'en',
        evidenceRevision: 3,
        allowedSourceIds: [],
        explainLimit: 20,
      });

      expect(ai.candidateJobMatches.mock.calls[0][0].explainLimit).toBe(20);
      expect(ai.candidateJobMatches.mock.calls[0][0].explainOffset).toBe(0);
    });
  });

  describe('an eligible vacancy missing from the index', () => {
    it('is queued for re-indexing rather than silently dropped', async () => {
      // 57 eligible, but the ranking only saw 55: two never reached the index.
      // Dropping them quietly is the exact failure this rewrite is about.
      const ai = {
        enabled: true,
        candidateJobMatches: jest.fn().mockResolvedValue({
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
      const { service, producer } = build({ ai });

      await service.computeRun({
        candidateAccountId: ACCOUNT,
        profile: {} as never,
        locale: 'en',
        evidenceRevision: 1,
        allowedSourceIds: [],
        explainLimit: 20,
      });

      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledTimes(2);
      expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
        vacancyId: 'vac-55',
      });
    });

    it('queues nothing when every eligible vacancy was ranked', async () => {
      const { service, producer } = build();

      await service.computeRun({
        candidateAccountId: ACCOUNT,
        profile: {} as never,
        locale: 'en',
        evidenceRevision: 1,
        allowedSourceIds: [],
        explainLimit: 20,
      });

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
        service.computeRun({
          candidateAccountId: ACCOUNT,
          profile: {} as never,
          locale: 'en',
          evidenceRevision: 1,
          allowedSourceIds: [],
          explainLimit: 20,
        }),
      ).resolves.toMatchObject({ totalRanked: 1 });
    });
  });

  describe('when a stored ranking may be reused', () => {
    it('is reused when both inputs are unchanged', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({
        id: 'run-1',
        evidenceRevision: 5,
        vacancyFingerprint: 'fp',
        totalRanked: 57,
        totalEligible: 57,
        capability: {},
        generatedAt: new Date(),
      });
      const { service } = build({ prisma });

      await expect(service.currentRun(ACCOUNT, 5, 'fp')).resolves.toMatchObject(
        {
          id: 'run-1',
        },
      );
    });

    it('is discarded when the candidate evidence moved on', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({
        id: 'run-1',
        evidenceRevision: 5,
        vacancyFingerprint: 'fp',
        totalRanked: 57,
        totalEligible: 57,
        capability: {},
        generatedAt: new Date(),
      });
      const { service } = build({ prisma });

      // A deleted file or a refreshed link bumps the revision. Serving the old
      // ranking would rank jobs against evidence that no longer exists.
      await expect(service.currentRun(ACCOUNT, 6, 'fp')).resolves.toBeNull();
    });

    it('is discarded when the vacancy catalogue changed', async () => {
      const prisma = createPrismaMock();
      prisma.candidateJobMatchRun.findUnique.mockResolvedValue({
        id: 'run-1',
        evidenceRevision: 5,
        vacancyFingerprint: 'fp-old',
        totalRanked: 57,
        totalEligible: 57,
        capability: {},
        generatedAt: new Date(),
      });
      const { service } = build({ prisma });

      await expect(
        service.currentRun(ACCOUNT, 5, 'fp-new'),
      ).resolves.toBeNull();
    });

    it('the fingerprint moves when a vacancy opens, closes or is edited', async () => {
      const prisma = createPrismaMock();
      const { service } = build({ prisma });

      const before = await service.vacancyFingerprint();

      prisma.vacancy.count.mockResolvedValue(58); // one opened
      expect(await service.vacancyFingerprint()).not.toBe(before);

      prisma.vacancy.count.mockResolvedValue(57);
      prisma.vacancy.findFirst.mockResolvedValue({
        updatedAt: new Date('2026-08-22T10:00:00.000Z'), // one edited
      });
      expect(await service.vacancyFingerprint()).not.toBe(before);
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
      // The headline property: a ranking of 57 must be fully retrievable.
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

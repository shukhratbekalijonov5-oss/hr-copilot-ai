import { ExternalIndexService } from './external-index.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AiServiceClient } from '../../ai/ai-service.client';

/**
 * The Qdrant side of the live-only lifecycle: points strictly FOLLOW
 * committed PostgreSQL deletions, arrive in one bounded reconciliation per
 * run, and a Qdrant blip is retried by the queue — never absorbed silently.
 */

function build(over: { aiEnabled?: boolean } = {}) {
  const prisma = {
    externalJob: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    // First call = the stale-row select (empty), later calls = pendingCount.
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ count: 0n }]),
  } as unknown as PrismaService;
  const ai = {
    enabled: over.aiEnabled ?? true,
    deleteExternalJobIndex: jest.fn().mockResolvedValue(0),
    indexExternalJobs: jest.fn().mockResolvedValue(0),
  };
  const service = new ExternalIndexService(
    prisma,
    ai as unknown as AiServiceClient,
  );
  return { service, ai, prisma };
}

describe('field clipping', () => {
  it('clips over-limit provider text to the AI contract instead of failing the batch', async () => {
    const { service, ai, prisma } = build();
    (prisma.externalJob.findMany as jest.Mock).mockResolvedValue([]);
    const raw = (prisma as unknown as { $queryRaw: jest.Mock }).$queryRaw;
    raw.mockReset();
    raw
      .mockResolvedValueOnce([
        {
          id: 'job-1',
          status: 'ACTIVE',
          title: 'T'.repeat(400),
          description: 'D'.repeat(25_000),
          countryCode: 'US',
          region: null,
          city: null,
          workMode: null,
          employmentType: null,
          seniorityLevel: null,
          companyName: 'C'.repeat(400),
        },
      ])
      .mockResolvedValue([{ count: 0n }]);

    await service.indexPending();

    const sent = ai.indexExternalJobs.mock.calls[0][0][0];
    expect(sent.title).toHaveLength(300);
    expect(sent.description).toHaveLength(20_000);
    expect(sent.companyName).toHaveLength(300);
  });
});

describe('reconcile', () => {
  it('deletes exactly the ids PostgreSQL already deleted, then runs the catch-up pass', async () => {
    const { service, ai } = build();
    const outcome = await service.reconcile({ removedIds: ['a', 'b', 'a'] });

    // Deduplicated, one bounded call, then the ordinary indexing pass.
    expect(ai.deleteExternalJobIndex).toHaveBeenCalledTimes(1);
    expect(ai.deleteExternalJobIndex).toHaveBeenCalledWith(['a', 'b']);
    expect(outcome.pointsDeleted).toBe(2);
  });

  it('no removals → pure catch-up pass, no delete call', async () => {
    const { service, ai } = build();
    const outcome = await service.reconcile({});
    expect(ai.deleteExternalJobIndex).not.toHaveBeenCalled();
    expect(outcome.pointsDeleted).toBe(0);
  });

  it('is idempotent: reconciling the same removals twice is safe', async () => {
    const { service, ai } = build();
    await service.reconcile({ removedIds: ['a'] });
    await service.reconcile({ removedIds: ['a'] });
    // Point deletion of an absent id is a Qdrant no-op; both calls succeed.
    expect(ai.deleteExternalJobIndex).toHaveBeenCalledTimes(2);
  });

  it('a Qdrant failure THROWS so the queue retries — never swallowed', async () => {
    const { service, ai } = build();
    ai.deleteExternalJobIndex.mockRejectedValueOnce(new Error('qdrant down'));
    await expect(service.reconcile({ removedIds: ['a'] })).rejects.toThrow(
      'qdrant down',
    );
  });

  it('with the AI service disabled it skips honestly', async () => {
    const { service, ai } = build({ aiEnabled: false });
    const outcome = await service.reconcile({ removedIds: ['a'] });
    expect(ai.deleteExternalJobIndex).not.toHaveBeenCalled();
    expect(outcome.skipped).toBe(true);
  });
});

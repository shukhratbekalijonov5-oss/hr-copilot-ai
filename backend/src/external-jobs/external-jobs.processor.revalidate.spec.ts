import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ExternalJobsProcessor } from './external-jobs.processor';
import { EXTERNAL_JOB_REVALIDATE_JOB } from './external-jobs.constants';
import type { ExternalSyncService } from './external-sync.service';
import type { ExternalRevalidateService } from './external-revalidate.service';
import type { ExternalIndexService } from './search/external-index.service';

/** The formerly-unhandled job name is now a first-class processor case. */
describe('EXTERNAL_JOB_REVALIDATE_JOB handling', () => {
  function build() {
    const revalidate = jest.fn().mockResolvedValue({
      staled: 3,
      expired: 1,
      purged: 0,
      removedJobIds: ['gone-1'],
      batches: 2,
      truncated: false,
    });
    const add = jest.fn().mockResolvedValue({ id: 'reconcile-1' });
    const processor = new ExternalJobsProcessor(
      { syncProvider: jest.fn() } as unknown as ExternalSyncService,
      { revalidate } as unknown as ExternalRevalidateService,
      {
        reconcile: jest.fn(),
        indexPending: jest.fn(),
      } as unknown as ExternalIndexService,
      { add } as unknown as import('bullmq').Queue,
    );
    return { processor, revalidate, add };
  }

  it('runs the ageing pass and reports its outcome', async () => {
    const { processor, revalidate } = build();
    const result = await processor.process({
      name: EXTERNAL_JOB_REVALIDATE_JOB,
      data: {},
    } as Job);

    expect(revalidate).toHaveBeenCalledWith({ jobIds: undefined });
    expect(result).toEqual({
      handled: true,
      staled: 3,
      expired: 1,
      purged: 0,
      removed: 1,
      batches: 2,
      truncated: false,
    });
  });

  it('hard deletions enqueue ONE Qdrant reconciliation carrying the ids', async () => {
    const { processor, add } = build();
    await processor.process({
      name: EXTERNAL_JOB_REVALIDATE_JOB,
      data: {},
    } as Job);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('external-job-index', {
      removedIds: ['gone-1'],
    });
  });

  it('passes a targeted id restriction through', async () => {
    const { processor, revalidate } = build();
    await processor.process({
      name: EXTERNAL_JOB_REVALIDATE_JOB,
      data: { jobIds: ['a', 'b'] },
    } as Job);
    expect(revalidate).toHaveBeenCalledWith({ jobIds: ['a', 'b'] });
  });

  it("a provider sweep enqueues ONE reconcile carrying that run's deletions", async () => {
    const { processor, add } = build();
    const syncProvider = jest.fn().mockResolvedValue({
      runId: 'run-1',
      status: 'SUCCEEDED',
      deletedJobIds: ['dead-1', 'dead-2'],
    });
    (processor as unknown as { sync: unknown }).sync = { syncProvider };

    const result = await processor.process({
      name: 'external-provider-sync',
      data: { provider: 'GREENHOUSE' },
    } as Job);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('external-job-index', {
      removedIds: ['dead-1', 'dead-2'],
    });
    expect(result).toEqual({
      handled: true,
      status: 'SUCCEEDED',
      runId: 'run-1',
      deleted: 2,
    });
  });

  it('a FAILED sweep reconciles with ZERO removals — it deleted nothing', async () => {
    const { processor, add } = build();
    const syncProvider = jest.fn().mockResolvedValue({
      runId: 'run-2',
      status: 'FAILED',
      deletedJobIds: [],
    });
    (processor as unknown as { sync: unknown }).sync = { syncProvider };

    await processor.process({
      name: 'external-provider-sync',
      data: { provider: 'LEVER' },
    } as Job);

    expect(add).toHaveBeenCalledWith('external-job-index', { removedIds: [] });
  });

  it('a genuinely unknown job name still warns and reports unhandled', async () => {
    const { processor } = build();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const result = await processor.process({
      name: 'something-else',
      data: {},
    } as Job);
    expect(result).toEqual({ handled: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

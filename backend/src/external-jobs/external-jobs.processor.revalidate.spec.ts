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
      batches: 2,
      truncated: false,
    });
    const processor = new ExternalJobsProcessor(
      { syncProvider: jest.fn() } as unknown as ExternalSyncService,
      { revalidate } as unknown as ExternalRevalidateService,
      { indexPending: jest.fn() } as unknown as ExternalIndexService,
    );
    return { processor, revalidate };
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
      batches: 2,
      truncated: false,
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

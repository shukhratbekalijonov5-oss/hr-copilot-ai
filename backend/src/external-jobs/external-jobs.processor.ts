import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  EXTERNAL_JOBS_QUEUE,
  EXTERNAL_JOB_INDEX_JOB,
  EXTERNAL_JOB_REVALIDATE_JOB,
  EXTERNAL_PROVIDER_SYNC_JOB,
  type ExternalJobRevalidateJobData,
  type ExternalProviderSyncJobData,
} from './external-jobs.constants';
import { ExternalSyncService } from './external-sync.service';
import { ExternalRevalidateService } from './external-revalidate.service';
import { ExternalIndexService } from './search/external-index.service';
import type { ExternalProvider } from '../generated/prisma/enums';

/**
 * Where provider HTTP actually happens.
 *
 * ## Never on a candidate's request
 *
 * A search must not reach a third party. One provider fetch is seconds of
 * latency the candidate did not ask for, it fails in ways a search page cannot
 * usefully report, and multiplying one shared catalogue by the traffic is the
 * fastest way to be rate-limited off every provider at once. So the network
 * lives here, on a worker, and search reads Postgres.
 *
 * ## Concurrency 1
 *
 * Sweeps are I/O-bound against a host we are trying to be gentle with, and two
 * concurrent runs of the same provider would race on the same
 * `(provider, sourceKey)` rows to no benefit. Per-provider request pacing is
 * enforced inside the provider's HTTP client; this simply does not create work
 * for it to serialize.
 *
 * ## Failure is expected, not exceptional
 *
 * The job returns its outcome rather than throwing. A provider being down is a
 * normal Tuesday: the run row records it, the previously-ingested jobs stay
 * exactly as they are, and the next sweep tries again. Throwing would add
 * BullMQ retries on top of a schedule that already retries, which is a retry
 * storm dressed as resilience. Only a genuinely unexpected error — a bug here,
 * not upstream — is allowed to fail the job.
 */
@Processor(EXTERNAL_JOBS_QUEUE, { concurrency: 1 })
export class ExternalJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalJobsProcessor.name);

  constructor(
    private readonly sync: ExternalSyncService,
    private readonly revalidate: ExternalRevalidateService,
    private readonly index: ExternalIndexService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case EXTERNAL_PROVIDER_SYNC_JOB:
        return this.runSync(job.data as ExternalProviderSyncJobData);
      case EXTERNAL_JOB_REVALIDATE_JOB: {
        /*
         * DB-local lifecycle maintenance: age unobserved ACTIVE jobs to
         * STALE and pass-deadline jobs to EXPIRED. No provider HTTP happens
         * here — the service's only dependency is the database — so this
         * job can never be the source of a provider burst, and a retry of
         * it is always safe (the transitions are monotone re-checks).
         */
        const data = (job.data ?? {}) as ExternalJobRevalidateJobData;
        const outcome = await this.revalidate.revalidate({
          jobIds: data.jobIds,
        });
        return { handled: true, ...outcome };
      }
      case EXTERNAL_JOB_INDEX_JOB:
        /*
         * Deliberately separate from the sync job. Ingestion must succeed when
         * the embedding model is down: jobs land in Postgres, they are
         * searchable through the lexical index immediately, and they acquire
         * vectors whenever this catches up.
         */
        return this.index.indexPending();
      default:
        this.logger.warn(`Unhandled external job type: ${job.name}`);
        return { handled: false };
    }
  }

  private async runSync(
    data: ExternalProviderSyncJobData,
  ): Promise<{ handled: boolean; status?: string; runId?: string }> {
    const provider = data?.provider as ExternalProvider | undefined;
    if (!provider) {
      this.logger.warn('External sync job carried no provider name');
      return { handled: false };
    }
    const outcome = await this.sync.syncProvider(provider);
    if (!outcome) return { handled: false };
    return {
      handled: true,
      status: outcome.status,
      runId: outcome.runId,
    };
  }
}

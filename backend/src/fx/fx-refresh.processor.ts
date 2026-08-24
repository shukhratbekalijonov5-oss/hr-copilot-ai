import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { FX_RATES_QUEUE } from './fx.constants';
import { FxRateService } from './fx-rate.service';

/**
 * Runs one exchange-rate refresh.
 *
 * Concurrency 1: two simultaneous refreshes would race to write the snapshot
 * and gain nothing — there is only ever one table to fetch.
 *
 * The job never throws. A provider outage is an expected condition, not a
 * failed job: the previous snapshot survives, the next tick tries again, and
 * marking the job failed would only add retry noise on top of a wait that is
 * already scheduled.
 */
@Processor(FX_RATES_QUEUE, { concurrency: 1 })
export class FxRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(FxRefreshProcessor.name);

  constructor(private readonly rates: FxRateService) {
    super();
  }

  async process(job: Job): Promise<{ refreshed: boolean; version?: string }> {
    const snapshot = await this.rates.refresh();
    if (!snapshot) {
      // Logged at warn inside the service, with the reason but never the URL
      // or the key.
      this.logger.debug?.(`FX refresh (${job.name}) produced no new snapshot`);
      return { refreshed: false };
    }
    return { refreshed: true, version: snapshot.snapshotVersion };
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  FX_RATES_QUEUE,
  FX_REFRESH_JOB,
  FX_REFRESH_REPEAT_KEY,
} from './fx.constants';
import { FxRateService } from './fx-rate.service';

/**
 * Keeps exactly one exchange-rate refresh cycle running, and warms a cold
 * cache once at boot.
 *
 * ## Why a scheduler and not a fetch-on-demand
 *
 * Rates are the same for everybody. Fetching them per ranking request, per
 * candidate or per vacancy would multiply one piece of shared state by the
 * traffic, and put a third-party HTTP call on the critical path of a page that
 * must not depend on it. One job every thirty minutes serves every candidate.
 *
 * ## Idempotent registration
 *
 * `upsertJobScheduler` with a fixed key replaces the schedule rather than
 * adding to it, so restarts and multiple instances converge on one cycle
 * instead of N. Without that, every deploy would leave another repeatable
 * behind and the provider would be called more often than anyone intended.
 */
@Injectable()
export class FxRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(FxRefreshScheduler.name);

  constructor(
    @InjectQueue(FX_RATES_QUEUE) private readonly queue: Queue,
    private readonly rates: FxRateService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.rates.providerConfigured) {
      // Nothing to schedule, and saying so once at boot is more useful than a
      // job that fails every thirty minutes for the rest of the process's life.
      this.logger.log(
        'No exchange-rate provider configured (EXCHANGE_RATE_API_URL is unset); ' +
          'cross-currency salary comparison will report NOT_COMPARABLE',
      );
      return;
    }

    const every = this.config.get<number>(
      'exchangeRates.refreshIntervalMs',
      30 * 60_000,
    );

    try {
      await this.queue.upsertJobScheduler(
        FX_REFRESH_REPEAT_KEY,
        { every },
        { name: FX_REFRESH_JOB },
      );
      this.logger.log(
        `Exchange-rate refresh scheduled every ${Math.round(every / 60_000)} minutes`,
      );
    } catch (error) {
      // A queue that will not accept a schedule must not stop the API from
      // serving. Salary comparison degrades; nothing else does.
      this.logger.warn(
        `Could not schedule the exchange-rate refresh: ${(error as Error).message}`,
      );
    }

    // A cold start would otherwise wait a full interval before the first
    // comparison could work. `ensureSnapshot` is itself locked, so several
    // instances booting together still make one provider call.
    void this.rates.ensureSnapshot().catch(() => undefined);
  }
}

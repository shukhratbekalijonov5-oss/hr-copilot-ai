import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  EXTERNAL_JOBS_QUEUE,
  EXTERNAL_PROVIDER_SYNC_JOB,
  DEFAULT_SYNC_INTERVAL_MS,
} from './external-jobs.constants';
import { ExternalProviderRegistry } from './provider-registry';

/**
 * Optional repeating sweeps, off unless someone turns them on.
 *
 * ## Why opt-in
 *
 * A schedule is a standing commitment to call somebody else's servers forever.
 * Turning it on by default would mean that installing this code starts
 * traffic against every configured board, at an interval nobody chose, on
 * machines that may be a developer's laptop or a CI runner. So the default is
 * manual (`npm run external:sync`), and continuous sync is a deliberate
 * decision recorded in configuration.
 *
 * ## Deterministic scheduler ids
 *
 * `upsertJobScheduler` with a fixed key per provider REPLACES the schedule
 * rather than adding to it. Without that, every restart and every extra
 * instance would leave another repeatable behind, and a provider that was
 * meant to be called every six hours would be called every six hours times
 * the number of deploys since Tuesday — the exact way an integration gets
 * itself banned.
 */
@Injectable()
export class ExternalSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(ExternalSyncScheduler.name);

  constructor(
    @InjectQueue(EXTERNAL_JOBS_QUEUE) private readonly queue: Queue,
    private readonly registry: ExternalProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  /** The stable id for one provider's repeatable sweep. */
  static schedulerKey(provider: string): string {
    return `external-sync:${provider.toLowerCase()}`;
  }

  /** Take down any repeatable this deployment previously registered. */
  private async removeSchedules(providers: string[]): Promise<void> {
    for (const name of providers) {
      try {
        const removed = await this.queue.removeJobScheduler(
          ExternalSyncScheduler.schedulerKey(name),
        );
        if (removed) {
          this.logger.log(`Removed the repeating external sync for ${name}`);
        }
      } catch (error) {
        this.logger.warn(
          `Could not remove the external sync schedule for ${name}: ` +
            `${(error as Error).message}`,
        );
      }
    }
  }

  async onModuleInit(): Promise<void> {
    const providers = this.registry.list();
    if (providers.length === 0) {
      this.logger.log(
        'No external job provider configured; external ingestion is idle',
      );
      return;
    }

    const enabled = this.config.get<boolean>(
      'externalJobs.scheduleEnabled',
      false,
    );
    if (!enabled) {
      /*
       * Off means off, including for a schedule an earlier boot registered.
       *
       * A repeatable job outlives the process that created it — it is state in
       * Redis, not in this deployment. Without this, flipping the flag back to
       * false would leave the sweeps running forever, and the only symptom
       * would be a provider being called by a system nobody believes is
       * calling it.
       */
      await this.removeSchedules(providers.map((p) => p.descriptor.provider));
      this.logger.log(
        `External providers configured (${providers
          .map((provider) => provider.descriptor.provider)
          .join(', ')}) but scheduled sync is off; ` +
          'run `npm run external:sync` or set EXTERNAL_SYNC_ENABLED=true',
      );
      return;
    }

    const every = this.config.get<number>(
      'externalJobs.syncIntervalMs',
      DEFAULT_SYNC_INTERVAL_MS,
    );

    for (const provider of providers) {
      const name = provider.descriptor.provider;
      try {
        await this.queue.upsertJobScheduler(
          ExternalSyncScheduler.schedulerKey(name),
          { every },
          { name: EXTERNAL_PROVIDER_SYNC_JOB, data: { provider: name } },
        );
        this.logger.log(
          `External sync scheduled for ${name} every ` +
            `${Math.round(every / 60_000)} minutes`,
        );
      } catch (error) {
        // A queue that will not take a schedule must not stop the API booting.
        // External jobs stop refreshing; nothing else degrades.
        this.logger.warn(
          `Could not schedule external sync for ${name}: ${(error as Error).message}`,
        );
      }
    }
  }
}

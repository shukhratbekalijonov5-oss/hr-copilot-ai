import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  EXTERNAL_JOBS_QUEUE,
  EXTERNAL_JOB_REVALIDATE_JOB,
  EXTERNAL_PROVIDER_SYNC_JOB,
  EXTERNAL_REVALIDATE_SCHEDULER_ID,
  DEFAULT_REVALIDATE_INTERVAL_MS,
  DEFAULT_SYNC_INTERVAL_MS,
} from './external-jobs.constants';
import { ExternalProviderRegistry } from './provider-registry';
import { ExternalProvider } from '../generated/prisma/enums';

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
 * ## Restart safety — why registration checks before it upserts
 *
 * BullMQ's `upsertJobScheduler` is NOT a no-op when the scheduler already
 * exists. Measured against the installed bullmq (6.1.2, `addJobScheduler`
 * Lua):
 *
 *   - scheduler MISSING → the first iteration is scheduled at `now`:
 *     an immediate provider sweep;
 *   - scheduler EXISTS, same `every` → the PENDING next iteration is
 *     removed and replaced one full interval later (`prev + every`):
 *     restarts silently push the sweep away — restart often enough and it
 *     never runs at all.
 *
 * So a boot that blindly upserts either bursts the providers (the schedule
 * state was gone: every deploy of a crash-looping process sweeps every
 * provider) or starves the schedule (state present: every deploy postpones
 * it). Both were observed as "every boot swept, iteration count 1".
 *
 * The fix: read the scheduler first (`getJobScheduler` — one Redis call) and
 * LEAVE IT ALONE when it already encodes exactly what this boot wants (same
 * interval, same job name, same provider payload). The pending next run —
 * Redis state, not process state — then survives restarts, rolling deploys
 * and crash loops untouched. Only a genuinely new registration, or a
 * deliberate config change (different interval), upserts; the immediate
 * first sweep on first-ever enable is intended behavior (enabling the
 * feature should populate the catalogue), and it happens once, not once per
 * boot.
 *
 * Redis stays the only scheduling authority: there is no in-memory
 * timestamp, no local clock arithmetic, and nothing a second replica could
 * disagree with. Two replicas booting together at worst race one upsert of
 * the same key — the Lua script is atomic per key and iteration jobs are
 * id-deduplicated per (scheduler, slot), so the race cannot produce two
 * sweeps.
 *
 * ## The maintenance pass rides the same switch
 *
 * `EXTERNAL_SYNC_ENABLED` also schedules the hourly DB-local revalidation
 * (ACTIVE→STALE ageing, deadline→EXPIRED). It makes no provider calls, but
 * it is part of the same standing commitment — a catalogue nobody sweeps
 * should not silently age either, and a developer laptop with the flag off
 * keeps exactly zero repeatables, which is the documented local state.
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

  /**
   * Every scheduler id this deployment could ever have registered — all
   * KNOWN providers, not just currently-runnable ones. Removal must cover
   * the provider that was configured last month and is not any more;
   * covering only today's configuration would leave exactly that schedule
   * behind.
   */
  private static allSchedulerIds(): string[] {
    return [
      ...Object.values(ExternalProvider).map((name) =>
        ExternalSyncScheduler.schedulerKey(name),
      ),
      EXTERNAL_REVALIDATE_SCHEDULER_ID,
    ];
  }

  /** Take down repeatables by scheduler id. Failure logs; boot continues. */
  private async removeSchedules(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        const removed = await this.queue.removeJobScheduler(id);
        if (removed) {
          this.logger.log(`Removed the repeating schedule ${id}`);
        }
      } catch (error) {
        this.logger.warn(
          `Could not remove the schedule ${id}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Ensure ONE scheduler exists with exactly this cadence and payload —
   * without disturbing a pending future run that already matches.
   *
   * Returns what it did, so boots are observable: 'preserved' is the normal
   * steady-state answer and involves no write at all.
   */
  private async ensureScheduler(input: {
    id: string;
    every: number;
    jobName: string;
    data: Record<string, unknown>;
  }): Promise<'created' | 'preserved'> {
    const existing = await this.queue.getJobScheduler(input.id);
    if (
      existing &&
      existing.every === input.every &&
      existing.name === input.jobName &&
      sameData(existing.template?.data, input.data)
    ) {
      return 'preserved';
    }
    await this.queue.upsertJobScheduler(
      input.id,
      { every: input.every },
      { name: input.jobName, data: input.data },
    );
    return 'created';
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
      await this.removeSchedules(ExternalSyncScheduler.allSchedulerIds());
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

    const runnable = new Set(
      providers.map((provider) => provider.descriptor.provider),
    );
    for (const provider of providers) {
      const name = provider.descriptor.provider;
      try {
        const outcome = await this.ensureScheduler({
          id: ExternalSyncScheduler.schedulerKey(name),
          every,
          jobName: EXTERNAL_PROVIDER_SYNC_JOB,
          data: { provider: name },
        });
        this.logger.log(
          outcome === 'preserved'
            ? `External sync for ${name} already scheduled every ` +
                `${Math.round(every / 60_000)} minutes; ` +
                'existing schedule preserved'
            : `External sync scheduled for ${name} every ` +
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

    // A provider that stopped being runnable keeps no schedule. Its jobs are
    // not touched — they will age to STALE through revalidation, which is
    // the honest outcome for a catalogue nobody sweeps any more.
    await this.removeSchedules(
      Object.values(ExternalProvider)
        .filter((name) => !runnable.has(name))
        .map((name) => ExternalSyncScheduler.schedulerKey(name)),
    );

    const revalidateEvery = this.config.get<number>(
      'externalJobs.revalidateIntervalMs',
      DEFAULT_REVALIDATE_INTERVAL_MS,
    );
    try {
      const outcome = await this.ensureScheduler({
        id: EXTERNAL_REVALIDATE_SCHEDULER_ID,
        every: revalidateEvery,
        jobName: EXTERNAL_JOB_REVALIDATE_JOB,
        data: {},
      });
      this.logger.log(
        outcome === 'preserved'
          ? `External lifecycle revalidation already scheduled every ` +
              `${Math.round(revalidateEvery / 60_000)} minutes; preserved`
          : `External lifecycle revalidation scheduled every ` +
              `${Math.round(revalidateEvery / 60_000)} minutes`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not schedule external revalidation: ${(error as Error).message}`,
      );
    }
  }
}

/** Template payload equality — order-independent, depth 1 is all we store. */
function sameData(a: unknown, b: Record<string, unknown>): boolean {
  const left = (a ?? {}) as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(b);
  if (leftKeys.length !== rightKeys.length) return false;
  return rightKeys.every((key) => left[key] === b[key]);
}

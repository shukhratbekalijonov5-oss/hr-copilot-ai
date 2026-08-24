/**
 * Queue and job names for external ingestion.
 *
 * All three run in the background, and that is not an optimisation: a provider
 * fetch is a third-party network call that can take a minute and fail, and the
 * one place it must never happen is inside a candidate's search request. One
 * ingestion pipeline serves every candidate — the alternative, fetching per
 * search, would multiply one piece of shared state by the traffic and get the
 * product rate-limited off every provider it uses.
 */
export const EXTERNAL_JOBS_QUEUE = 'external-jobs';

/** Sweep one provider's current listings. */
export const EXTERNAL_PROVIDER_SYNC_JOB = 'external-provider-sync';
/** Re-check jobs nobody has verified lately, and age out what has gone. */
export const EXTERNAL_JOB_REVALIDATE_JOB = 'external-job-revalidate';
/** Reconcile one external job with the semantic index. */
export const EXTERNAL_JOB_INDEX_JOB = 'external-job-index';

/**
 * The hard ceiling on pages one sweep will walk.
 *
 * A cursor loop trusts a third party to eventually say "no more". A provider
 * that returns the same cursor forever — a bug, or a board list that keeps
 * growing — would otherwise be an infinite job holding a worker. The bound is
 * far above any real configuration (one page per Greenhouse board) so it can
 * only ever fire on a genuine fault.
 */
export const EXTERNAL_SYNC_MAX_PAGES = 500;

export interface ExternalProviderSyncJobData {
  provider: string;
  /** Continues an interrupted sweep instead of restarting it. */
  cursor?: string | null;
  /** The run this page belongs to, so counters accumulate in one row. */
  runId?: string;
}

export interface ExternalJobRevalidateJobData {
  /** Bounded batch; a sweep is many jobs, not one enormous transaction. */
  jobIds: string[];
}

export interface ExternalJobIndexJobData {
  externalJobId: string;
}

/**
 * How often each provider is swept, when sweeps are eventually scheduled.
 *
 * Nothing schedules these yet — Task 4A deliberately registers no repeatable
 * job, because pointing a scheduler at providers whose legal access has not
 * been verified is exactly the mistake this architecture exists to prevent.
 * The value lives here so that turning a provider on later is a registration,
 * not a redesign.
 */
export const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * How long a job may go unobserved before it is STALE, by default.
 *
 * Generous on purpose. Job boards are not obliged to re-list a posting on our
 * schedule, and treating a quiet week as a closure would hide real openings.
 * Providers override it in their descriptor.
 */
export const DEFAULT_STALENESS_MS = 14 * 24 * 60 * 60_000;

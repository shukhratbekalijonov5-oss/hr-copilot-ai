import type {
  ExternalProviderDescriptor,
  NormalizedExternalJobInput,
  ProviderFetchPage,
} from './external-job.contract';

/**
 * What every external job source must look like from the inside of this product.
 *
 * ## The rule this interface exists to make structural
 *
 * Nothing above this line may know which provider a job came from. Not the
 * matcher, not the dedupe, not the lifecycle, not the ranking. A
 * `if (provider === 'GREENHOUSE')` anywhere downstream is the failure this
 * type is here to prevent, because that is how a job platform ends up with
 * five subtly different definitions of "senior" and no way to reconcile them.
 *
 * A provider therefore has exactly two responsibilities: talk to its source,
 * and produce `NormalizedExternalJobInput`. Everything else is shared.
 *
 * ## Access is declared, not assumed
 *
 * `descriptor` states how this provider is allowed to read and which hosts it
 * may contact, and the ingestion layer enforces both. This is deliberate: the
 * legal boundary is not a comment in a runbook, it is a value the code checks.
 * There is no access method for scraping behind authentication, anti-bot
 * measures or robots restrictions, so a provider cannot declare one.
 */
export abstract class ExternalJobProvider {
  abstract readonly descriptor: ExternalProviderDescriptor;

  /**
   * True when this provider is configured well enough to run.
   *
   * A provider with no credentials or no board token reports false and is
   * skipped, exactly as the FX provider does when no endpoint is set. It must
   * never throw during registration — an unconfigured Ninehire cannot be
   * allowed to stop Greenhouse from syncing.
   */
  abstract get configured(): boolean;

  /**
   * One page of currently-listed jobs.
   *
   * Providers return NORMALIZED jobs, never raw payloads: the mapping is the
   * provider's own business and the only thing that understands its quirks.
   * Postings this provider cannot map are reported in `rejected` rather than
   * thrown, so a single malformed row cannot end the sweep.
   */
  abstract fetchPage(cursor: string | null): Promise<ProviderFetchPage>;

  /**
   * Re-read ONE job, for revalidation.
   *
   * `null` means "this provider can no longer see it" — which is evidence the
   * source is GONE, and deliberately different from a thrown error, which
   * means the fetch itself failed and proves nothing about the job. Providers
   * that cannot address a single posting may leave this unimplemented; the
   * revalidation sweep then falls back to full listings.
   */
  fetchOne?(sourceKey: string): Promise<NormalizedExternalJobInput | null>;
}

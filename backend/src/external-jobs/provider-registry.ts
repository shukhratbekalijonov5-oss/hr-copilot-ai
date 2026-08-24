import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ExternalJobProvider } from './external-job.provider';
import type { ExternalProvider } from '../generated/prisma/enums';

/**
 * Every provider implementation this deployment builds, injected as one array.
 *
 * Registration happens in the registry's CONSTRUCTOR rather than in a module
 * lifecycle hook, because Nest runs a module's own `onModuleInit` after its
 * providers' — so a scheduler that asked "which providers are runnable?" in
 * its own hook would have been answered "none" and quietly scheduled nothing.
 */
export const EXTERNAL_JOB_PROVIDERS = Symbol('EXTERNAL_JOB_PROVIDERS');

/**
 * Every provider this deployment can run, by name.
 *
 * The registry exists so that adding Ninehire is a registration and nothing
 * else. No switch statement grows, no ranking code learns a new name, and no
 * scheduler needs editing — the sync job looks a provider up here and asks it
 * for a page.
 *
 * Registration is also where the access boundary is enforced once, centrally,
 * instead of being re-checked at each call site: a provider that declares no
 * allowed hosts, or that is not configured, never becomes runnable.
 */
@Injectable()
export class ExternalProviderRegistry {
  private readonly logger = new Logger(ExternalProviderRegistry.name);
  private readonly providers = new Map<ExternalProvider, ExternalJobProvider>();

  constructor(
    @Optional()
    @Inject(EXTERNAL_JOB_PROVIDERS)
    implementations: ExternalJobProvider[] = [],
  ) {
    for (const implementation of implementations) {
      this.register(implementation);
    }
  }

  register(provider: ExternalJobProvider): void {
    const { provider: name, allowedHosts } = provider.descriptor;

    if (!provider.configured) {
      // Checked BEFORE the allowlist, because "not configured" is the honest
      // reason and the allowlist is downstream of it: a company careers
      // provider derives its hosts from its configured sources, so with none
      // configured it has none — reporting that as a misconfigured allowlist
      // would send someone looking for a bug that is not there.
      //
      // Same reasoning as the FX provider: saying so once at boot beats a job
      // that fails every few hours for the life of the process.
      this.logger.log(`Provider ${name} is not configured; skipping`);
      return;
    }
    if (allowedHosts.length === 0) {
      // A provider with no allowlist could be pointed anywhere by whatever
      // supplies its URLs. Server-side fetching with an open host list is an
      // SSRF primitive on a schedule, so it is refused at registration rather
      // than trusted to behave.
      this.logger.error(
        `Provider ${name} declares no allowed hosts and will not be registered`,
      );
      return;
    }
    this.providers.set(name, provider);
    this.logger.log(
      `Provider ${name} registered (${provider.descriptor.accessMethod}, ` +
        `${allowedHosts.length} allowed host(s))`,
    );
  }

  get(name: ExternalProvider): ExternalJobProvider | null {
    return this.providers.get(name) ?? null;
  }

  /** Providers that are runnable right now. */
  list(): ExternalJobProvider[] {
    return [...this.providers.values()];
  }

  /**
   * Whether a URL may be fetched on this provider's behalf.
   *
   * Exact host or a subdomain of an allowed host — never a suffix match, which
   * would let `evil-greenhouse.io` pass a check for `greenhouse.io`.
   */
  isAllowedHost(provider: ExternalJobProvider, url: string): boolean {
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return false;
      }
      host = parsed.hostname.toLowerCase();
    } catch {
      return false;
    }
    return provider.descriptor.allowedHosts.some(
      (allowed) =>
        host === allowed.toLowerCase() ||
        host.endsWith(`.${allowed.toLowerCase()}`),
    );
  }
}

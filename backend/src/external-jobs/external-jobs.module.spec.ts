import { ConfigService } from '@nestjs/config';
import { ExternalProviderRegistry } from './provider-registry';
import { GreenhouseProvider } from './providers/greenhouse/greenhouse.provider';
import { LeverProvider } from './providers/lever/lever.provider';
import { AshbyProvider } from './providers/ashby/ashby.provider';
import { NinehireProvider } from './providers/ninehire/ninehire.provider';
import { CompanyCareersProvider } from './providers/company-careers/company-careers.provider';
import { COMPANY_CAREERS_CATALOGUE } from './providers/company-careers/company-careers.catalogue';
import type { SafeHttpFetcher } from '../web-ingestion/safe-fetcher';

/**
 * Every provider this deployment can build, actually built.
 *
 * Wiring is the one thing the other suites cannot see. Each provider has its
 * own tests and passes them while the module still fails to construct it —
 * which is how the company careers provider was once listed in the registry's
 * `inject` array with no factory to satisfy it, a mistake that shows up as the
 * whole application refusing to boot and as nothing at all in a unit run.
 */

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

const FETCHER = {
  fetchText: () => Promise.reject(new Error('not called')),
} as unknown as SafeHttpFetcher;

function buildAll(values: Record<string, string>) {
  const settings = config(values);
  return [
    new GreenhouseProvider(settings),
    new LeverProvider(settings),
    new AshbyProvider(settings),
    new NinehireProvider(settings),
    new CompanyCareersProvider(settings, FETCHER),
  ];
}

describe('the provider array the module hands the registry', () => {
  it('constructs all five without configuration', () => {
    // A provider must never throw during registration: an unconfigured
    // Ninehire cannot be allowed to stop Greenhouse from syncing.
    expect(() => buildAll({})).not.toThrow();
  });

  it('registers exactly the providers that are configured', () => {
    const registry = new ExternalProviderRegistry(
      buildAll({
        'externalJobs.greenhouseBoards': 'vercel:Vercel',
        'externalJobs.leverSites': 'gopuff:Gopuff',
      }),
    );
    expect(
      registry.list().map((provider) => provider.descriptor.provider),
    ).toEqual(['GREENHOUSE', 'LEVER']);
  });

  it('skips the company careers provider while every source is reviewed off', () => {
    /*
     * The honest current state, and the behaviour that follows from it: an
     * operator may name the reviewed-off ids, and the provider still reports
     * unconfigured — so nothing is registered, nothing is scheduled, and no
     * request is ever built. A company site is not read 88 times a day to
     * learn nothing.
     */
    const registry = new ExternalProviderRegistry(
      buildAll({
        'externalJobs.companyCareersSources': 'vercel-careers,linear-careers',
      }),
    );
    expect(registry.get('COMPANY_CAREERS')).toBeNull();
  });

  it('registers none at all when nothing is configured', () => {
    // A deployment with no sources makes no network calls, rather than failing
    // at the first scheduled sweep.
    expect(new ExternalProviderRegistry(buildAll({})).list()).toEqual([]);
  });

  it('gives the company careers provider its own host allowlist', () => {
    // Built from a reviewed entry directly, so the allowlist rules stay under
    // test regardless of which companies are switched on.
    const linear = COMPANY_CAREERS_CATALOGUE.find(
      (source) => source.sourceId === 'linear-careers',
    )!;
    const provider = new CompanyCareersProvider(config({}), FETCHER, [linear]);
    const registry = new ExternalProviderRegistry([provider]);

    expect(provider.descriptor.allowedHosts).toEqual(['linear.app']);
    expect(registry.isAllowedHost(provider, 'https://linear.app/careers')).toBe(
      true,
    );
    // Not the ATS it links to, and not another reviewed company.
    expect(
      registry.isAllowedHost(provider, 'https://jobs.ashbyhq.com/Linear/x'),
    ).toBe(false);
    expect(registry.isAllowedHost(provider, 'https://vercel.com/careers')).toBe(
      false,
    );
  });

  it("keeps one provider's configuration out of another's", () => {
    const registry = new ExternalProviderRegistry(
      buildAll({
        'externalJobs.greenhouseBoards': 'vercel:Vercel',
        'externalJobs.leverSites': 'gopuff:Gopuff',
        'externalJobs.ashbyBoards': 'linear:Linear',
      }),
    );
    const hosts = Object.fromEntries(
      registry
        .list()
        .map((provider) => [
          provider.descriptor.provider,
          provider.descriptor.allowedHosts,
        ]),
    );
    expect(hosts.GREENHOUSE).toEqual(['boards-api.greenhouse.io']);
    expect(hosts.LEVER).toEqual(['api.lever.co']);
    expect(hosts.ASHBY).toEqual(['api.ashbyhq.com']);
    expect(hosts.COMPANY_CAREERS).toBeUndefined();
  });
});

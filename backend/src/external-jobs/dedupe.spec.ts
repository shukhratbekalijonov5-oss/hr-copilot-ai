import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessMerge, fingerprintOf, sourceKeyOf } from './dedupe';
import { urlIdentity } from './url-identity';
import type { NormalizedExternalJobInput } from './external-job.contract';

function job(
  over: Partial<NormalizedExternalJobInput> = {},
): NormalizedExternalJobInput {
  return {
    provider: 'GREENHOUSE',
    accessMethod: 'OFFICIAL_API',
    sourceJobId: 'gh-1',
    sourceUrl: 'https://boards.greenhouse.io/abc/jobs/1',
    originalUrl: null,
    companyName: 'ABC Corp',
    companyWebsiteUrl: null,
    companyCountryCode: null,
    title: 'Backend Engineer',
    description: null,
    requirementsText: null,
    countryCode: 'KR',
    region: null,
    city: 'Seoul',
    workMode: null,
    additionalLocations: [],
    remoteCountriesAllowed: [],
    employmentType: 'FULL_TIME',
    seniorityLevel: null,
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriod: null,
    skills: [],
    industries: [],
    benefits: [],
    languageCodes: [],
    visaSponsorship: 'UNKNOWN',
    existingWorkAuthorizationRequired: null,
    eligibleVisaTypes: [],
    expiresAt: null,
    employerPosted: null,
    closedAtSource: false,
    ...over,
  };
}

const existing = (over: Partial<Parameters<typeof assessMerge>[1]> = {}) => ({
  canonicalUrl: null,
  companyDomain: null,
  countryCode: 'KR',
  city: 'Seoul',
  sources: [] as { provider: string; sourceKey: string }[],
  ...over,
});

describe('the fingerprint decides what MIGHT be the same job', () => {
  it('the same posting written differently fingerprints identically', () => {
    expect(fingerprintOf(job({ companyName: 'ABC Corp.' }))).toBe(
      fingerprintOf(job({ companyName: 'ABC Corporation' })),
    );
    expect(fingerprintOf(job({ title: 'Backend Engineer (Remote)' }))).toBe(
      fingerprintOf(job({ title: 'Backend Engineer' })),
    );
  });

  it('a different CITY is a different requisition', () => {
    // The rule the spec calls out by name: ABC Seoul and ABC Busan are two
    // openings, and a fingerprint that ignored the city would hide one.
    expect(fingerprintOf(job({ city: 'Seoul' }))).not.toBe(
      fingerprintOf(job({ city: 'Busan' })),
    );
  });

  it('a different COMPANY is never the same job', () => {
    expect(fingerprintOf(job({ companyName: 'ABC Corp' }))).not.toBe(
      fingerprintOf(job({ companyName: 'XYZ Corp' })),
    );
  });

  it('a different employment type is a different opening', () => {
    expect(fingerprintOf(job({ employmentType: 'FULL_TIME' }))).not.toBe(
      fingerprintOf(job({ employmentType: 'CONTRACT' })),
    );
  });

  it('a company DOMAIN outranks the name when one is known', () => {
    // Two employers can share a name; they cannot share a domain.
    const withDomain = fingerprintOf(
      job({ companyWebsiteUrl: 'https://abc.com' }),
    );
    const nameOnly = fingerprintOf(job());
    expect(withDomain).not.toBe(nameOnly);
  });
});

describe('the merge gate decides whether it IS the same job', () => {
  it('same provider and source id is EXACT, always', () => {
    const verdict = assessMerge(
      job(),
      existing({ sources: [{ provider: 'GREENHOUSE', sourceKey: 'gh-1' }] }),
      'gh-1',
    );
    expect(verdict).toMatchObject({ merge: true, confidence: 'EXACT' });
  });

  it('an identical apply URL from another provider is EXACT', () => {
    // An aggregator's copy of an ATS link is still that link.
    const verdict = assessMerge(
      job({
        provider: 'WANTED',
        sourceJobId: 'w-9',
        originalUrl: 'https://boards.greenhouse.io/abc/jobs/1',
      }),
      existing({ canonicalUrl: 'https://boards.greenhouse.io/abc/jobs/1' }),
      'w-9',
    );
    expect(verdict).toMatchObject({ merge: true, confidence: 'EXACT' });
  });

  it('a shared company domain corroborates the fingerprint — HIGH', () => {
    const verdict = assessMerge(
      job({ provider: 'LEVER', companyWebsiteUrl: 'https://abc.com' }),
      existing({ companyDomain: 'abc.com' }),
      'lever-2',
    );
    expect(verdict).toMatchObject({ merge: true, confidence: 'HIGH' });
  });

  it('a specific shared city corroborates it — HIGH', () => {
    const verdict = assessMerge(
      job({ provider: 'WANTED' }),
      existing({ city: 'Seoul' }),
      'w-2',
    );
    expect(verdict).toMatchObject({ merge: true, confidence: 'HIGH' });
  });

  it('name and title alone are POSSIBLE, and do NOT merge', () => {
    // The asymmetry that governs this module: a duplicate is cosmetic and
    // self-correcting; a false merge deletes a real job invisibly.
    const verdict = assessMerge(
      job({ provider: 'SARAMIN', countryCode: null, city: null }),
      existing({ countryCode: null, city: null }),
      's-1',
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.confidence).toBe('POSSIBLE');
    expect(verdict.reason).toContain('nothing corroborates');
  });

  it('no model is consulted anywhere in the decision', () => {
    /*
     * Structural: merging IS deciding which jobs exist, and that is never the
     * model's to decide. Asserted on the module's IMPORTS rather than its
     * prose — the file discusses Gemini at length precisely to say it is not
     * used, and a text search cannot tell the difference.
     */
    const source = readFileSync(join(__dirname, 'dedupe.ts'), 'utf8');
    const importPaths = [...source.matchAll(/from '([^']+)'/g)].map(
      (match) => match[1],
    );

    // Import PATHS, not substrings: `domainOf` contains "ai" and proves
    // nothing either way.
    for (const path of importPaths) {
      expect(path).not.toMatch(/\/(ai|search|qdrant)\b/);
      expect(path.toLowerCase()).not.toContain('gemini');
      expect(path.toLowerCase()).not.toContain('embedding');
    }
    // And nothing is called on a model client, however it were obtained.
    expect(source).not.toMatch(
      /generateContent|matchExplanations|candidateJobMatches/,
    );
  });
});

describe('source identity survives a provider with no ids', () => {
  it('uses the provider id when there is one', () => {
    expect(sourceKeyOf(job({ sourceJobId: 'gh-1' }))).toBe('gh-1');
  });

  it('falls back to a normalized URL, so tracking params cannot duplicate', () => {
    const a = sourceKeyOf(
      job({
        sourceJobId: null,
        sourceUrl: 'https://abc.com/careers/backend?utm_source=x',
      }),
    );
    const b = sourceKeyOf(
      job({
        sourceJobId: null,
        sourceUrl: 'https://abc.com/careers/backend#apply',
      }),
    );
    expect(a).toBe(b);
  });

  it('never returns null, so the unique index can actually constrain', () => {
    expect(
      sourceKeyOf(job({ sourceJobId: null, sourceUrl: 'not-a-url' })),
    ).toBeTruthy();
  });
});

describe('URL equality ignores the noise, not the identity', () => {
  /*
   * There used to be a second, looser URL comparison here that dropped the
   * query string outright. It is gone: `urlIdentity` is now the only rule, so
   * a parameter that IS the job id — Greenhouse's `?gh_jid=`, live on Figma's
   * careers page — cannot be discarded by whichever tier happened to run.
   */
  it('treats www and a trailing slash as noise', () => {
    expect(urlIdentity('https://www.abc.com/jobs/1/')).toBe(
      urlIdentity('https://abc.com/jobs/1'),
    );
  });

  it('does not treat a different path as the same posting', () => {
    expect(urlIdentity('https://abc.com/jobs/1')).not.toBe(
      urlIdentity('https://abc.com/jobs/2'),
    );
  });

  it('keeps a query parameter that may be the job id', () => {
    expect(urlIdentity('https://abc.com/jobs/1?gh_jid=1')).not.toBe(
      urlIdentity('https://abc.com/jobs/1'),
    );
  });
});

/**
 * The rule live Greenhouse data forced.
 *
 * Figma publishes four separate requisitions that all fold to "account
 * executive enterprise"; GitLab publishes "Director, Support (Bengaluru)"
 * beside "Director, Support (EMEA)". Bracketed asides are folded out of titles
 * and neither posting states an office, so the fingerprint matches — and
 * without this rule they would merge, deleting real open jobs.
 */
describe('a provider that issued two ids has said there are two jobs', () => {
  const base = {
    canonicalUrl: 'https://job-boards.greenhouse.io/figma/jobs/5426468004',
    companyDomain: null,
    countryCode: null,
    city: null,
  };

  it('refuses to merge a different id from the same provider', () => {
    const verdict = assessMerge(
      job({
        provider: 'GREENHOUSE',
        sourceJobId: 'figma:5783812004',
        sourceUrl: 'https://job-boards.greenhouse.io/figma/jobs/5783812004',
        originalUrl: 'https://job-boards.greenhouse.io/figma/jobs/5783812004',
      }),
      {
        ...base,
        sources: [{ provider: 'GREENHOUSE', sourceKey: 'figma:5426468004' }],
      },
      'figma:5783812004',
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.confidence).toBe('POSSIBLE');
    expect(verdict.reason).toMatch(/different job id/i);
  });

  it('still merges the SAME id from that provider', () => {
    const verdict = assessMerge(
      job({ provider: 'GREENHOUSE', sourceJobId: 'figma:5426468004' }),
      {
        ...base,
        sources: [{ provider: 'GREENHOUSE', sourceKey: 'figma:5426468004' }],
      },
      'figma:5426468004',
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('outranks a same-city corroboration', () => {
    // City agreement would otherwise be HIGH. The source's own statement that
    // these are two postings beats any similarity we can compute.
    const verdict = assessMerge(
      job({
        provider: 'GREENHOUSE',
        sourceJobId: 'figma:2',
        countryCode: 'GB',
        city: 'London',
        sourceUrl: 'https://job-boards.greenhouse.io/figma/jobs/2',
        originalUrl: 'https://job-boards.greenhouse.io/figma/jobs/2',
      }),
      {
        ...base,
        countryCode: 'GB',
        city: 'London',
        sources: [{ provider: 'GREENHOUSE', sourceKey: 'figma:1' }],
      },
      'figma:2',
    );
    expect(verdict.merge).toBe(false);
  });

  it('leaves cross-provider dedupe alone', () => {
    // A Lever sighting of a job Greenhouse already contributed still merges on
    // a shared apply URL — this rule only fires within one provider.
    const verdict = assessMerge(
      job({
        provider: 'LEVER',
        sourceJobId: 'lv-9',
        sourceUrl: base.canonicalUrl,
        originalUrl: base.canonicalUrl,
      }),
      {
        ...base,
        sources: [{ provider: 'GREENHOUSE', sourceKey: 'figma:5426468004' }],
      },
      'lv-9',
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessMerge, fingerprintOf, sourceKeyOf } from './dedupe';
import { chooseCanonicalUrl, resolveField, resolveSalary } from './field-merge';
import { normalizeGreenhouseJob } from './providers/greenhouse/greenhouse.normalize';
import { normalizeLeverPosting } from './providers/lever/lever.normalize';
import { normalizeAshbyJob } from './providers/ashby/ashby.normalize';
import { normalizeNinehireJob } from './providers/ninehire/ninehire.normalize';
import { normalizeCareersJob } from './providers/company-careers/company-careers.normalize';
import { COMPANY_CAREERS_CATALOGUE } from './providers/company-careers/company-careers.catalogue';
import { urlIdentitiesOf } from './url-identity';
import { resolveClaims, claimsOf, type SourceClaims } from './field-merge';
import type { CareersPageJob } from './providers/company-careers/company-careers.types';
import type { NormalizedExternalJobInput } from './external-job.contract';

/**
 * Two real providers meeting on one job.
 *
 * Everything here starts from a PROVIDER PAYLOAD and runs through the shipped
 * normalizers, because the question is not "does `assessMerge` work" — Task 4A
 * proved that — but whether two independently-written providers produce
 * identities that can actually be compared.
 *
 * The bar is unchanged and deliberately high. A missed merge shows a candidate
 * one job twice and self-corrects the moment a better observation arrives. A
 * wrong merge deletes a job: the second posting stops existing, its apply link
 * points at another company's requisition, and nobody — candidate, recruiter or
 * engineer — can see that it happened. So no threshold is lowered here to make
 * a cross-provider merge happen, and the live analysis reports zero when zero
 * is the truth.
 */

const GH_BOARD = { boardToken: 'acme', label: 'Acme' };
const LV_SITE = { slug: 'acme', label: 'Acme' };

function greenhouse(
  over: Record<string, unknown> = {},
): NormalizedExternalJobInput {
  return normalizeGreenhouseJob(
    {
      id: 5426468004,
      title: 'Staff Backend Engineer',
      absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/5426468004',
      company_name: 'Acme',
      offices: [{ name: 'Seoul', location: 'Seoul, Seoul, South Korea' }],
      content:
        '<p>We are hiring a staff backend engineer for the Seoul team.</p>',
      ...over,
    },
    GH_BOARD,
  )!;
}

function lever(over: Record<string, unknown> = {}): NormalizedExternalJobInput {
  return normalizeLeverPosting(
    {
      id: 'e1f2a3b4',
      text: 'Staff Backend Engineer',
      categories: {
        location: 'Seoul, South Korea',
        commitment: undefined,
        allLocations: ['Seoul, South Korea'],
      },
      country: 'KR',
      descriptionPlain:
        'We are hiring a staff backend engineer for the Seoul team.',
      hostedUrl: 'https://jobs.lever.co/acme/e1f2a3b4',
      applyUrl: 'https://jobs.lever.co/acme/e1f2a3b4/apply',
      ...over,
    },
    LV_SITE,
  )!;
}

/** The shape `assessMerge` compares an incoming sighting against. */
function existingFrom(
  job: NormalizedExternalJobInput,
  over: Partial<Parameters<typeof assessMerge>[1]> = {},
) {
  return {
    canonicalUrl: job.originalUrl ?? job.sourceUrl,
    companyDomain: null,
    countryCode: job.countryCode,
    city: job.city,
    sources: [
      {
        provider: job.provider,
        sourceKey: sourceKeyOf(job),
        urlKeys: urlIdentitiesOf(job),
      },
    ],
    ...over,
  };
}

describe('two providers, one identity space', () => {
  it('produces the same fingerprint for the same job seen twice', () => {
    // Independently written normalizers, one identity. If this drifts, no
    // cross-provider merge can ever happen and nobody would notice.
    expect(fingerprintOf(greenhouse())).toBe(fingerprintOf(lever()));
  });

  it('keeps different companies apart at the same title and city', () => {
    const otherCompany = normalizeLeverPosting(
      {
        id: 'e1f2a3b4',
        text: 'Staff Backend Engineer',
        categories: {
          location: 'Seoul, South Korea',
          allLocations: ['Seoul, South Korea'],
        },
        country: 'KR',
        hostedUrl: 'https://jobs.lever.co/globex/e1f2a3b4',
        applyUrl: 'https://jobs.lever.co/globex/e1f2a3b4/apply',
      },
      { slug: 'globex', label: 'Globex Corporation' },
    )!;
    expect(fingerprintOf(otherCompany)).not.toBe(fingerprintOf(greenhouse()));
  });

  it('gives each provider its own source key', () => {
    expect(sourceKeyOf(greenhouse())).toBe('acme:5426468004');
    expect(sourceKeyOf(lever())).toBe('acme:e1f2a3b4');
  });
});

describe('cross-provider merge: what counts as evidence', () => {
  it('merges on an identical apply URL', () => {
    // The strongest signal there is: one source republishing the other's
    // apply link verbatim. Paths must match — /e1f2a3b4 and /e1f2a3b4/apply
    // are two different pages and are deliberately NOT treated as one.
    const shared = 'https://jobs.lever.co/acme/e1f2a3b4/apply';
    const incoming = greenhouse({ absolute_url: shared });
    const verdict = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
    expect(verdict.reason).toMatch(/same application URL/i);
  });

  it('merges on a shared company domain with title and place agreeing', () => {
    const incoming = greenhouse({
      company: { name: 'Acme', url: 'https://acme.com' },
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(lever(), { companyDomain: 'acme.com' }),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('HIGH');
  });

  it('merges when company, title and a SPECIFIC city agree', () => {
    const incoming = greenhouse();
    expect(incoming.countryCode).toBe('KR');
    expect(incoming.city).toBe('Seoul');
    const verdict = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('HIGH');
  });
});

describe('cross-provider merge: what does NOT count', () => {
  it('refuses on a company name and title alone', () => {
    // "Engineer at Acme, location unstated" describes half a job board.
    const incoming = greenhouse({ offices: [], location: { name: 'Remote' } });
    const bare = normalizeLeverPosting(
      {
        id: 'e1f2a3b4',
        text: 'Staff Backend Engineer',
        categories: { location: 'Remote', allLocations: ['Remote'] },
        country: null,
        hostedUrl: 'https://jobs.lever.co/acme/e1f2a3b4',
        applyUrl: 'https://jobs.lever.co/acme/e1f2a3b4/apply',
      },
      LV_SITE,
    )!;
    const verdict = assessMerge(
      incoming,
      existingFrom(bare),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.confidence).toBe('POSSIBLE');
  });

  it('refuses when the cities differ', () => {
    const incoming = greenhouse({
      offices: [{ name: 'Busan', location: 'Busan, Busan, South Korea' }],
    });
    // Different city means a different fingerprint entirely — these never
    // reach the merge gate, and that is the point.
    expect(fingerprintOf(incoming)).not.toBe(fingerprintOf(lever()));
  });

  it('refuses when only the domain-less company name matches a different city', () => {
    const incoming = greenhouse({ offices: [] });
    const verdict = assessMerge(
      incoming,
      existingFrom(lever(), { city: null, countryCode: null }),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
  });

  it('never merges two postings the SAME provider distinguished', () => {
    // The Task 4B.1 protection, still standing with a second provider in the
    // picture: a source that issued two ids has said there are two postings.
    // A real payload changes the URL alongside the id — the id is IN the URL —
    // so the two do not share an application link, and the same-provider rule
    // is what has to hold the line.
    const incoming = lever({
      id: 'second-posting-id',
      hostedUrl: 'https://jobs.lever.co/acme/second-posting-id',
      applyUrl: 'https://jobs.lever.co/acme/second-posting-id/apply',
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.reason).toMatch(/different job id/i);
  });

  it('still merges a re-observation of the same posting', () => {
    const incoming = lever();
    const verdict = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });
});

describe('no model is consulted', () => {
  it('the dedupe decision is a pure function of stated fields', () => {
    const incoming = greenhouse();
    const first = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    const second = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(first).toEqual(second);
  });
});

describe('field conflict across providers', () => {
  const NOW = new Date('2026-08-24T00:00:00Z');
  const EARLIER = new Date('2026-08-20T00:00:00Z');

  it('a stated salary beats silence, whichever provider is silent', () => {
    const resolved = resolveSalary([
      {
        provider: 'GREENHOUSE',
        observedAt: NOW,
        salaryMin: null,
        salaryMax: null,
        currency: null,
        payPeriod: null,
      },
      {
        provider: 'LEVER',
        observedAt: EARLIER,
        salaryMin: 150_000,
        salaryMax: 180_000,
        currency: 'USD',
        payPeriod: 'YEARLY',
      },
    ]);
    expect(resolved).toMatchObject({ salaryMin: 150_000, currency: 'USD' });
  });

  it('keeps a salary claim atomic across providers', () => {
    // The failure this prevents: an amount from one source and a currency from
    // another, producing "40,000,000 USD".
    const resolved = resolveSalary([
      {
        provider: 'GREENHOUSE',
        observedAt: NOW,
        salaryMin: 40_000_000,
        salaryMax: null,
        currency: 'KRW',
        payPeriod: 'YEARLY',
      },
      {
        provider: 'LEVER',
        observedAt: EARLIER,
        salaryMin: 150_000,
        salaryMax: 180_000,
        currency: 'USD',
        payPeriod: 'YEARLY',
      },
    ]);
    // The whole winning claim, never a blend of the two.
    expect(resolved).toMatchObject({
      salaryMin: 40_000_000,
      salaryMax: null,
      currency: 'KRW',
      payPeriod: 'YEARLY',
      provider: 'GREENHOUSE',
    });
  });

  it('does not rank one ATS above the other', () => {
    // Provider popularity is not data-trust evidence. With equal trust the
    // fresher observation wins, not the alphabetically luckier vendor.
    const leverFresher = resolveField([
      { provider: 'GREENHOUSE', observedAt: EARLIER, value: 'HYBRID' },
      { provider: 'LEVER', observedAt: NOW, value: 'REMOTE' },
    ]);
    const greenhouseFresher = resolveField([
      { provider: 'GREENHOUSE', observedAt: NOW, value: 'HYBRID' },
      { provider: 'LEVER', observedAt: EARLIER, value: 'REMOTE' },
    ]);
    expect(leverFresher.value).toBe('REMOTE');
    expect(leverFresher.provider).toBe('LEVER');
    expect(greenhouseFresher.value).toBe('HYBRID');
    expect(greenhouseFresher.provider).toBe('GREENHOUSE');
  });

  it('prefers a company careers page over either ATS for the apply link', () => {
    const chosen = chooseCanonicalUrl([
      {
        provider: 'LEVER',
        sourceUrl: 'https://jobs.lever.co/acme/e1f2a3b4',
        originalUrl: 'https://jobs.lever.co/acme/e1f2a3b4/apply',
        observedAt: NOW,
      },
      {
        provider: 'COMPANY_CAREERS',
        sourceUrl: 'https://acme.com/careers/staff-backend-engineer',
        originalUrl: null,
        observedAt: EARLIER,
      },
    ]);
    expect(chosen?.url).toBe('https://acme.com/careers/staff-backend-engineer');
  });
});

/**
 * Three providers in one identity space.
 *
 * Ashby joining is the real test of whether the Task 4A identity model is a
 * shared space or three parallel ones that happen to look alike.
 */
describe('Greenhouse, Lever and Ashby share one identity space', () => {
  const ASHBY_BOARD = { slug: 'acme', label: 'Acme' };

  function ashby(
    over: Record<string, unknown> = {},
  ): NormalizedExternalJobInput {
    return normalizeAshbyJob(
      {
        id: 'c3d4e5f6',
        title: 'Staff Backend Engineer',
        employmentType: undefined,
        workplaceType: 'OnSite',
        isListed: true,
        address: {
          postalAddress: {
            addressLocality: 'Seoul',
            addressRegion: '',
            addressCountry: 'South Korea',
          },
        },
        descriptionPlain:
          'We are hiring a staff backend engineer for the Seoul team.',
        jobUrl: 'https://jobs.ashbyhq.com/acme/c3d4e5f6',
        applyUrl: 'https://jobs.ashbyhq.com/acme/c3d4e5f6/application',
        ...over,
      },
      ASHBY_BOARD,
    )!;
  }

  it('all three produce the same fingerprint for the same job', () => {
    // Three independently written normalizers, one identity. If any of them
    // drifts, cross-provider merging silently stops working.
    const fingerprint = fingerprintOf(greenhouse());
    expect(fingerprintOf(lever())).toBe(fingerprint);
    expect(fingerprintOf(ashby())).toBe(fingerprint);
  });

  it('gives each provider its own board-qualified source key', () => {
    expect(sourceKeyOf(ashby())).toBe('acme:c3d4e5f6');
  });

  it('merges an Ashby sighting onto a Greenhouse job on a shared apply URL', () => {
    const shared = 'https://jobs.ashbyhq.com/acme/c3d4e5f6/application';
    const incoming = greenhouse({ absolute_url: shared });
    const verdict = assessMerge(
      incoming,
      existingFrom(ashby()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('merges Ashby onto Lever when company, title and a specific city agree', () => {
    const incoming = ashby();
    const verdict = assessMerge(
      incoming,
      existingFrom(lever()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('HIGH');
  });

  it('refuses an Ashby sighting with no corroborating place', () => {
    const bare = ashby({ address: { postalAddress: {} } });
    const incoming = greenhouse({ offices: [], location: { name: 'Remote' } });
    const verdict = assessMerge(
      incoming,
      existingFrom(bare),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.confidence).toBe('POSSIBLE');
  });

  it('never merges two postings Ashby itself distinguished', () => {
    // The Greenhouse-discovered invariant, holding for a third provider.
    const incoming = ashby({
      id: 'a-second-posting-id',
      jobUrl: 'https://jobs.ashbyhq.com/acme/a-second-posting-id',
      applyUrl: 'https://jobs.ashbyhq.com/acme/a-second-posting-id/application',
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(ashby()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.reason).toMatch(/different job id/i);
  });

  it('keeps different companies apart at the same title and city', () => {
    const other = normalizeAshbyJob(
      {
        id: 'c3d4e5f6',
        title: 'Staff Backend Engineer',
        isListed: true,
        address: {
          postalAddress: {
            addressLocality: 'Seoul',
            addressCountry: 'South Korea',
          },
        },
        jobUrl: 'https://jobs.ashbyhq.com/globex/c3d4e5f6',
      },
      { slug: 'globex', label: 'Globex Corporation' },
    )!;
    expect(fingerprintOf(other)).not.toBe(fingerprintOf(ashby()));
  });

  it('does not rank one ATS above the others', () => {
    const now = new Date('2026-08-24T00:00:00Z');
    const earlier = new Date('2026-08-20T00:00:00Z');
    for (const [fresh, stale] of [
      ['ASHBY', 'GREENHOUSE'],
      ['GREENHOUSE', 'LEVER'],
      ['LEVER', 'ASHBY'],
    ] as const) {
      const resolved = resolveField([
        { provider: stale, observedAt: earlier, value: 'HYBRID' },
        { provider: fresh, observedAt: now, value: 'REMOTE' },
      ]);
      // Freshness decides, because trust is equal — provider popularity is
      // not data-quality evidence.
      expect(resolved.provider).toBe(fresh);
    }
  });
});

/**
 * The fourth provider in the same identity space.
 *
 * Ninehire is authenticated and Korean, which is exactly why it is worth
 * checking: if the identity model only worked for English-language public ATS
 * boards, this is where it would break.
 */
describe('Ninehire joins the same identity space', () => {
  const NH_SOURCE = { scope: 'acme', label: 'Acme' };

  function ninehire(
    over: Record<string, unknown> = {},
  ): NormalizedExternalJobInput {
    return normalizeNinehireJob(
      {
        id: 'd4e5f6a7',
        title: 'Staff Backend Engineer',
        applyUrl: 'https://career.ninehire.com/job_posting/3ETue9oP/apply',
        deadline: null,
        employmentTypes: [],
        jobLocations: [{ name: '본사', address: '서울 강남구 테헤란로 123' }],
        affiliation: 'Acme',
        isPrivate: false,
        status: 'in_progress',
        ...over,
      },
      NH_SOURCE,
    )!;
  }

  it('gives Ninehire a workspace-scoped source key', () => {
    expect(sourceKeyOf(ninehire())).toBe('acme:d4e5f6a7');
  });

  it('never merges two postings Ninehire itself distinguished', () => {
    // The invariant every provider has had to satisfy since Greenhouse.
    const incoming = ninehire({
      id: 'another-posting-id',
      applyUrl: 'https://career.ninehire.com/job_posting/9XYab2Qr/apply',
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(ninehire()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
    expect(verdict.reason).toMatch(/different job id/i);
  });

  it('re-observing the same posting is EXACT', () => {
    const incoming = ninehire();
    const verdict = assessMerge(
      incoming,
      existingFrom(ninehire()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('merges cross-provider on an identical apply URL', () => {
    const shared = 'https://career.ninehire.com/job_posting/3ETue9oP/apply';
    const incoming = greenhouse({ absolute_url: shared });
    const verdict = assessMerge(
      incoming,
      existingFrom(ninehire()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('keeps a Korean-city posting apart from a Seoul-in-English one only by evidence', () => {
    /*
     * A Korean address resolves to 서울/강남구 while a Greenhouse office
     * resolves to "Seoul". Those are different city strings, so the
     * fingerprints differ and the two never reach the merge gate — a
     * limitation worth stating plainly rather than papering over with
     * transliteration, which would be exactly the guessing this product
     * refuses.
     */
    const korean = ninehire();
    const english = greenhouse();
    expect(korean.city).toBe('강남구');
    expect(english.city).toBe('Seoul');
    expect(fingerprintOf(korean)).not.toBe(fingerprintOf(english));
  });

  it('does not rank the authenticated provider above the public ones', () => {
    const now = new Date('2026-08-24T00:00:00Z');
    const earlier = new Date('2026-08-20T00:00:00Z');
    for (const [fresh, stale] of [
      ['NINEHIRE', 'GREENHOUSE'],
      ['ASHBY', 'NINEHIRE'],
      ['NINEHIRE', 'LEVER'],
    ] as const) {
      const resolved = resolveField([
        { provider: stale, observedAt: earlier, value: 'HYBRID' },
        { provider: fresh, observedAt: now, value: 'REMOTE' },
      ]);
      // Equal trust: freshness decides, not which API needed a key.
      expect(resolved.provider).toBe(fresh);
    }
  });
});

// ---------------------------------------------------------------------------
// The company careers page and the ATS behind it
// ---------------------------------------------------------------------------

const VERCEL_SOURCE = COMPANY_CAREERS_CATALOGUE.find(
  (source) => source.sourceId === 'vercel-careers',
)!;
const LINEAR_SOURCE = COMPANY_CAREERS_CATALOGUE.find(
  (source) => source.sourceId === 'linear-careers',
)!;

function careersPage(over: Partial<CareersPageJob> = {}): CareersPageJob {
  return {
    pageUrl: 'https://vercel.com/careers/engineering-manager-cdn-5701765004',
    title: 'Engineering Manager, CDN',
    applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/5701765004',
    locationText: null,
    countryCode: null,
    region: null,
    city: null,
    additionalLocations: [],
    description: null,
    employmentTypeRaw: null,
    workModeRaw: null,
    remoteCountriesAllowed: [],
    salaryMin: null,
    salaryMax: null,
    currency: null,
    payPeriodRaw: null,
    validThrough: null,
    datePosted: null,
    companyName: null,
    companyWebsiteUrl: null,
    ...over,
  };
}

function careers(
  over: Partial<CareersPageJob> = {},
): NormalizedExternalJobInput {
  return normalizeCareersJob(careersPage(over), VERCEL_SOURCE)!;
}

/** A Greenhouse sighting of the requisition that careers page applies to. */
function vercelGreenhouse(id = '5701765004'): NormalizedExternalJobInput {
  return normalizeGreenhouseJob(
    {
      id: Number(id),
      title: 'Engineering Manager, CDN',
      absolute_url: `https://job-boards.greenhouse.io/vercel/jobs/${id}`,
      updated_at: '2026-08-18T18:06:19-04:00',
      location: { name: 'San Francisco' },
      content:
        '<p>Own the CDN team and its roadmap for the next two years. You ' +
        'will set the direction for edge caching and lead a group of six.</p>',
      offices: [
        {
          name: 'San Francisco',
          location: 'San Francisco, California, United States',
        },
      ],
      metadata: [],
    },
    { boardToken: 'vercel', label: 'Vercel' },
  )!;
}

describe('a company careers page merging with its ATS', () => {
  it('shares NO fingerprint with the ATS sighting', () => {
    /*
     * The reason URL identity exists. The page says "Vercel" with a domain and
     * states no city; the board says "Vercel" with no domain and resolves a
     * city out of an office name. Three of the four fingerprint components
     * disagree, so the fingerprint lookup can never find this pair — which is
     * why ingestion falls back to an indexed apply-URL lookup.
     */
    expect(fingerprintOf(careers())).not.toBe(
      fingerprintOf(vercelGreenhouse()),
    );
  });

  it('merges EXACT on the shared application URL', () => {
    const incoming = careers();
    const verdict = assessMerge(
      incoming,
      existingFrom(vercelGreenhouse()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
    expect(verdict.reason).toMatch(/same application URL/i);
  });

  it('merges in either direction', () => {
    // The ATS may be ingested after the careers page as easily as before it.
    const incoming = vercelGreenhouse();
    const verdict = assessMerge(
      incoming,
      existingFrom(careers()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('ignores tracking noise on the apply link', () => {
    const incoming = careers({
      applyUrl:
        'https://job-boards.greenhouse.io/vercel/jobs/5701765004?utm_source=careers-page',
    });
    expect(
      assessMerge(
        incoming,
        existingFrom(vercelGreenhouse()),
        sourceKeyOf(incoming),
      ).merge,
    ).toBe(true);
  });

  it('keeps an identity query parameter significant', () => {
    /*
     * `?gh_jid=` is the Greenhouse requisition id, live on Figma's careers
     * page. It is not tracking, so a URL carrying a DIFFERENT one is a
     * different posting.
     */
    const incoming = careers({
      applyUrl:
        'https://job-boards.greenhouse.io/vercel/jobs/5701765004?gh_jid=9999999999',
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(vercelGreenhouse()),
      sourceKeyOf(incoming),
    );
    expect(verdict.confidence).not.toBe('EXACT');
  });

  it('refuses a merge on the ATS HOST alone', () => {
    // Every Vercel posting lives on job-boards.greenhouse.io. Sharing a
    // hostname is sharing an ATS vendor, not a requisition.
    const incoming = careers({
      pageUrl: 'https://vercel.com/careers/staff-designer-6000000004',
      title: 'Staff Designer',
      applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/6000000004',
    });
    const verdict = assessMerge(
      incoming,
      existingFrom(vercelGreenhouse()),
      sourceKeyOf(incoming),
    );
    expect(verdict.merge).toBe(false);
  });

  it('outranks the same-provider-different-id refusal', () => {
    /*
     * Live: Vercel publishes three careers URLs — `…accounts-5430088004`,
     * `…accounts-us-5430088004` and `…backend-us-5430088004` — that all apply
     * at Greenhouse requisition 5430088004.
     *
     * The same-provider rule would call the second and third "a different id
     * from the same provider" and split one job into three. That rule is a
     * PROXY for how many postings exist; here the employer's own requisition
     * id answers directly, and says one.
     */
    const first = careers({
      pageUrl:
        'https://vercel.com/careers/software-engineer-accounts-5430088004',
      title: 'Software Engineer, Accounts',
      applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/5430088004',
    });
    const second = careers({
      pageUrl:
        'https://vercel.com/careers/software-engineer-backend-us-5430088004',
      title: 'Software Engineer, Backend',
      applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/5430088004',
    });
    expect(sourceKeyOf(first)).not.toBe(sourceKeyOf(second));

    const verdict = assessMerge(
      second,
      existingFrom(first),
      sourceKeyOf(second),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });

  it('still refuses two company pages with genuinely different apply links', () => {
    const us = careers({
      pageUrl: 'https://vercel.com/careers/backend-engineer-us-1',
      title: 'Backend Engineer',
      applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/1',
    });
    const eu = careers({
      pageUrl: 'https://vercel.com/careers/backend-engineer-eu-2',
      title: 'Backend Engineer',
      applyUrl: 'https://job-boards.greenhouse.io/vercel/jobs/2',
    });
    const verdict = assessMerge(eu, existingFrom(us), sourceKeyOf(eu));
    expect(verdict.merge).toBe(false);
    expect(verdict.confidence).toBe('POSSIBLE');
  });

  it('records a case-only URL difference instead of merging it', () => {
    /*
     * Live and unresolved. Linear's careers page publishes
     * jobs.ashbyhq.com/Linear/{id}; the Ashby posting API, asked for the board
     * under its configured lowercase name, answers jobs.ashbyhq.com/linear/{id}
     * for the same posting.
     *
     * Almost certainly one job — and still not merged, because the rule that
     * would merge it (fold path case) is unsafe on every case-sensitive server
     * everywhere. Recorded with a reason that names the cause, so it is
     * visible rather than lost among ordinary near-misses.
     */
    const id = '069c4628-88d7-4e4d-b393-c996fc7f3076';
    const page = normalizeCareersJob(
      careersPage({
        pageUrl: `https://linear.app/careers/${id}`,
        title: 'Account Executive, Enterprise',
        applyUrl: `https://jobs.ashbyhq.com/Linear/${id}`,
      }),
      LINEAR_SOURCE,
    )!;
    const ashby = normalizeAshbyJob(
      {
        id,
        title: 'Account Executive, Enterprise',
        jobUrl: `https://jobs.ashbyhq.com/linear/${id}`,
        applyUrl: `https://jobs.ashbyhq.com/linear/${id}/application`,
        employmentType: 'FullTime',
        isListed: true,
        isRemote: true,
        publishedAt: '2026-08-01T00:00:00Z',
        descriptionPlain: 'Sell Linear to enterprises across North America.',
        secondaryLocations: [],
      },
      { slug: 'linear', label: 'Linear' },
    )!;

    const verdict = assessMerge(page, existingFrom(ashby), sourceKeyOf(page));
    expect(verdict.merge).toBe(false);
    expect(verdict.reason).toMatch(/different letter case/i);
  });
});

describe('one job, two provenance rows', () => {
  const now = new Date('2026-08-24T00:00:00Z');
  const earlier = new Date('2026-08-20T00:00:00Z');

  it('sends the candidate to the company page when it has one', () => {
    /*
     * Source trust decides the apply link and nothing else. A careers page is
     * the employer speaking; an ATS is the system they bought.
     */
    const chosen = chooseCanonicalUrl([
      {
        provider: 'GREENHOUSE',
        sourceUrl: 'https://job-boards.greenhouse.io/vercel/jobs/5701765004',
        originalUrl: null,
        observedAt: now,
      },
      {
        provider: 'COMPANY_CAREERS',
        sourceUrl:
          'https://vercel.com/careers/engineering-manager-cdn-5701765004',
        originalUrl: 'https://job-boards.greenhouse.io/vercel/jobs/5701765004',
        observedAt: earlier,
      },
    ]);
    expect(chosen?.provider).toBe('COMPANY_CAREERS');
    // Its APPLY url — the form, not the description page.
    expect(chosen?.url).toBe(
      'https://job-boards.greenhouse.io/vercel/jobs/5701765004',
    );
  });

  it('lets the ATS keep supplying everything the page did not state', () => {
    /*
     * The whole point of multi-source: the company page contributes
     * provenance and identity, the ATS contributes structure, and neither
     * pretends to be the other. Higher trust must not turn silence into an
     * answer.
     */
    const resolved = resolveClaims([
      {
        provider: 'GREENHOUSE',
        observedAt: earlier,
        claims: claimsOf(vercelGreenhouse()) as unknown as SourceClaims,
      },
      {
        provider: 'COMPANY_CAREERS',
        observedAt: now,
        claims: claimsOf(careers()) as unknown as SourceClaims,
      },
    ]);

    expect(resolved.description).toContain('CDN team');
    expect(resolved.countryCode).toBe('US');
    expect(resolved.title).toBe('Engineering Manager, CDN');
  });

  it('lets a company page WIN a field it actually stated', () => {
    const stated = resolveClaims([
      {
        provider: 'GREENHOUSE',
        observedAt: now,
        claims: {
          ...(claimsOf(vercelGreenhouse()) as unknown as SourceClaims),
          employmentType: 'CONTRACT',
        },
      },
      {
        provider: 'COMPANY_CAREERS',
        observedAt: earlier,
        claims: {
          ...(claimsOf(
            careers({ employmentTypeRaw: 'FULL_TIME' }),
          ) as unknown as SourceClaims),
        },
      },
    ]);
    // Higher trust, older observation — trust decides between two STATED facts.
    expect(stated.employmentType).toBe('FULL_TIME');
  });

  it('never blends two salary claims', () => {
    const resolved = resolveClaims([
      {
        provider: 'GREENHOUSE',
        observedAt: now,
        claims: {
          ...(claimsOf(vercelGreenhouse()) as unknown as SourceClaims),
          salaryMin: 180_000,
          salaryMax: 220_000,
          currency: 'USD',
          payPeriod: 'YEARLY',
        },
      },
      {
        provider: 'COMPANY_CAREERS',
        observedAt: earlier,
        claims: {
          ...(claimsOf(careers()) as unknown as SourceClaims),
          salaryMin: 240_000_000,
          salaryMax: 300_000_000,
          currency: 'KRW',
          payPeriod: 'YEARLY',
        },
      },
    ]);
    // One statement travels whole. "240,000,000 USD" is how the other way ends.
    expect(resolved.currency).toBe('KRW');
    expect(resolved.salaryMin).toBe(240_000_000);
    expect(resolved.salaryMax).toBe(300_000_000);
  });

  it('does not let trust touch anything a candidate is ranked by', () => {
    /*
     * Source trust decides canonical URLs and field conflicts. It must never
     * reach a score, or the product would be ranking employers by which ATS
     * they bought.
     */
    const source = readFileSync(
      join(__dirname, 'external-job-features.ts'),
      'utf8',
    );
    expect(source).not.toContain('sourceTrust');
    expect(source).not.toContain('SOURCE_TRUST');
    expect(source).not.toContain('COMPANY_CAREERS');
  });
});

describe('an employer changing ATS', () => {
  const id = '5701765004';

  it('keeps the careers source identity when its apply link changes', () => {
    // The company page is the same page. Its identity is its own URL, so a
    // new apply destination updates the sighting rather than forking it.
    const before = careers();
    const after = careers({
      applyUrl: 'https://jobs.ashbyhq.com/vercel/aaaa-bbbb-cccc-dddd',
    });
    expect(sourceKeyOf(after)).toBe(sourceKeyOf(before));
    expect(after.originalUrl).not.toBe(before.originalUrl);
  });

  it('never rewrites the old ATS sighting as the new one', () => {
    /*
     * Provenance is immutable per source row. A Greenhouse sighting stays a
     * Greenhouse sighting: the requisition it saw existed, whatever the
     * employer migrated to afterwards. The old board simply stops listing it
     * and the generic absence rule retires THAT source.
     */
    const greenhouseSighting = vercelGreenhouse(id);
    expect(greenhouseSighting.provider).toBe('GREENHOUSE');
    expect(greenhouseSighting.sourceUrl).toContain('greenhouse.io');

    const migrated = careers({
      applyUrl: 'https://jobs.ashbyhq.com/vercel/aaaa-bbbb-cccc-dddd',
    });
    // The migrated page no longer shares a URL with the Greenhouse sighting,
    // so it does not merge onto it by URL...
    const verdict = assessMerge(
      migrated,
      existingFrom(greenhouseSighting),
      sourceKeyOf(migrated),
    );
    expect(verdict.confidence).not.toBe('EXACT');
    // ...and nothing anywhere turns one provider's row into another's.
    expect(migrated.provider).toBe('COMPANY_CAREERS');
  });

  it('lets the NEW ATS sighting merge on the new shared URL', () => {
    const migrated = careers({
      applyUrl: 'https://jobs.ashbyhq.com/vercel/aaaa-bbbb-cccc-dddd',
    });
    const ashby = normalizeAshbyJob(
      {
        id: 'aaaa-bbbb-cccc-dddd',
        title: 'Engineering Manager, CDN',
        jobUrl: 'https://jobs.ashbyhq.com/vercel/aaaa-bbbb-cccc-dddd',
        applyUrl:
          'https://jobs.ashbyhq.com/vercel/aaaa-bbbb-cccc-dddd/application',
        employmentType: 'FullTime',
        isListed: true,
        publishedAt: '2026-08-20T00:00:00Z',
        descriptionPlain: 'Own the CDN team and its roadmap for two years.',
        secondaryLocations: [],
      },
      { slug: 'vercel', label: 'Vercel' },
    )!;

    const verdict = assessMerge(
      ashby,
      existingFrom(migrated),
      sourceKeyOf(ashby),
    );
    expect(verdict.merge).toBe(true);
    expect(verdict.confidence).toBe('EXACT');
  });
});

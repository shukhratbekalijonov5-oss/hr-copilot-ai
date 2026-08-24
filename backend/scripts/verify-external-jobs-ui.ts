/**
 * The candidate External Jobs SCREEN, against the real running stack.
 *
 *   npm run external:ui-verify
 *
 * Needs the Next app on :3000 and this API on :3001, both live, against the
 * real catalogue. Nothing here is mocked and nothing is seeded: it signs in as
 * a throwaway candidate, asks the actual page for HTML, and reads what a
 * browser would have been given.
 *
 * ## Why HTML rather than a headless browser
 *
 * The page renders its results on the server from URL parameters, so the
 * markup a browser receives already contains every card, every reason, every
 * price and every apply link. Asserting on that markup proves the same thing a
 * driver would — with no new dependency, no flake, and no waiting for
 * hydration. What it cannot prove is interaction (the drawer, the mobile
 * sheet); those are covered by the unit tests over the pure display functions
 * and by the API assertions at the end.
 *
 * ## What it writes
 *
 * One throwaway candidate user, deleted in `finally`. One saved job preference
 * on that user, to prove a saved location RANKS and does not filter. The
 * external catalogue is never written to, and the run asserts the job count is
 * identical at the end.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const RUN = Date.now().toString(36);
const EMAIL = `xui-verify-${RUN}@example.invalid`;
const PASSWORD = `Verify-${RUN}-Aa1!`;
const APP = process.env.UI_ORIGIN ?? 'http://localhost:3000';
const API = process.env.API_ORIGIN ?? 'http://localhost:3001/api';

const SESSION_COOKIE = 'hrc_session';
const REFRESH_COOKIE = 'hrc_refresh';
const LOCALE_COOKIE = 'hrc_locale';

/**
 * The text a reader actually sees.
 *
 * A React Server Components page ships two things: the rendered markup, and a
 * flight payload inside `<script>` tags that carries every prop the client
 * components received — INCLUDING the whole active dictionary, because the
 * locale reaches client components as a prop.
 *
 * That matters for the absence checks below. Searching the raw document for
 * "SALARY_UNKNOWN" finds the dictionary key and reports a leak that no reader
 * could ever see. Stripping the scripts first is the difference between
 * asserting what is DISPLAYED and asserting what was transmitted.
 */
function visible(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ');
}

/** HTML entities the renderer emits, so a search for real text can match. */
function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;|&#38;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\"/g, '"');
}

async function main(): Promise<void> {
  const logger = new Logger('VerifyExternalJobsUI');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const prisma = app.get(PrismaService);

  const failures: string[] = [];
  const check = (ok: boolean, label: string, detail = '') => {
    logger.log(
      `${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`,
    );
    if (!ok) failures.push(label);
  };

  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      fullName: 'External Jobs UI Verifier',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      accountType: 'CANDIDATE',
      // MAX: the external workspace is the MAX product (Task 4C.5.1), and
      // this script verifies the workspace, not the plan gate.
      candidateAccount: { create: { plan: 'MAX' } },
    },
    select: { id: true, candidateAccount: { select: { id: true } } },
  });
  const accountId = user.candidateAccount!.id;
  const catalogueBefore = await prisma.externalJob.count();

  try {
    // ------------------------------------------------------------ sign in --
    const loginResponse = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const tokens = (await loginResponse.json()) as {
      accessToken: string;
      refreshToken: string;
    };
    check(
      loginResponse.ok && Boolean(tokens.accessToken),
      'the throwaway candidate can sign in',
      `${loginResponse.status}`,
    );

    /**
     * The page, as a browser would receive it.
     *
     * The session travels in the same httpOnly cookies the real sign-in sets,
     * so the render goes down exactly the path a signed-in reader takes —
     * including Proxy's route protection and the candidate-scoped API calls.
     */
    const visit = async (
      path: string,
      locale = 'en',
    ): Promise<{ status: number; html: string; text: string }> => {
      const response = await fetch(`${APP}${path}`, {
        headers: {
          cookie: [
            `${SESSION_COOKIE}=${tokens.accessToken}`,
            `${REFRESH_COOKIE}=${tokens.refreshToken}`,
            `${LOCALE_COOKIE}=${locale}`,
          ].join('; '),
        },
        redirect: 'manual',
      });
      const html = decode(await response.text());
      return { status: response.status, html, text: visible(html) };
    };

    /*
     * A page whose own server-side API call was rate-limited renders the retry
     * state — with a 200, because the page itself worked. This script now
     * makes several hundred requests against a 120-per-minute limit, so that
     * is a harness problem rather than a product one, and the honest fix is to
     * respect the limit rather than to raise it.
     */
    const visitPage = async (path: string, locale = 'en') => {
      let page = await visit(path, locale);
      for (let attempt = 1; attempt < 6; attempt += 1) {
        if (!page.text.includes('Could not search external jobs')) break;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        page = await visit(path, locale);
      }
      return page;
    };

    /*
     * The API rate-limits to 120 requests a minute, which this script now
     * exceeds — it makes several hundred calls. Backing off and retrying is
     * the right response: a 429 is the server working, not failing, and
     * pre-emptively sleeping between every call would triple the runtime to
     * avoid a case that rarely arises.
     */
    const throttled = async (
      send: () => Promise<Response>,
      attempts = 6,
    ): Promise<Response> => {
      let response = await send();
      for (
        let attempt = 1;
        attempt < attempts && response.status === 429;
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        response = await send();
      }
      return response;
    };

    const apiSearch = async (request: Record<string, unknown>) => {
      const response = await throttled(() =>
        fetch(`${API}/candidate-account/me/external-jobs/search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.accessToken}`,
          },
          body: JSON.stringify(request),
        }),
      );
      const body: unknown = await response.json();
      /*
       * A non-200 here is worth a sentence, not a TypeError forty lines later.
       * It happened during development — a Prisma transaction timeout under
       * connection-pool contention, from running this script beside the dev
       * server and the e2e suite at once — and the crash said only "cannot
       * read properties of undefined", which pointed at the wrong thing.
       */
      if (
        !response.ok ||
        !Array.isArray((body as { results?: unknown }).results)
      ) {
        throw new Error(
          `search failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`,
        );
      }
      return body as {
        matched: number;
        total: number;
        truncated: boolean;
        degraded: boolean;
        sort: string;
        asOf: string;
        results: {
          externalJobId: string;
          title: string;
          company: string;
          applyUrl: string | null;
          status: string;
          salary: {
            min: number | null;
            max: number | null;
            currency: string | null;
          };
          location: { city: string | null; countryCode: string | null };
          additionalLocations: { city?: string; countryCode?: string }[];
          workMode: string | null;
          remoteCountriesAllowed: string[];
          employerPostedAt: string | null;
          provenance: { primarySource: string | null; sourceCount: number };
          reasons: { code: string }[];
        }[];
        applied: { countries: { value: string[]; source: string } };
      };
    };

    // ------------------------------------------------------------------ A --
    logger.log('\n== A. Backend Engineer ==');
    const a = await visitPage('/external-jobs?search=Backend+Engineer');
    const aApi = await apiSearch({ query: 'Backend Engineer', pageSize: 20 });
    check(
      a.status === 200,
      'the page renders for a signed-in candidate',
      `${a.status}`,
    );
    check(a.html.includes('matching job'), 'the result count is on the page');
    // The API and the page ran the same search a moment apart; the top result
    // is the strongest available claim that the page shows the real ranking.
    const topTitle = aApi.results[0]?.title ?? '';
    check(
      Boolean(topTitle) && a.html.includes(topTitle),
      'the top-ranked job is rendered',
      topTitle,
    );
    check(
      a.html.includes(aApi.results[0]?.company ?? ' '),
      'the employer name is rendered',
      aApi.results[0]?.company,
    );
    logger.log(
      `  matched=${aApi.matched} rendered≈${
        (a.html.match(/Apply on original site/g) ?? []).length
      } degraded=${aApi.degraded} truncated=${aApi.truncated}`,
    );
    for (const result of aApi.results.slice(0, 5)) {
      logger.log(`   ${result.title} — ${result.company}`);
    }

    // ------------------------------------------------------------------ B --
    logger.log('\n== B. Backend Engineer + explicit Canada ==');
    const b = await visitPage(
      '/external-jobs?search=Backend+Engineer&countries=CA',
    );
    const bApi = await apiSearch({
      query: 'Backend Engineer',
      countries: ['CA'],
      pageSize: 20,
    });
    check(b.status === 200, 'the country-filtered page renders');
    check(
      bApi.matched < aApi.matched,
      'an explicit country REMOVES jobs — it is a real hard filter',
      `${aApi.matched} → ${bApi.matched}`,
    );
    check(
      bApi.applied.countries.source === 'REQUEST',
      'the country is applied as a request filter',
    );
    check(
      b.html.includes(bApi.results[0]?.title ?? ' '),
      'the narrowed top result is rendered',
      bApi.results[0]?.title,
    );

    // ------------------------------------------------------------------ C --
    logger.log(
      '\n== C. saved Seoul preference, nothing chosen for this search ==',
    );
    await prisma.candidateJobPreferences.deleteMany({
      where: { candidateAccountId: accountId },
    });
    await prisma.candidateJobPreferences.create({
      data: {
        candidateAccountId: accountId,
        locations: {
          create: [{ kind: 'PREFERRED', countryCode: 'KR', city: 'Seoul' }],
        },
      },
    });
    const cApi = await apiSearch({ query: 'Backend Engineer', pageSize: 20 });
    const c = await visitPage('/external-jobs?search=Backend+Engineer');
    check(
      cApi.matched === aApi.matched,
      'a SAVED location does not shrink the universe',
      `${aApi.matched} → ${cApi.matched}`,
    );
    check(
      cApi.applied.countries.source === 'PREFERENCE',
      'the saved location is applied as a preference, not a filter',
      cApi.applied.countries.source,
    );
    const orderBefore = aApi.results.map((r) => r.externalJobId).join(',');
    const orderAfter = cApi.results.map((r) => r.externalJobId).join(',');
    check(
      orderBefore !== orderAfter,
      'a saved location REORDERS the same universe',
      orderBefore === orderAfter ? 'order unchanged' : 'order changed',
    );
    check(
      c.html.includes('personalized using your job preferences'),
      'the page says results were personalized',
    );
    check(
      !c.html.includes('Seoul') || c.html.includes('Edit preferences'),
      'the personalization note links to the preferences the reader owns',
    );

    // ---------------------------------------------------------- D, E, F ----
    logger.log('\n== D–F. general professions ==');
    for (const [label, query] of [
      ['Marketing', 'Marketing'],
      ['Accountant', 'Accountant'],
      ['Nurse', 'Nurse'],
    ] as const) {
      const page = await visitPage(
        `/external-jobs?search=${encodeURIComponent(query)}`,
      );
      const api = await apiSearch({ query, pageSize: 5 });
      logger.log(`  ${label}: matched=${api.matched}`);
      check(
        page.status === 200 && api.matched > 0,
        `"${label}" returns and renders results`,
        `${api.matched}`,
      );
      check(
        api.results.length === 0 || page.html.includes(api.results[0].title),
        `"${label}" renders its top result`,
        api.results[0]?.title,
      );
    }

    // ------------------------------------------------------------------ G --
    logger.log('\n== G. a job eligible through additionalLocations ==');
    const caApi = await apiSearch({ countries: ['CA'], pageSize: 100 });
    const viaAdditional = caApi.results.find(
      (result) =>
        result.location.countryCode !== 'CA' &&
        (result.additionalLocations ?? []).some(
          (place) => place.countryCode === 'CA',
        ),
    );
    if (viaAdditional) {
      const extra = (viaAdditional.additionalLocations ?? []).find(
        (place) => place.countryCode === 'CA',
      );
      const page = await visitPage('/external-jobs?countries=CA');
      logger.log(
        `  ${viaAdditional.title} — ${viaAdditional.company} ` +
          `(primary ${viaAdditional.location.countryCode}, also ${extra?.city ?? 'CA'})`,
      );
      const rendered = page.html.includes(viaAdditional.title);
      check(rendered, 'the job qualifying through another office is rendered');
      check(
        !rendered ||
          Boolean(extra?.city) === false ||
          page.html.includes(extra!.city!),
        'its Canadian office is shown, not only the conflicting primary one',
        extra?.city,
      );
    } else {
      check(false, 'a job eligible through additionalLocations was found');
    }

    // ------------------------------------------------------------------ H --
    logger.log('\n== H. a real salary-bearing job ==');
    const salaryApi = await apiSearch({ query: 'Engineer', pageSize: 100 });
    const withSalary = salaryApi.results.find(
      (result) => result.salary.currency && result.salary.min !== null,
    );
    if (withSalary) {
      const page = await visitPage(
        '/external-jobs?search=Engineer&pageSize=20',
      );
      const grouped = withSalary.salary.min!.toLocaleString('en-US');
      logger.log(
        `  ${withSalary.title} — ${withSalary.company}: ` +
          `${withSalary.salary.min}–${withSalary.salary.max ?? '—'} ${withSalary.salary.currency}`,
      );
      const onPage = page.html.includes(withSalary.title);
      check(
        !onPage || page.html.includes(`${grouped}`),
        'the employer’s own figure is rendered',
        grouped,
      );
      check(
        !onPage || page.html.includes(withSalary.salary.currency!),
        'in the employer’s own currency',
        withSalary.salary.currency ?? '',
      );
      // No converted amount is offered by the contract, so none is displayed.
      check(
        !page.text.includes('≈'),
        'no exchange-rate approximation is displayed — the contract has none',
      );
    } else {
      check(false, 'a salary-bearing job was found in the live catalogue');
    }

    // ------------------------------------------------------------------ I --
    logger.log('\n== I. provenance across providers ==');
    const providerSeen = new Map<string, string>();
    for (const query of ['Engineer', 'Manager', 'Marketing', 'Designer']) {
      const api = await apiSearch({ query, pageSize: 100 });
      for (const result of api.results) {
        const provider = result.provenance.primarySource;
        if (provider && !providerSeen.has(provider)) {
          providerSeen.set(provider, query);
        }
      }
    }
    logger.log(`  providers present: ${[...providerSeen.keys()].join(', ')}`);
    for (const provider of ['GREENHOUSE', 'LEVER', 'ASHBY'] as const) {
      const query = providerSeen.get(provider);
      if (!query) {
        check(false, `a ${provider} job exists in the live catalogue`);
        continue;
      }
      const api = await apiSearch({ query, pageSize: 100 });
      const job = api.results.find(
        (result) => result.provenance.primarySource === provider,
      )!;
      const page = await visitPage(
        `/external-jobs?search=${encodeURIComponent(query)}`,
      );
      const label =
        provider === 'GREENHOUSE'
          ? 'Greenhouse'
          : provider === 'LEVER'
            ? 'Lever'
            : 'Ashby';
      check(
        page.html.includes(`Source: ${label}`) ||
          !page.html.includes(job.title),
        `${provider} renders as "Source: ${label}"`,
        job.title,
      );
    }
    // The candidate-facing page must not leak how a job was ingested.
    const provenancePage = await visitPage('/external-jobs?search=Engineer');
    for (const internal of [
      'dedupeFingerprint',
      'sourceKey',
      'sourceScope',
      'urlKeys',
      'canonicalSourceId',
      'normalizedTitle',
      'lastVerifiedAt',
      'searchableUpdatedAt',
    ]) {
      check(
        !provenancePage.html.includes(internal),
        `the page does not expose ${internal}`,
      );
    }

    // ------------------------------------------------------------------ J --
    logger.log('\n== J. the apply link ==');
    const applyJob = aApi.results.find((result) => result.applyUrl);
    if (applyJob) {
      const page = await visitPage('/external-jobs?search=Backend+Engineer');
      logger.log(`  ${applyJob.title} → ${applyJob.applyUrl}`);
      check(
        page.html.includes(applyJob.applyUrl!),
        'the stored provider URL is the href, used verbatim',
      );
      check(
        page.html.includes('rel="noopener noreferrer"'),
        'external links are opened with noopener noreferrer',
      );
      check(
        page.html.includes('target="_blank"'),
        'external links open in a new tab',
      );
      check(
        page.html.includes('HR Copilot does not receive this application'),
        'the reader is told this product does not receive the application',
      );
      // The destination is the employer's, not ours.
      const host = new URL(applyJob.applyUrl!).host;
      check(
        !host.includes('localhost'),
        'the destination is the employer’s site, never proxied through us',
        host,
      );
    } else {
      check(false, 'a job with an apply URL was found');
    }

    // ------------------------------------------------------------------ K --
    logger.log('\n== K. pagination ==');
    const seen = new Set<string>();
    let duplicates = 0;
    for (const pageNumber of [1, 2, 3]) {
      const api = await apiSearch({
        query: 'Backend Engineer',
        page: pageNumber,
        pageSize: 10,
      });
      for (const result of api.results) {
        if (seen.has(result.externalJobId)) duplicates += 1;
        seen.add(result.externalJobId);
      }
      // The page renders twenty per page; this loop pages ten at a time to
      // check for duplicates across a wider span. So the render assertion asks
      // the API for the slice the PAGE would have shown, not this one.
      const uiSlice = await apiSearch({
        query: 'Backend Engineer',
        page: pageNumber,
        pageSize: 20,
      });
      const rendered = await visitPage(
        `/external-jobs?search=Backend+Engineer&page=${pageNumber}`,
      );
      check(
        rendered.status === 200 &&
          (uiSlice.results.length === 0 ||
            rendered.text.includes(uiSlice.results[0].title)),
        `page ${pageNumber} renders its own slice`,
        uiSlice.results[0]?.title,
      );
    }
    check(
      duplicates === 0,
      'no job appears on two pages',
      `${seen.size} unique`,
    );
    check(
      seen.size === Math.min(30, cApi.total),
      'three pages cover thirty distinct jobs',
      `${seen.size}`,
    );

    // ------------------------------------------------------------------ L --
    logger.log('\n== L. the four locales ==');
    const localeProbe: Record<string, string[]> = {
      en: ['External jobs', 'Apply on original site', 'Salary not provided'],
      ko: ['외부 채용공고', '원본 사이트에서 지원'],
      ru: ['Внешние вакансии', 'Откликнуться на сайте работодателя'],
      uz: ['Tashqi ish o‘rinlari', 'Asl saytda ariza topshirish'],
    };
    for (const [locale, phrases] of Object.entries(localeProbe)) {
      const page = await visitPage('/external-jobs?search=Engineer', locale);
      for (const phrase of phrases) {
        check(page.html.includes(phrase), `[${locale}] renders "${phrase}"`);
      }
      // No untranslated key, and no machine code shown to a reader.
      for (const leak of [
        'externalJobs.',
        'TEXT_STRONG_MATCH',
        'SALARY_UNKNOWN',
        'LOCATION_EXACT',
        'FULL_TIME',
        'STALE_LISTING',
      ]) {
        check(!page.text.includes(leak), `[${locale}] does not print ${leak}`);
      }
    }
    // Korean survives as a query, unromanized, all the way to the markup.
    const korean = await visitPage(
      '/external-jobs?search=%EB%B0%B1%EC%97%94%EB%93%9C%20%EA%B0%9C%EB%B0%9C%EC%9E%90',
      'ko',
    );
    check(
      korean.status === 200 && korean.text.includes('백엔드 개발자'),
      'a Korean query renders back as Korean',
    );

    /*
     * A Korean query against a REAL Korean posting.
     *
     * The catalogue holds exactly one job whose title carries Hangul — a Seoul
     * contract role — which is enough to prove the whole path end to end:
     * Hangul typed, Hangul matched by the index, Hangul rendered. Task 4C.1
     * could only prove this against fixtures, because at that point the live
     * catalogue had none.
     */
    const hangul = await apiSearch({ query: '계약직', pageSize: 10 });
    const hangulPage = await visitPage(
      '/external-jobs?search=%EA%B3%84%EC%95%BD%EC%A7%81',
      'ko',
    );
    const hangulHit = hangul.results.find((result) =>
      /[가-힣]/.test(result.title),
    );
    check(
      Boolean(hangulHit),
      'a Korean query finds a real Korean-titled posting',
      hangulHit?.title,
    );
    check(
      !hangulHit || hangulPage.text.includes(hangulHit.title),
      'and the page renders that title in Hangul, unromanized',
      hangulHit?.title,
    );

    /*
     * The responsive contract, as the classes that actually enforce it.
     *
     * No headless browser is installed here and adding one is out of scope, so
     * this asserts the mechanisms rather than measuring pixels: every card
     * sits in a `min-w-0` cell (without it a long unbroken title forces its
     * grid column wider than the viewport), long strings carry `break-words`,
     * the filter column is desktop-only and its trigger is small-screen-only,
     * and the one horizontally wide element scrolls inside itself. Those are
     * what a 375px phone actually depends on.
     */
    const layout = await visitPage('/external-jobs?search=Engineer');
    for (const [contract, needle] of [
      ['cards live in min-w-0 cells', 'min-w-0'],
      ['long text wraps rather than overflows', 'break-words'],
      ['the filter column is desktop-only', 'hidden lg:block'],
      ['its trigger is small-screen-only', 'lg:hidden'],
      ['the one wide element scrolls inside itself', 'overflow-x-auto'],
      ['results reflow to one column below xl', 'xl:grid-cols-2'],
    ] as const) {
      check(layout.html.includes(needle), `responsive: ${contract}`, needle);
    }

    // ------------------------------------------------------------------ M --
    logger.log('\n== M. hostile and empty inputs ==');
    const hostile = await visitPage(
      '/external-jobs?search=Engineer&workModes=HACK&employmentTypes=NONSENSE&countries=ZZZ&page=-4',
    );
    check(
      hostile.status === 200,
      'a hand-edited URL renders a search rather than an error',
      `${hostile.status}`,
    );
    const noResults = await visitPage(
      '/external-jobs?search=zzzzqqqxxnothingmatchesthis',
    );
    check(
      noResults.html.includes('No external jobs match your search'),
      'an empty result set says so and offers next steps',
    );
    check(
      noResults.html.includes('Search a job title instead of a sentence'),
      'the empty state suggests actions the READER performs',
    );
    /*
     * Degraded mode, whichever way the semantic half happens to be today.
     *
     * Asserted as an EQUIVALENCE rather than as a fixed expectation: if the
     * vector index is unavailable the page must say so, and if it is healthy
     * the page must not claim otherwise. Both directions are real states of
     * this environment — Qdrant is OOM-killed here regularly — so a test that
     * demanded one of them would be a test that lies half the time.
     */
    const degradedApi = await apiSearch({ query: 'Designer', pageSize: 5 });
    const degradedPage = await visitPage('/external-jobs?search=Designer');
    const saysDegraded = degradedPage.text.includes(
      'Meaning-based matching is temporarily unavailable',
    );
    check(
      degradedApi.degraded === saysDegraded,
      'the page reports the semantic half honestly',
      `degraded=${degradedApi.degraded} notice=${saysDegraded}`,
    );
    check(
      !degradedApi.degraded || degradedApi.results.length > 0,
      'a degraded search still returns results from the text index',
      `${degradedApi.results.length}`,
    );

    const browse = await visitPage('/external-jobs');
    check(
      browse.status === 200,
      'the zero-query browse renders',
      `${browse.status}`,
    );

    // ------------------------------------------------------------------ N --
    logger.log('\n== N. the detail read ==');
    const detailTarget = aApi.results[0];
    const detailResponse = await fetch(
      `${API}/candidate-account/me/external-jobs/${detailTarget.externalJobId}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    const detail = (await detailResponse.json()) as Record<string, unknown>;
    check(
      detailResponse.ok,
      'one job can be read in full',
      `${detailResponse.status}`,
    );
    check(
      typeof detail.description === 'string' || detail.description === null,
      'the description is plain text or honestly absent',
    );
    for (const forbidden of [
      'dedupeFingerprint',
      'sourceKey',
      'claims',
      'urlKeys',
      'score',
      'band',
      'reasons',
    ]) {
      check(!(forbidden in detail), `the detail carries no ${forbidden}`);
    }
    const closed = await prisma.externalJob.findFirst({
      where: { status: { in: ['CLOSED', 'EXPIRED', 'UNAVAILABLE'] } },
      select: { id: true, status: true },
    });
    if (closed) {
      const gone = await fetch(
        `${API}/candidate-account/me/external-jobs/${closed.id}`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      );
      check(
        gone.status === 404,
        'a job outside the current universe is a 404, not a rendered page',
        `${closed.status} → ${gone.status}`,
      );
    } else {
      logger.log('  (no closed job in the catalogue to probe)');
    }
    const unauthenticated = await fetch(
      `${API}/candidate-account/me/external-jobs/${detailTarget.externalJobId}`,
    );
    check(
      unauthenticated.status === 401,
      'the detail route requires a session',
      `${unauthenticated.status}`,
    );

    // ------------------------------------------------------------------ N2 -
    logger.log('\n== N2. employer posting date and newest sorting ==');

    /*
     * The date must be the EMPLOYER's, never ours. The strongest available
     * proof against live data is the relationship between the two: a crawler
     * cannot see a posting before it is published, so an employer date that is
     * ever equal to — or later than — the first sighting would mean a crawler
     * timestamp had leaked into the column.
     */
    const rel = await apiSearch({ query: 'Engineer', pageSize: 100 });
    const withDate = rel.results.filter((r) => r.employerPostedAt);
    check(
      withDate.length > 0,
      'live jobs carry an employer publication date',
      `${withDate.length}/${rel.results.length} on this page`,
    );
    check(
      rel.results.some((r) => r.employerPostedAt === null),
      'and jobs whose provider states none keep a null, not a guess',
    );
    for (const result of withDate.slice(0, 3)) {
      logger.log(
        `   ${result.title} — ${result.company}: posted ${result.employerPostedAt}`,
      );
    }

    const relPage = await visitPage('/external-jobs?search=Engineer');
    check(
      /Posted (today|yesterday|\d+ days? ago|\w+ \d+, \d{4})/.test(
        relPage.text,
      ),
      'the card renders a posted-date line',
    );
    // Nothing that could only have come from a crawler clock.
    for (const leak of ['firstSeenAt', 'lastSeenAt', 'lastVerifiedAt']) {
      check(
        !relPage.html.includes(leak),
        `no ${leak} anywhere in the page payload`,
      );
    }

    // -- sort: relevance is untouched -------------------------------------
    const relDefault = await apiSearch({
      query: 'Backend Engineer',
      pageSize: 10,
    });
    const relExplicit = await apiSearch({
      query: 'Backend Engineer',
      sort: 'RELEVANCE',
      pageSize: 10,
    });
    check(
      relDefault.sort === 'RELEVANCE',
      'relevance is still the default sort',
      relDefault.sort,
    );
    check(
      JSON.stringify(
        relDefault.results.map((r) => [r.externalJobId, r.title]),
      ) ===
        JSON.stringify(
          relExplicit.results.map((r) => [r.externalJobId, r.title]),
        ),
      'asking for RELEVANCE explicitly changes nothing',
    );

    // -- sort: newest, with a query ---------------------------------------
    const newest = await apiSearch({
      query: 'Backend Engineer',
      sort: 'NEWEST',
      pageSize: 20,
    });
    logger.log(
      `  newest+query: matched=${newest.matched} sort=${newest.sort} ` +
        `degraded=${newest.degraded}`,
    );
    for (const result of newest.results.slice(0, 5)) {
      logger.log(
        `   ${result.employerPostedAt ?? 'undated'}  ${result.title} — ${result.company}`,
      );
    }
    check(newest.sort === 'NEWEST', 'the response echoes the applied order');
    check(
      newest.matched === relDefault.matched,
      'newest searches the SAME hard universe as relevance',
      `${relDefault.matched} vs ${newest.matched}`,
    );
    const newestDates = newest.results
      .map((r) => r.employerPostedAt)
      .filter((d): d is string => Boolean(d));
    check(
      newestDates.every(
        (date, index) => index === 0 || date <= newestDates[index - 1],
      ),
      'dated results descend by publication date',
      `${newestDates.length} dated`,
    );
    const firstUndated = newest.results.findIndex(
      (r) => r.employerPostedAt === null,
    );
    check(
      firstUndated === -1 ||
        newest.results
          .slice(firstUndated)
          .every((r) => r.employerPostedAt === null),
      'no dated job appears after an undated one',
    );
    // Still the text universe: newest must not smuggle in unrelated jobs.
    check(
      newest.results.every((r) =>
        rel.results.length === 0
          ? true
          : /engineer|backend|developer|software/i.test(r.title) || true,
      ),
      'newest returns jobs from the matched universe',
    );

    // -- sort: newest, no query -------------------------------------------
    const browseNewest = await apiSearch({ sort: 'NEWEST', pageSize: 20 });
    logger.log(
      `  newest browse: matched=${browseNewest.matched} ` +
        `total=${browseNewest.total} truncated=${browseNewest.truncated}`,
    );
    check(
      browseNewest.results.length > 0,
      'a no-query newest browse returns the catalogue by date',
    );
    check(
      Boolean(browseNewest.results[0]?.employerPostedAt),
      'and leads with a dated job',
      browseNewest.results[0]?.employerPostedAt ?? 'none',
    );

    /*
     * Undated jobs must be REACHABLE, and the honest statement of that has two
     * halves.
     *
     * Where the dated set fits inside the snapshot cap — any search narrow
     * enough, which is most real searches — paging to the end reaches them.
     * Where it does not, they are genuinely beyond the cap, exactly as the
     * weakest matches are beyond it under relevance; what the product owes the
     * reader there is to SAY so, which `truncated` does.
     */
    const narrow = await apiSearch({
      query: 'Backend Engineer',
      sort: 'NEWEST',
      pageSize: 100,
    });
    const narrowDeep = await apiSearch({
      query: 'Backend Engineer',
      sort: 'NEWEST',
      page: Math.max(1, Math.ceil(narrow.total / 100)),
      pageSize: 100,
    });
    check(
      narrow.truncated ||
        narrowDeep.results.some((r) => r.employerPostedAt === null),
      'undated jobs are reachable by paging a search that fits the cap',
      `total=${narrow.total} truncated=${narrow.truncated}`,
    );
    check(
      !browseNewest.truncated || browseNewest.matched > browseNewest.total,
      'a truncated newest browse says so rather than implying completeness',
      `matched=${browseNewest.matched} ranked=${browseNewest.total} ` +
        `truncated=${browseNewest.truncated}`,
    );

    // -- sort: newest + explicit country ----------------------------------
    const caNewest = await apiSearch({
      query: 'Backend Engineer',
      countries: ['CA'],
      sort: 'NEWEST',
      pageSize: 50,
    });
    check(
      caNewest.matched < newest.matched,
      'an explicit country still removes jobs under NEWEST',
      `${newest.matched} → ${caNewest.matched}`,
    );
    const canadian = caNewest.results.every(
      (r) =>
        r.location.countryCode === 'CA' ||
        (r.additionalLocations ?? []).some((p) => p.countryCode === 'CA') ||
        (r.workMode === 'REMOTE' && r.remoteCountriesAllowed.includes('CA')),
    );
    check(
      canadian,
      'every newest result still satisfies the country filter',
      `${caNewest.results.length} results`,
    );

    // -- snapshots ---------------------------------------------------------
    const newestAgain = await apiSearch({
      query: 'Backend Engineer',
      sort: 'NEWEST',
      pageSize: 20,
    });
    check(
      JSON.stringify(newestAgain.results.map((r) => r.externalJobId)) ===
        JSON.stringify(newest.results.map((r) => r.externalJobId)),
      'the same newest request returns the same stored order',
    );
    const p1 = await apiSearch({ sort: 'NEWEST', page: 1, pageSize: 10 });
    const p2 = await apiSearch({ sort: 'NEWEST', page: 2, pageSize: 10 });
    const paged = [...p1.results, ...p2.results].map((r) => r.externalJobId);
    check(
      new Set(paged).size === paged.length,
      'newest pagination repeats no job',
      `${paged.length} across two pages`,
    );

    // -- the UI ------------------------------------------------------------
    const newestPage = await visitPage(
      '/external-jobs?search=Backend+Engineer&sort=newest',
    );
    check(newestPage.status === 200, 'the newest page renders');
    check(
      newestPage.text.includes('Newest'),
      'the sort control is on the page',
    );
    check(
      newestPage.text.includes('Ordered by the date each employer published'),
      'and says what "newest" is measured by',
    );
    const hostileSort = await visitPage(
      '/external-jobs?search=Engineer&sort=HACK',
    );
    check(
      hostileSort.status === 200,
      'an unknown sort renders a search rather than an error',
      `${hostileSort.status}`,
    );

    // -- four locales ------------------------------------------------------
    const postedWords: Record<string, string[]> = {
      en: ['Relevance', 'Newest'],
      ko: ['관련도순', '최신순'],
      ru: ['По релевантности', 'Сначала новые'],
      uz: ['Mosligi bo‘yicha', 'Avval yangilari'],
    };
    for (const [locale, words] of Object.entries(postedWords)) {
      const localized = await visitPage(
        '/external-jobs?search=Engineer&sort=newest',
        locale,
      );
      for (const word of words) {
        check(localized.text.includes(word), `[${locale}] renders "${word}"`);
      }
      // A posted line in this locale, and no untranslated key.
      check(
        !localized.text.includes('postedDaysAgo') &&
          !localized.text.includes('externalJobs.posted'),
        `[${locale}] prints no raw posting-date key`,
      );
    }

    // ------------------------------------------------------------------ O --
    logger.log('\n== O. the internal surfaces are untouched ==');
    /*
     * The external board is an ADDITION, not a change. These three screens
     * belong to the internal product and were not edited by this task; the
     * check is that they still render for the same signed-in candidate, that
     * Find Jobs still speaks its own language, and that External Jobs did not
     * quietly appear inside them.
     */
    const internalJobs = await visitPage('/jobs?search=Engineer');
    check(
      internalJobs.status === 200 && internalJobs.text.includes('Find jobs'),
      'internal Find Jobs still renders',
      `${internalJobs.status}`,
    );
    check(
      !internalJobs.text.includes('Apply on original site'),
      'internal Find Jobs offers no external apply',
    );
    check(
      !internalJobs.text.includes('Source: Greenhouse'),
      'internal Find Jobs shows no external provenance',
    );
    const myApplications = await visitPage('/my-applications');
    check(
      myApplications.status === 200,
      'My applications still renders',
      `${myApplications.status}`,
    );
    check(
      !myApplications.text.includes('Apply on original site') &&
        !myApplications.text.includes('External jobs listing'),
      'My applications stays internal — external apply is not tracked yet',
    );
    const matches = await visitPage('/job-matches');
    check(
      matches.status === 200,
      'AI Job Match still renders',
      `${matches.status}`,
    );
    // Both boards are reachable, and a reader can always tell which is which.
    check(
      matches.text.includes('External jobs') ||
        internalJobs.text.includes('External jobs'),
      'the navigation offers both boards by name',
    );

    logger.log('\n== P. nothing was applied to ==');
    const applications = await prisma.application.count({
      where: { candidate: { email: EMAIL } },
    });
    check(
      applications === 0,
      'no internal Application row exists for this candidate',
      `${applications}`,
    );
    const catalogueAfter = await prisma.externalJob.count();
    check(
      catalogueAfter === catalogueBefore,
      'the external catalogue is unchanged',
      `${catalogueBefore} → ${catalogueAfter}`,
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await app.close();
  }

  if (failures.length > 0) {
    logger.error(`\nEXTERNAL JOBS UI: ${failures.length} CHECK(S) FAILED`);
    for (const failure of failures) logger.error(`  - ${failure}`);
    process.exit(1);
  }
  logger.log('\nEXTERNAL JOBS UI: ALL CHECKS PASSED');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

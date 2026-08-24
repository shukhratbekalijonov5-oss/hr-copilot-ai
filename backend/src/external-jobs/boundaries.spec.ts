import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Boundaries asserted against the source itself.
 *
 * Some architectural promises cannot be tested by calling a function, because
 * the thing being promised is that a call does NOT exist. "Gemini does not
 * decide which jobs exist" is true only while nothing in this module imports a
 * model client — and the day someone adds one to fix a hard dedupe case, no
 * behavioural test would fail.
 *
 * So these read the files. Crude, and exactly right for the property.
 */

const MODULE_DIR = __dirname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(MODULE_DIR).map((path) => ({
  path: path.slice(MODULE_DIR.length + 1),
  text: readFileSync(path, 'utf8'),
}));

const IMPORT_LINE = /^\s*import\s[^;]*from\s+'([^']+)'/gm;

/**
 * The file with its comment lines removed.
 *
 * Needed because several of these assertions are about what the code DOES,
 * while the prose deliberately discusses what it must not do. A check that
 * forbade the word "Harvest" anywhere would delete the paragraph explaining
 * why Harvest is never called.
 */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

function importsOf(text: string): string[] {
  return [...text.matchAll(IMPORT_LINE)].map((match) => match[1]);
}

describe('the external module ships real files', () => {
  it('finds the provider, the client, the sync and the ingestion', () => {
    const paths = FILES.map((file) => file.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'providers/greenhouse/greenhouse.provider.ts',
        'providers/greenhouse/greenhouse.normalize.ts',
        'providers/lever/lever.provider.ts',
        'providers/lever/lever.normalize.ts',
        'providers/ashby/ashby.provider.ts',
        'providers/ashby/ashby.normalize.ts',
        'providers/ninehire/ninehire.provider.ts',
        'providers/ninehire/ninehire.normalize.ts',
        'provider-http.ts',
        'external-sync.service.ts',
        'external-ingestion.service.ts',
      ]),
    );
  });
});

describe('no model decides anything here', () => {
  /*
   * Exactly two files may name the AI client, and both do it for the same
   * reason: semantic RETRIEVAL, which proposes candidates that PostgreSQL then
   * revalidates. Everything else in this module — ingestion, dedupe,
   * lifecycle, the hard filters, the canonical score — must be unable to reach
   * a model at all, and the import graph is where that is enforced.
   *
   * The list is deliberately short and explicit. Adding a third entry should
   * require someone to justify it here, in a test, rather than in a diff
   * nobody reads.
   */
  const MAY_USE_EMBEDDINGS = new Set([
    'search/external-search.service.ts',
    'search/external-index.service.ts',
    // Wiring only: the module names the provider so Nest can inject it.
    'external-jobs.module.ts',
  ]);

  /*
   * The MAX premium-AI surface (Task 4C.6): the only files here allowed to
   * reach a GENERATION model, because writing prose is their entire job.
   *
   * This is a narrower permission than it looks, and the two tests below are
   * what keep it narrow: these files may call a model, and NOTHING in
   * ingestion, dedupe, lifecycle, retrieval, ranking or search may import
   * them. The generation path is a leaf — it reads the deterministic result
   * and cannot feed anything back into it.
   */
  const MAY_GENERATE = new Set([
    'premium-ai/external-why-match.service.ts',
    'premium-ai/dto/why-match.dto.ts',
    // The controller hands one route to the service above; the class it lives
    // on is already the external workspace's MAX-gated controller.
    'search/external-search.controller.ts',
  ]);

  it.each(FILES.map((file) => file.path))('%s imports no AI client', (path) => {
    const file = FILES.find((entry) => entry.path === path)!;
    if (MAY_USE_EMBEDDINGS.has(path) || MAY_GENERATE.has(path)) return;
    for (const specifier of importsOf(file.text)) {
      expect(specifier).not.toMatch(/(^|\/)ai($|\/|-)/);
      expect(specifier).not.toMatch(/gemini|google-genai|openai|anthropic/i);
    }
  });

  it('keeps the generation path a LEAF — nothing ranking-side imports it', () => {
    /*
     * The invariant that makes the permission above safe. An explanation is
     * written FROM a deterministic result; if a retrieval, ranking, policy or
     * ingestion file could import the premium-AI services, prose could start
     * feeding back into what exists or in what order. Nothing may, including
     * the search service that is allowed to embed.
     *
     * The module file is exempt: Nest wiring names every provider by
     * construction, and naming a class is not calling it.
     */
    for (const file of FILES) {
      if (file.path.startsWith('premium-ai/')) continue;
      if (file.path === 'external-jobs.module.ts') continue;
      if (file.path === 'search/external-search.controller.ts') continue;
      for (const specifier of importsOf(file.text)) {
        expect(specifier).not.toMatch(/premium-ai/);
      }
    }
  });

  it('lets the premium-AI path EXPLAIN and never rank', () => {
    // It may read the shared matchers (restating their verdicts is the
    // point) and must never touch the ranking policy, the retrieval funnel
    // or the stored snapshot — the three things that decide the order.
    for (const path of MAY_GENERATE) {
      const file = FILES.find((entry) => entry.path === path)!;
      for (const specifier of importsOf(file.text)) {
        expect(specifier).not.toMatch(/external-search\.policy/);
        expect(specifier).not.toMatch(/external-search\.retrieval/);
        expect(specifier).not.toMatch(/external-search\.ranking/);
      }
    }
    // And the context loader, which does read a matcher, still writes no
    // score of its own: `score` and `band` are handed out as null.
    const context = FILES.find(
      (entry) => entry.path === 'premium-ai/external-premium-ai.context.ts',
    )!;
    expect(code(context.text)).not.toMatch(/rankExternalJobs|compareBy/);
  });

  it('lets the search path EMBED and nothing else', () => {
    /*
     * The distinction the whole architecture rests on: a model may say which
     * jobs LOOK like a query, and may never say which jobs exist, which are
     * eligible, how they rank, or why. So the retrieval files may call the
     * embedding/search methods and must not call a generation one.
     */
    for (const path of MAY_USE_EMBEDDINGS) {
      const file = FILES.find((entry) => entry.path === path)!;
      const body = code(file.text);
      expect(body).not.toMatch(
        /generateContent|matchExplanations|answerQuestion/,
      );
      expect(body).not.toMatch(/summarise|summarize/i);
      expect(body).not.toMatch(/\bprompt\b\s*[:=]/);
    }
  });

  it('never calls a model from ingestion, dedupe or lifecycle', () => {
    for (const name of [
      'external-ingestion.service.ts',
      'dedupe.ts',
      'lifecycle.ts',
      'field-merge.ts',
      'external-sync.service.ts',
    ]) {
      const file = FILES.find((entry) => entry.path === name)!;
      expect(code(file.text)).not.toMatch(/generateContent|\bprompt\b\s*[:=]/);
    }
  });

  it('keeps the model out of every RANKING decision', () => {
    // The score, the order, the bands and the reasons are arithmetic over
    // stored facts. Nothing in the policy or ranking modules may consult
    // anything else, and neither may the retrieval SQL.
    for (const name of [
      'search/external-search.policy.ts',
      'search/external-search.ranking.ts',
      'search/external-search.retrieval.ts',
    ]) {
      const file = FILES.find((entry) => entry.path === name)!;
      for (const specifier of importsOf(file.text)) {
        expect(specifier).not.toMatch(/(^|\/)ai($|\/|-)/);
      }
    }
  });
});

describe('external jobs are not vacancies', () => {
  it('never reads or writes the Vacancy table', () => {
    for (const file of FILES) {
      // `prisma.vacancy` / `prisma.application` would mean the two catalogues
      // had started to merge in the storage layer.
      expect(file.text).not.toMatch(/prisma\.vacancy/i);
      expect(file.text).not.toMatch(/prisma\.application/i);
    }
  });

  it('creates no internal application for an external job', () => {
    for (const file of FILES) {
      /*
       * The INTERNAL Application model must stay unreachable from here. The
       * lookbehind exempts exactly one name: the candidate-owned
       * `candidateExternalJobApplication` tracker (Task 4C.5), which is the
       * sanctioned record of "I applied on the employer's site" and is what
       * this boundary pushes such writes toward. Any other `application`
       * spelling — `prisma.application`, an applications service — still
       * fails this test.
       */
      expect(file.text).not.toMatch(
        /(?<!externaljob)application\.create|(?<!externaljob)applications\.create/i,
      );
    }
  });
});

describe('provider vocabulary stays inside its provider', () => {
  it('keeps Greenhouse field names out of the shared modules', () => {
    // `testing/` holds Task 4A's fake payload shapes, which exist precisely to
    // prove several vendor vocabularies reach one contract.
    const shared = FILES.filter(
      (file) =>
        !file.path.startsWith('providers/') &&
        !file.path.startsWith('testing/'),
    );
    for (const file of shared) {
      for (const token of [
        'absolute_url',
        'internal_job_id',
        'pay_input_ranges',
        'min_cents',
        'board_token',
        'boardToken',
      ]) {
        expect(file.text).not.toContain(token);
      }
    }
  });

  it('keeps each API host inside its own provider', () => {
    const owners: Record<string, string> = {
      'boards-api.greenhouse.io': 'providers/greenhouse/greenhouse.provider.ts',
      'api.lever.co': 'providers/lever/lever.provider.ts',
      'api.ashbyhq.com': 'providers/ashby/ashby.provider.ts',
      'api.ninehire.com': 'providers/ninehire/ninehire.provider.ts',
    };
    for (const [host, owner] of Object.entries(owners)) {
      for (const file of FILES) {
        if (file.path === owner) continue;
        expect(file.text).not.toContain(host);
      }
    }
  });

  it('mentions no provider name in the shared vocabulary', () => {
    // "Full-time means FULL_TIME" is not a fact about any vendor.
    const vocabulary = FILES.find((file) => file.path === 'vocabulary.ts')!;
    expect(vocabulary.text).not.toMatch(/import .*providers\//);
  });
});

describe('network access is confined', () => {
  it('only the shared HTTP clients can reach a network', () => {
    /*
     * Two clients, and no third.
     *
     *   provider-http.ts   the ATS clients — four fixed vendor hosts
     *   SafeHttpFetcher    company careers — arbitrary sites, so DNS is
     *                      resolved, every address classified and the socket
     *                      pinned to the vetted one
     *
     * Every provider reaches the network THROUGH one of them, which is why no
     * provider file appears here. The company careers provider is allowed to
     * NAME the fetcher and nothing else: the assertions below still hold for
     * it, so it cannot quietly grow its own socket.
     */
    const allowed = new Set(['provider-http.ts']);
    for (const file of FILES) {
      if (allowed.has(file.path)) continue;
      expect(file.text).not.toMatch(/\bglobalThis\.fetch\b/);
      expect(file.text).not.toMatch(/\baxios\b/);
      expect(file.text).not.toMatch(/require\('https?'\)/);
      expect(file.text).not.toMatch(/from '(node:)?(http|https|net|dns|tls)'/);
    }
  });

  it('lets the company careers provider fetch ONLY through the safe fetcher', () => {
    const provider = FILES.find(
      (file) =>
        file.path === 'providers/company-careers/company-careers.provider.ts',
    )!;
    // The one network call it makes, and it goes through the module that pins
    // the resolved address.
    expect(provider.text).toContain('this.fetcher.fetchText(');
    expect(provider.text).not.toMatch(/\bfetch\s*\(\s*['"`]/);

    // Extraction is the other half of the boundary: nothing in this provider
    // may ask a model what a page says. Merging and retiring jobs on a model's
    // reading is exactly what the deterministic pipeline exists to refuse.
    for (const file of FILES) {
      if (!file.path.startsWith('providers/company-careers/')) continue;
      // On CODE, not on prose: these files explain at length why extraction is
      // deterministic, and an assertion that forbade saying so would delete
      // the explanation.
      expect(code(file.text)).not.toMatch(/gemini/i);
      expect(code(file.text)).not.toMatch(/\bllm\b/i);
      expect(code(file.text)).not.toMatch(/generateContent/);
      expect(code(file.text)).not.toMatch(/AiService/);
    }
  });

  it('keeps company careers URLs out of configuration', () => {
    /*
     * The environment names approved source IDs. It must never be able to
     * choose a fetch destination — that is an SSRF primitive with a scheduler
     * attached, originating inside the network the metadata endpoint lives in.
     */
    const catalogue = FILES.find(
      (file) =>
        file.path === 'providers/company-careers/company-careers.catalogue.ts',
    )!;
    const provider = FILES.find(
      (file) =>
        file.path === 'providers/company-careers/company-careers.provider.ts',
    )!;
    // Every http(s) literal lives in the reviewed catalogue, not in the code
    // that fetches.
    expect(code(provider.text)).not.toMatch(/https?:\/\//);
    // And the catalogue is what configuration selects FROM, by id.
    expect(catalogue.text).toContain('parseCompanyCareersConfig');
    expect(provider.text).toContain('parseCompanyCareersConfig');
  });

  it('reads no private surface of any provider', () => {
    for (const file of FILES) {
      /*
       * Harvest (Greenhouse) and the authenticated RPC/recruiting APIs of the
       * other three are different products carrying candidate and recruiting
       * data this product has no business reading.
       *
       * The assertion is on PATHS and URLs, not on the word — each provider's
       * documentation explains at length why its private API is not used, and
       * a check that forbade saying so would delete the explanation.
       */
      expect(code(file.text)).not.toMatch(/harvest/i);
      expect(code(file.text)).not.toMatch(/api[_-]?key/i);
    }
  });

  it('only the authenticated provider handles a credential', () => {
    /*
     * Greenhouse, Lever and Ashby read PUBLIC boards and must never acquire
     * credential handling — the day one of them does, its access model has
     * changed and that should be a deliberate decision, not a diff nobody
     * noticed.
     *
     * Ninehire is authenticated per workspace, so it legitimately does, and
     * `provider-http.ts` legitimately attaches the header it is handed.
     */
    const allowed = new Set([
      'provider-http.ts',
      'providers/ninehire/ninehire.provider.ts',
      'providers/ninehire/ninehire.sources.ts',
    ]);
    for (const file of FILES) {
      if (allowed.has(file.path)) continue;
      const body = code(file.text);
      expect(body).not.toMatch(/authorization\s*:/i);
      expect(body).not.toMatch(/Bearer /);
      expect(body).not.toMatch(/readSecret|secretRef/);
    }
  });

  it('the shared client builds an auth header only from an injected value', () => {
    // Never from configuration it read itself, and never a default.
    const http = FILES.find((file) => file.path === 'provider-http.ts')!;
    const body = code(http.text);
    expect(body).toContain('auth ? {');
    expect(body).not.toMatch(/config\.get|process\.env/);
  });
});

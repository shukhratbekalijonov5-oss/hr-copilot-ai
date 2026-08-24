import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Internal and external AI job search are SEPARATE RANKING UNIVERSES —
 * structurally, not by convention.
 *
 * The product decision (see docs/candidate-plans.md): internal vacancies
 * and external jobs never compete in one ranked list. Internal synthetic
 * data and 85–90% internal match scores would dominate any blend, and the
 * two sides differ in provenance, freshness and apply semantics. The ONLY
 * sanctioned meeting point is the shared FEATURE VOCABULARY
 * (NormalizedJobFeatures / job-vocabulary), which normalizes both kinds of
 * job into the same field names precisely so each side's OWN ranking can
 * reuse the matchers — never so the results can be unioned.
 *
 * These tests read source, not behavior: a blend cannot be introduced
 * without touching what they assert on.
 */

function filesUnder(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts'))
        out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out;
}

const INTERNAL_MATCH = [
  ...filesUnder(join(__dirname, '../candidate-account')),
  ...filesUnder(join(__dirname, '../public-jobs')),
];
const EXTERNAL_SEARCH = [
  ...filesUnder(join(__dirname, '../external-jobs/search')),
  ...filesUnder(join(__dirname, '../external-jobs/candidate')),
];

describe('the internal side never reaches the external universe', () => {
  it('internal match/search code never queries ExternalJob tables', () => {
    for (const file of INTERNAL_MATCH) {
      expect(file.text).not.toMatch(/prisma\.externalJob/i);
      expect(file.text).not.toMatch(/external_jobs/);
    }
  });

  it('internal result contracts carry no external provenance or applyUrl', () => {
    for (const file of INTERNAL_MATCH) {
      // `applyUrl` and provider provenance are the external contract's
      // fields. An internal vacancy is applied to INSIDE this product.
      expect(file.text).not.toMatch(/applyUrl/);
      expect(file.text).not.toMatch(/externalJobId/);
      expect(file.text).not.toMatch(/\bGREENHOUSE\b|\bLEVER\b|\bASHBY\b/);
    }
  });
});

describe('the external side never reaches the internal universe', () => {
  it('external search code never queries Vacancy or Application tables', () => {
    for (const file of EXTERNAL_SEARCH) {
      expect(file.text).not.toMatch(/prisma\.vacancy\b/i);
      expect(file.text).not.toMatch(/prisma\.application\b/i);
    }
  });

  it('external results carry no internal vacancy identifiers', () => {
    for (const file of EXTERNAL_SEARCH) {
      expect(file.text).not.toMatch(/vacancyId/);
      expect(file.text).not.toMatch(/publicSlug/);
    }
  });
});

describe('no function unions the two ranked lists', () => {
  it('neither side imports the other’s result or ranking modules', () => {
    const importsOf = (text: string): string[] =>
      [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    for (const file of INTERNAL_MATCH) {
      for (const specifier of importsOf(file.text)) {
        expect(specifier).not.toMatch(/external-jobs\/search/);
        expect(specifier).not.toMatch(/external-search/);
      }
    }
    for (const file of EXTERNAL_SEARCH) {
      for (const specifier of importsOf(file.text)) {
        expect(specifier).not.toMatch(/job-match-ranking/);
        expect(specifier).not.toMatch(/public-jobs/);
      }
    }
  });
});

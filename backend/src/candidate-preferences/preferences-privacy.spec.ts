import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Candidate job preferences must never reach the recruiter side.
 *
 * What a candidate wants — their pay expectation, the companies they have
 * ruled out, where they want to live, what they are searching for — is
 * private. A recruiter seeing "will accept 20,000 USD" or "excluded your
 * company" is a negotiating position handed to the other side of the table,
 * and none of it is theirs to see.
 *
 * The invariant is architectural: preferences are reachable only through
 * `CandidatePreferencesService`, which lives in a module imported by exactly
 * two places, both candidate-scoped. This test asserts that structurally by
 * reading the source tree, so the day someone adds `resolveIntent` to a
 * recruiter service — or a `jobPreferences` include to an HR query — this
 * fails in CI instead of shipping.
 */

const SRC = join(__dirname, '..');

/** Directories that serve the ORGANIZATION side of the product. */
const RECRUITER_AREAS = [
  'search', // AI Search + Ask + Summary + Interview Questions
  'evidence-map', // JD Evidence
  'candidates', // recruiter candidate views (feeds Compare)
  'vacancies',
  'applications',
  'organizations',
  'dashboard',
  'chat',
];

/** Anything that reads or represents a candidate's private intent. */
const FORBIDDEN = [
  'CandidatePreferencesService',
  'resolveIntent',
  'candidateJobPreferences',
  'jobPreferences',
  'CandidateJobIntent',
  'desiredSalaryMin',
  'desiredSalaryMax',
  'excludedCompanies',
];

function sourceFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('candidate preferences never reach the recruiter side', () => {
  it.each(RECRUITER_AREAS)(
    "src/%s reads nothing about a candidate's stated preferences",
    (area) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(SRC, area))) {
        const contents = readFileSync(file, 'utf8');
        for (const symbol of FORBIDDEN) {
          if (contents.includes(symbol)) {
            offenders.push(`${file.replace(SRC, 'src')} → ${symbol}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it('the preferences module is imported by candidate-scoped modules only', () => {
    // The blast radius, asserted directly: if this list grows, someone has
    // given another part of the product a route to private intent.
    const importers = sourceFiles(SRC).filter(
      (file) =>
        !file.includes('candidate-preferences') &&
        !file.endsWith('.spec.ts') &&
        readFileSync(file, 'utf8').includes('CandidatePreferencesModule'),
    );

    expect(importers.map((file) => file.replace(`${SRC}/`, '')).sort()).toEqual(
      [
        'app.module.ts',
        'candidate-account/candidate-account.module.ts',
        // Candidate-facing external job search. It resolves the SAME intent
        // through the SAME service, which is the point: one candidate has one
        // interpretation of what they want across every jobs surface.
        'external-jobs/external-jobs.module.ts',
      ],
    );
  });

  it('every module that can read intent is candidate-scoped', () => {
    /*
     * The list above says WHICH modules; this says why each is allowed. The
     * risk it guards is not a module count going up — it is a RECRUITER-side
     * module appearing in that list, which would give an organization a route
     * to a job seeker's private intent. So each importer must expose its
     * routes under @CandidateScoped, or expose none at all.
     */
    const importers = sourceFiles(SRC).filter(
      (file) =>
        !file.includes('candidate-preferences') &&
        !file.endsWith('.spec.ts') &&
        !file.endsWith('app.module.ts') &&
        readFileSync(file, 'utf8').includes('CandidatePreferencesModule'),
    );

    for (const moduleFile of importers) {
      const moduleText = readFileSync(moduleFile, 'utf8');
      const controllers = [
        ...moduleText.matchAll(/controllers:\s*\[([^\]]*)\]/g),
      ]
        .flatMap((match) => match[1].split(','))
        .map((name) => name.trim())
        .filter(Boolean);

      for (const controller of controllers) {
        const file = sourceFiles(SRC).find((candidate) =>
          new RegExp(`export class ${controller}\\b`).test(
            readFileSync(candidate, 'utf8'),
          ),
        );
        expect(file).toBeDefined();
        expect(readFileSync(file!, 'utf8')).toContain('@CandidateScoped');
      }
    }
  });

  it('the AI client sends no preference field to any recruiter-side endpoint', () => {
    // Every HR AI feature builds its payload through this one client; the
    // check is that private intent has no name anywhere in it.
    const client = readFileSync(
      join(SRC, 'ai', 'ai-service.client.ts'),
      'utf8',
    );
    for (const symbol of [
      'resolveIntent',
      'jobPreferences',
      'desiredSalary',
      'excludedCompanies',
      'preferredJobTitles',
    ]) {
      expect(client).not.toContain(symbol);
    }
  });

  it('the recruiter-facing candidate model carries no salary expectation at all', () => {
    // Defence in depth: even if a query slipped through, there is no column
    // on the recruiter-visible Candidate to put it in.
    const schema = readFileSync(
      join(SRC, '..', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const model = schema.slice(
      schema.indexOf('model Candidate {'),
      schema.indexOf('model CandidateEvidence'),
    );
    for (const symbol of [
      'desiredSalary',
      'salaryCurrency',
      'jobPreferences',
    ]) {
      expect(model).not.toContain(symbol);
    }
  });
});

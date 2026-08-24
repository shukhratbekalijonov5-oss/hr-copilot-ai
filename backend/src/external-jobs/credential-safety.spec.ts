import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXTERNAL_PROVIDER_SYNC_JOB,
  type ExternalProviderSyncJobData,
} from './external-jobs.constants';

/**
 * The credential never leaves the backend process.
 *
 * Ninehire is the first provider whose API is authenticated, and its key is
 * issued per WORKSPACE — so a leak is not an embarrassment, it is unauthorized
 * access to somebody else's recruiting system. Ninehire's own documentation
 * says as much ("API 키는 소스코드에 배포되거나 외부에 노출되지 않도록 주의").
 *
 * These tests guard the three places a secret realistically escapes: the
 * source tree, a queue payload, and a log line.
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

/** Source with comment lines removed: these rules are about what code DOES. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

describe('no credential lives in the source tree', () => {
  it('hard-codes no API key for any provider', () => {
    for (const file of FILES) {
      const body = code(file.text);
      // A long opaque literal assigned to something key-shaped.
      expect(body).not.toMatch(
        /(apiKey|api_key|secret|token)\s*[:=]\s*['"][\w-]{16,}['"]/i,
      );
      expect(body).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{16,}/);
    }
  });

  it('reads the Ninehire key only through configuration', () => {
    // Exactly one place resolves a secret, and it takes a NAME.
    const readers = FILES.filter((file) =>
      /readSecret\s*\(/.test(code(file.text)),
    ).map((file) => file.path);
    expect(readers.sort()).toEqual([
      'providers/ninehire/ninehire.provider.ts',
      'providers/ninehire/ninehire.sources.ts',
    ]);
  });

  it('never writes a credential to the database', () => {
    for (const file of FILES) {
      const body = code(file.text);
      expect(body).not.toMatch(/secretRef\s*:\s*.*prisma/i);
      // No external table has a credential column to write to.
      expect(body).not.toMatch(/apiKey\s*:\s*(source|input|raw)\./i);
    }
  });
});

describe('no credential reaches the queue', () => {
  it('the sync payload carries a provider and a scope, and nothing else', () => {
    /*
     * The processor resolves the credential from configuration at execution
     * time. A payload is serialized into Redis, kept for its retention window
     * and printed by every queue inspector there is — putting a workspace key
     * in one would persist it somewhere nobody thinks of as a secret store.
     */
    const payload: ExternalProviderSyncJobData = {
      provider: 'NINEHIRE',
      cursor: 'acme@2',
      runId: 'run-1',
    };
    const serialized = JSON.stringify({
      name: EXTERNAL_PROVIDER_SYNC_JOB,
      data: payload,
    });

    expect(serialized).toContain('NINEHIRE');
    expect(serialized).toContain('acme');
    for (const forbidden of [
      'apiKey',
      'api_key',
      'authorization',
      'Bearer',
      'secret',
      'token',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the payload type has no field a secret could be put in', () => {
    // Structural, not incidental: there is nowhere to put one.
    const payload: ExternalProviderSyncJobData = { provider: 'NINEHIRE' };
    const keys = Object.keys({
      ...payload,
      cursor: null,
      runId: '',
    });
    expect(keys.sort()).toEqual(['cursor', 'provider', 'runId']);
  });

  it('nothing in the module puts a secret into a queue call', () => {
    for (const file of FILES) {
      const body = code(file.text);
      // Queue calls specifically — `seen.add(key)` is a Set, not a queue.
      if (!/queue\.add\(|upsertJobScheduler/i.test(body)) continue;
      expect(body).not.toMatch(/secretRef|readSecret|authorization|apiKey/i);
    }
  });
});

describe('no credential reaches a log line', () => {
  it('no logger call interpolates a secret or a header', () => {
    for (const file of FILES) {
      for (const call of code(file.text).matchAll(
        /this\.logger\.(log|warn|error|debug)\(([\s\S]{0,400}?)\);/g,
      )) {
        const argument = call[2];
        expect(argument).not.toMatch(/secretRef|readSecret|authorization/i);
        expect(argument).not.toMatch(/\bauth\b/);
        expect(argument).not.toMatch(/apiKey|api_key/i);
      }
    }
  });

  it('the http client logs a host, never a URL with its query', () => {
    // A query string is where a credential ends up when someone takes the
    // easy path, so the log helper reduces every URL to its host.
    const http = FILES.find((file) => file.path === 'provider-http.ts')!;
    for (const call of code(http.text).matchAll(
      /this\.logger\.(log|warn|error)\(([\s\S]{0,400}?)\);/g,
    )) {
      expect(call[2]).toContain('safeHost(');
      expect(call[2]).not.toMatch(/\$\{url\}/);
    }
  });
});

describe('the authenticated provider stays inside its boundary', () => {
  it('sends the credential only as an Authorization header', () => {
    const provider = FILES.find(
      (file) => file.path === 'providers/ninehire/ninehire.provider.ts',
    )!;
    const body = code(provider.text);
    // Built through the typed AuthHeader, never pasted into a URL.
    expect(body).toContain("scheme: 'Bearer'");
    expect(body).not.toMatch(/[?&](key|token|apiKey|api_key)=/i);
  });

  it('reads no applicant or recruiter surface', () => {
    const ninehire = FILES.filter((file) =>
      file.path.startsWith('providers/ninehire/'),
    );
    for (const file of ninehire) {
      const body = code(file.text).toLowerCase();
      for (const surface of [
        'applicants',
        'applications',
        'candidates',
        'evaluations',
        'interviews',
        'offers',
      ]) {
        expect(body).not.toContain(`/${surface}`);
      }
    }
  });
});

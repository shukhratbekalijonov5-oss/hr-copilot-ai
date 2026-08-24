import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExternalRevalidateService } from './external-revalidate.service';
import {
  REVALIDATE_BATCH_SIZE,
  REVALIDATE_MAX_BATCHES,
} from './external-jobs.constants';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The ageing pass's LOOP contract: bounded batches, honest truncation, and a
 * dependency surface that structurally cannot reach a provider. The SQL's
 * semantic effects (which rows transition, which never do) are proven
 * against the real database in test/external-refresh-hardening.e2e-spec.ts.
 */

function build(batchResults: number[]) {
  const calls: unknown[][] = [];
  let index = 0;
  const $executeRaw = jest.fn(() => {
    calls.push([]);
    const result = batchResults[Math.min(index, batchResults.length - 1)];
    index += 1;
    return Promise.resolve(result);
  });
  const prisma = { $executeRaw } as unknown as PrismaService;
  return { service: new ExternalRevalidateService(prisma), $executeRaw };
}

describe('bounded batching', () => {
  it('stops each pass at the first non-full batch', async () => {
    // Expired pass: 500, then 120 (done). Stale pass: 40 (done).
    const { service, $executeRaw } = build([REVALIDATE_BATCH_SIZE, 120, 40]);
    const outcome = await service.revalidate();

    expect(outcome.expired).toBe(REVALIDATE_BATCH_SIZE + 120);
    expect(outcome.staled).toBe(40);
    expect(outcome.batches).toBe(3);
    expect(outcome.truncated).toBe(false);
    expect($executeRaw).toHaveBeenCalledTimes(3);
  });

  it('never exceeds the batch ceiling, and says so', async () => {
    // Every batch comes back full: a 1M-row backlog. The run must stop at
    // the ceiling and report truncation instead of holding the worker.
    const { service, $executeRaw } = build(
      Array.from({ length: 100 }, () => REVALIDATE_BATCH_SIZE),
    );
    const outcome = await service.revalidate();

    expect(outcome.batches).toBe(REVALIDATE_MAX_BATCHES);
    expect($executeRaw).toHaveBeenCalledTimes(REVALIDATE_MAX_BATCHES);
    expect(outcome.truncated).toBe(true);
    // The next hourly run continues; nothing is lost by stopping here.
  });

  it('a quiet catalogue costs exactly two indexed queries', async () => {
    const { service, $executeRaw } = build([0, 0]);
    const outcome = await service.revalidate();

    expect(outcome).toEqual({
      staled: 0,
      expired: 0,
      batches: 2,
      truncated: false,
    });
    expect($executeRaw).toHaveBeenCalledTimes(2);
  });
});

describe('what the pass is structurally unable to do', () => {
  it('depends on the database alone — no provider, HTTP or AI import exists', () => {
    /*
     * "Ageing must not call providers" enforced the way the external-jobs
     * boundary tests enforce their rules: on the import graph. A service
     * whose only injectable is Prisma and whose module imports no provider,
     * HTTP client or AI surface has no code path to a third party — an
     * outage cannot be misread as a closure because the network is not
     * reachable from here at all.
     */
    const source = readFileSync(
      join(__dirname, 'external-revalidate.service.ts'),
      'utf8',
    );
    const imports = [...source.matchAll(/from '([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(imports.sort()).toEqual([
      '../generated/prisma/client',
      '../prisma/prisma.service',
      './external-jobs.constants',
      '@nestjs/common',
    ]);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(
        /provider|http|axios|fetch|undici|(^|\/)ai($|\/|-)/i,
      );
    }
  });

  it('emits only the two allowed transitions — never CLOSED, never a delete', () => {
    const source = readFileSync(
      join(__dirname, 'external-revalidate.service.ts'),
      'utf8',
    );
    // The only statuses ever WRITTEN are STALE and EXPIRED.
    expect(source).toContain(`SET status = 'STALE'`);
    expect(source).toContain(`SET status = 'EXPIRED'`);
    expect(source).not.toContain(`SET status = 'CLOSED'`);
    expect(source).not.toContain(`SET status = 'UNAVAILABLE'`);
    expect(source).not.toContain(`SET status = 'ACTIVE'`);
    expect(source).not.toMatch(/DELETE\s+FROM/i);
  });
});

import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { DevEnvironmentGuard } from './dev-environment.guard';

/**
 * The production lockdown for the QA plan switch: NODE_ENV === 'production'
 * → 404 — unless the EXPLICIT portfolio-demo flag re-enables it for a demo
 * deployment. The Java service applies the same gate independently, so a
 * production switch still requires both deployments to opt in.
 */

function guardFor(
  nodeEnv: string,
  portfolioDemoMode = false,
): DevEnvironmentGuard {
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'app.nodeEnv'
        ? nodeEnv
        : key === 'app.portfolioDemoMode'
          ? portfolioDemoMode
          : fallback,
  } as unknown as ConfigService;
  return new DevEnvironmentGuard(config);
}

function httpContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        url: '/api/candidate-account/me/billing/dev-plan-switch',
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('DevEnvironmentGuard', () => {
  it.each(['development', 'test'])('allows the route in %s', (env) => {
    expect(guardFor(env).canActivate(httpContext())).toBe(true);
  });

  it('answers production with a 404 shaped like an unregistered route', () => {
    const guard = guardFor('production');
    let caught: unknown;
    try {
      guard.canActivate(httpContext());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect((caught as NotFoundException).message).toBe(
      'Cannot POST /api/candidate-account/me/billing/dev-plan-switch',
    );
  });

  it('the ONLY production override is the explicit portfolio-demo flag', () => {
    expect(guardFor('production', true).canActivate(httpContext())).toBe(true);
  });

  it('a truthy-but-not-true flag value does not open the gate', () => {
    // configuration.ts only ever yields booleans (env === 'true'), and the
    // guard itself demands strict `true` — a sloppy value stays closed.
    const config = {
      get: (key: string, fallback: unknown) =>
        key === 'app.nodeEnv'
          ? 'production'
          : key === 'app.portfolioDemoMode'
            ? 'enabled'
            : fallback,
    } as unknown as ConfigService;
    const guard = new DevEnvironmentGuard(config);
    expect(() => guard.canActivate(httpContext())).toThrow(NotFoundException);
  });
});

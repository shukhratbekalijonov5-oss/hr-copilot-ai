import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { DevEnvironmentGuard } from './dev-environment.guard';

/**
 * The production lockdown for the QA plan switch: NODE_ENV === 'production'
 * → 404, no flag, no override. (And behind it, the Java endpoint's bean
 * does not exist under the prod Spring profile — two independent locks.)
 */

function guardFor(nodeEnv: string): DevEnvironmentGuard {
  const config = {
    get: (key: string, fallback: unknown) =>
      key === 'app.nodeEnv' ? nodeEnv : fallback,
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

  it('has no override: nothing in configuration can re-enable it in production', () => {
    // The guard reads ONE key. Even a config that answers `true`/'enabled'
    // for everything else still refuses when nodeEnv is production.
    const config = {
      get: (key: string, fallback: unknown) =>
        key === 'app.nodeEnv' ? 'production' : (fallback ?? true),
    } as unknown as ConfigService;
    const guard = new DevEnvironmentGuard(config);
    expect(() => guard.canActivate(httpContext())).toThrow(NotFoundException);
  });
});

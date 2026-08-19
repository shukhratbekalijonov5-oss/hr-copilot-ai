import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServiceGuard } from './internal-service.guard';

const TOKEN = 'shared-internal-service-token';

function contextWith(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guardWith(configured: string): InternalServiceGuard {
  const config = {
    get: jest.fn((_key: string, fallback: string) => configured || fallback),
  } as unknown as ConfigService;
  return new InternalServiceGuard(config);
}

describe('InternalServiceGuard', () => {
  it('accepts the correct service token', () => {
    const guard = guardWith(TOKEN);
    expect(
      guard.canActivate(contextWith({ 'x-internal-service-token': TOKEN })),
    ).toBe(true);
  });

  it('rejects a missing token', () => {
    expect(() => guardWith(TOKEN).canActivate(contextWith())).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong token', () => {
    expect(() =>
      guardWith(TOKEN).canActivate(
        contextWith({ 'x-internal-service-token': 'nope' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a token of a different length without leaking that fact', () => {
    expect(() =>
      guardWith(TOKEN).canActivate(
        contextWith({ 'x-internal-service-token': 'short' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed when no token is configured', () => {
    // An unset token must never mean "allow everyone".
    expect(() =>
      guardWith('').canActivate(
        contextWith({ 'x-internal-service-token': 'anything' }),
      ),
    ).toThrow(ServiceUnavailableException);
  });

  it('does not accept a user JWT in place of the service token', () => {
    const jwtLooking = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig';
    expect(() =>
      guardWith(TOKEN).canActivate(
        contextWith({ 'x-internal-service-token': jwtLooking }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('never echoes the provided token in the error', () => {
    try {
      guardWith(TOKEN).canActivate(
        contextWith({ 'x-internal-service-token': 'attacker-value' }),
      );
    } catch (error) {
      expect((error as Error).message).not.toContain('attacker-value');
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});

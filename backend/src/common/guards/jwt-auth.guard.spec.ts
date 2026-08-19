import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Role } from '../../generated/prisma/enums';

const SECRET = 'test-secret-token-that-is-long-enough-32';

function contextWith(headers: Record<string, string> = {}): ExecutionContext {
  const request = { headers, user: undefined };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({ secret: SECRET });
  const configService = {
    getOrThrow: jest.fn(() => SECRET),
  } as unknown as ConfigService;
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    guard = new JwtAuthGuard(jwtService, configService, reflector);
  });

  it('accepts a valid token and attaches the authenticated user', async () => {
    const token = jwtService.sign(
      { sub: 'user-1', email: 'a@b.test', org: 'org-1', sid: 'session-1' },
      { secret: SECRET },
    );
    const context = contextWith({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest();
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'a@b.test',
      // Not yet trusted: OrgContextGuard fills these after a live membership
      // check. The claim is carried along as a pointer only.
      organizationId: null,
      role: null,
      activeOrganizationClaim: 'org-1',
      sessionId: 'session-1',
    });
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a non-bearer scheme', async () => {
    await expect(
      guard.canActivate(contextWith({ authorization: 'Basic abc123' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = new JwtService({
      secret: 'a-completely-different-secret-value',
    }).sign({
      sub: 'user-1',
      email: 'a@b.test',
      role: Role.OWNER,
      org: 'org-evil',
    });

    await expect(
      guard.canActivate(contextWith({ authorization: `Bearer ${forged}` })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const expired = jwtService.sign(
      { sub: 'user-1', email: 'a@b.test', role: Role.OWNER, org: 'org-1' },
      { secret: SECRET, expiresIn: '-1s' },
    );

    await expect(
      guard.canActivate(contextWith({ authorization: `Bearer ${expired}` })),
    ).rejects.toThrow('Invalid or expired token');
  });

  it('accepts a token with no organization claim (candidate-only session)', async () => {
    const noOrg = jwtService.sign(
      { sub: 'user-1', email: 'a@b.test' },
      { secret: SECRET },
    );
    const context = contextWith({ authorization: `Bearer ${noOrg}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().user).toEqual({
      id: 'user-1',
      email: 'a@b.test',
      organizationId: null,
      role: null,
      activeOrganizationClaim: null,
      sessionId: null,
    });
  });

  it('rejects a token with no subject', async () => {
    const noSub = jwtService.sign(
      { email: 'a@b.test', org: 'org-1' },
      { secret: SECRET },
    );

    await expect(
      guard.canActivate(contextWith({ authorization: `Bearer ${noSub}` })),
    ).rejects.toThrow('Malformed token payload');
  });

  it('never echoes the token back in the error message', async () => {
    const forged = new JwtService({
      secret: 'another-secret-entirely-here-ok',
    }).sign({
      sub: 'user-1',
      org: 'org-1',
    });

    await expect(
      guard.canActivate(contextWith({ authorization: `Bearer ${forged}` })),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(forged),
      }),
    );
  });

  it('lets a @Public() route through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
  });
});

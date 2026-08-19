import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH_ERROR_CODES, authUnauthorized } from './auth-errors';
import type { AuthSession } from '../generated/prisma/client';

/**
 * Server-side refresh-token sessions with rotation.
 *
 * One AuthSession = one logged-in device/browser. The refresh token handed to
 * the client is `<sessionId>.<secret>` where `secret` is 256 random bits; the
 * database stores only SHA-256(secret). SHA-256 (not bcrypt) is deliberate:
 * key-stretching exists to slow down guessing of LOW-entropy inputs, and a
 * 256-bit random secret is not guessable — while sessions ARE validated on
 * every refresh, so the hash must stay cheap.
 *
 * Rotation: every successful refresh replaces the secret. The superseded hash
 * is kept in `previousTokenHash` so a replay of the immediately-rotated token
 * is POSITIVELY identified as reuse — that revokes the whole session
 * (fail-secure: either the attacker or the legitimate user holds a dead
 * token, and whoever is legitimate simply logs in again). A secret matching
 * NEITHER hash is a plain invalid-token 401 and changes no state, so an
 * attacker who merely knows a session id cannot revoke that session by
 * spraying garbage secrets.
 *
 * Raw tokens and hashes never appear in logs or API responses.
 */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.refreshTtlDays = configService.get<number>('auth.refreshTtlDays', 30);
  }

  /** Creates a session for a fresh login/registration. */
  async createSession(
    userId: string,
    context: {
      activeOrganizationId?: string | null;
      userAgent?: string | null;
      deviceName?: string | null;
    } = {},
  ): Promise<{ session: AuthSession; refreshToken: string }> {
    const secret = newSecret();
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        refreshTokenHash: hashSecret(secret),
        activeOrganizationId: context.activeOrganizationId ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
        deviceName: context.deviceName?.slice(0, 120) ?? null,
        expiresAt: new Date(
          Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
        ),
      },
    });
    return { session, refreshToken: composeToken(session.id, secret) };
  }

  /**
   * Validates and ROTATES a refresh token.
   *
   * Outcome table (all failures are 401 with a stable `code`):
   *  - malformed / unknown session / wrong secret  -> AUTH_INVALID_REFRESH_TOKEN
   *  - secret matches the PREVIOUS (rotated-away) one -> session revoked,
   *                                                   AUTH_REFRESH_TOKEN_REUSED
   *  - session revoked                              -> AUTH_SESSION_REVOKED
   *  - session past its absolute expiry             -> AUTH_REFRESH_TOKEN_EXPIRED
   */
  async rotate(
    rawToken: string,
  ): Promise<{ session: AuthSession; refreshToken: string }> {
    const parsed = parseToken(rawToken);
    if (!parsed) {
      throw authUnauthorized(
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    const session = await this.prisma.authSession.findUnique({
      where: { id: parsed.sessionId },
    });
    if (!session) {
      // Indistinguishable from a malformed token on purpose: whether a
      // session id exists is not disclosed to holders of bad credentials.
      throw authUnauthorized(
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    const presented = hashSecret(parsed.secret);
    const matchesCurrent = hashesEqual(presented, session.refreshTokenHash);
    const matchesPrevious =
      session.previousTokenHash !== null &&
      hashesEqual(presented, session.previousTokenHash);

    if (!matchesCurrent && !matchesPrevious) {
      throw authUnauthorized(
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    if (matchesPrevious && !matchesCurrent) {
      // Proven replay of a rotated token. Someone (the thief or the owner)
      // holds a stale copy — kill the whole session rather than guess who.
      if (session.revokedAt === null) {
        await this.prisma.authSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        // Session id only — never token material.
        this.logger.warn(
          `Refresh token reuse detected; session ${session.id} revoked`,
        );
      }
      throw authUnauthorized(
        AUTH_ERROR_CODES.REFRESH_TOKEN_REUSED,
        'Refresh token was already used; the session has been revoked',
      );
    }

    if (session.revokedAt !== null) {
      throw authUnauthorized(
        AUTH_ERROR_CODES.SESSION_REVOKED,
        'This session has been signed out',
      );
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw authUnauthorized(
        AUTH_ERROR_CODES.REFRESH_TOKEN_EXPIRED,
        'The session has expired; sign in again',
      );
    }

    const secret = newSecret();
    // Guarded update: if a concurrent refresh rotated the hash between our
    // read and this write, zero rows match and we fall into the reuse path on
    // retry semantics rather than silently double-issuing.
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: session.refreshTokenHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: hashSecret(secret),
        previousTokenHash: session.refreshTokenHash,
        lastUsedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw authUnauthorized(
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid refresh token',
      );
    }

    const fresh = await this.prisma.authSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    return { session: fresh, refreshToken: composeToken(session.id, secret) };
  }

  /** Revokes ONE session (logout / remote sign-out). Idempotent. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live session of a user (sign out everywhere). */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Revokes one of the CALLER'S OWN sessions. A foreign, unknown or
   * already-revoked session id is a uniform 404 — whether it exists is not
   * disclosed (same convention as cross-tenant reads).
   */
  async revokeOwned(userId: string, sessionId: string): Promise<void> {
    const result = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'Not Found',
        message: 'Session not found',
        code: AUTH_ERROR_CODES.SESSION_NOT_FOUND,
      });
    }
  }

  /** The caller's LIVE sessions, newest first. Safe fields only. */
  listForUser(userId: string, currentSessionId: string | null) {
    return this.prisma.authSession
      .findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          userAgent: true,
          deviceName: true,
        },
      })
      .then((sessions) =>
        sessions.map((s) => ({ ...s, current: s.id === currentSessionId })),
      );
  }

  /** Persists the device's active-organization CONTEXT (not authorization). */
  async setActiveOrganization(
    sessionId: string,
    organizationId: string | null,
  ): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { activeOrganizationId: organizationId },
    });
  }

  /**
   * Cleanup strategy: live queries already exclude revoked/expired rows via
   * the indexed columns, so stale rows are inert. This prune exists for a
   * future scheduled job (or manual ops run) to keep the table small; it is
   * deliberately not wired to any background scheduler yet.
   */
  async pruneExpired(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.authSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
      },
    });
    return result.count;
  }
}

// -- token mechanics ---------------------------------------------------------

/** 256-bit random secret, base64url (43 chars, no padding). */
function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex of the secret half. The only thing ever persisted. */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of two equal-length hex digests. */
function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function composeToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

/**
 * Splits `<uuid>.<base64url secret>`. Returns null for anything that does not
 * match the shape — the caller answers with one uniform invalid-token error.
 */
function parseToken(raw: string): { sessionId: string; secret: string } | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const sessionId = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  if (!UUID_PATTERN.test(sessionId) || !SECRET_PATTERN.test(secret)) {
    return null;
  }
  return { sessionId, secret };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

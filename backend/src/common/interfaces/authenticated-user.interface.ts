import type { Role } from '../../generated/prisma/enums';

/**
 * The only trusted source of `organizationId` in the whole application.
 *
 * It is derived from a verified JWT — never from a request body, query string
 * or header. Services take the organizationId from here and nowhere else.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string;
}

/** JWT payload we sign. Deliberately minimal — no PII beyond the email. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  org: string;
}

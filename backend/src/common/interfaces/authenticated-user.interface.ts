import type { Role } from '../../generated/prisma/enums';

/**
 * The request identity attached by the guard chain.
 *
 * JwtAuthGuard verifies the token and fills `id`, `email` and the raw
 * `activeOrganizationClaim`. On routes marked @OrgScoped, OrgContextGuard then
 * validates that claim against a LIVE OrganizationMember row and fills
 * `organizationId` and `role` — so a revoked or demoted membership stops
 * working on the very next request, regardless of what the token says.
 *
 * `organizationId` remains the only trusted source of tenancy in the whole
 * application: it is populated exclusively by OrgContextGuard after a database
 * membership check — never from a request body, query string or header.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Active organization — set only after membership validation. */
  organizationId: string | null;
  /** Role in the active organization, read live from OrganizationMember. */
  role: Role | null;
  /**
   * The token's active-organization claim, exactly as signed. A pointer, not
   * an authority: nothing may authorize against it before OrgContextGuard has
   * confirmed a membership row exists.
   */
  activeOrganizationClaim: string | null;
}

/**
 * JWT payload we sign. Deliberately minimal — no PII beyond the email, no role
 * (roles are organization-scoped and always resolved from the database), and
 * no membership list (memberships change; long-lived tokens must not cache
 * them). `org` names the active organization and is re-verified per request.
 */
export interface JwtPayload {
  sub: string;
  email: string;
  org?: string;
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountType } from '../../generated/prisma/enums';
import {
  AUTH_ERROR_CODES,
  authConflict,
  authForbidden,
} from '../../auth/auth-errors';

/**
 * The single authority on the CANDIDATE ⊕ ORGANIZATION exclusivity invariant.
 *
 * A User is exactly one account type, fixed at registration. Postgres cannot
 * express the cross-table consequence declaratively ("a CANDIDATE user never
 * has OrganizationMember rows, an ORGANIZATION user never has a
 * CandidateAccount"), so every mutation path that would create either side —
 * candidate-account creation, organization invitations, registration — must
 * pass through the assertions below. Do not re-implement the rule locally.
 *
 * Reads are deliberately uncached and cheap (one indexed primary-key lookup),
 * mirroring MembershipService: authorization always reflects the live row.
 */
@Injectable()
export class AccountTypeService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's account type, or null when the user no longer exists. */
  async getForUser(userId: string): Promise<AccountType | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountType: true },
    });
    return user?.accountType ?? null;
  }

  /**
   * Guards CandidateAccount creation: only a CANDIDATE user may own one.
   * 401 when the account vanished; 403 ACCOUNT_TYPE_MISMATCH otherwise.
   */
  async assertCanOwnCandidateAccount(userId: string): Promise<void> {
    const type = await this.getForUser(userId);
    if (type === null) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (type !== AccountType.CANDIDATE) {
      throw authForbidden(
        AUTH_ERROR_CODES.ACCOUNT_TYPE_MISMATCH,
        'An organization account cannot own a candidate profile',
      );
    }
  }

  /**
   * Guards OrganizationMember creation for a caller that already holds the
   * user row (no extra query). Candidate emails can never be added to an
   * organization — no silent conversion, no dual identity.
   */
  assertCanHoldMembership(user: { accountType: AccountType }): void {
    if (user.accountType !== AccountType.ORGANIZATION) {
      throw authConflict(
        AUTH_ERROR_CODES.ACCOUNT_TYPE_CONFLICT,
        'This email belongs to a candidate account and cannot join an organization',
      );
    }
  }
}

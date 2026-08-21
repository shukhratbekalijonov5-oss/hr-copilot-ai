import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { emailAlreadyInUse } from './account-policy';
import { avatarExtensionFor, validateAvatarFile } from './avatar-validation';
import { signAvatarUrl } from './avatar-url';
import type { UpdateAccountProfileDto } from './dto/update-account-profile.dto';
import type { ValidatableFile } from '../documents/file-validation';

/**
 * The signed-in person's OWN account — name, sign-in address, profile picture.
 *
 * Every method takes the caller's id from the verified token and nothing else:
 * there is no route parameter naming a user, so "may I edit this profile?" is
 * a question that cannot be asked. It is deliberately identity-level rather
 * than workspace-level — an HR user and a job seeker edit the same three
 * fields on the same `users` row, so there is one implementation instead of a
 * recruiter copy and a candidate copy that drift.
 *
 * What this does NOT touch:
 *   - roles and memberships (organization-scoped; see UsersService),
 *   - the CandidateAccount profile (headline, skills; see CandidateAccountService),
 *   - the `Candidate` rows organizations hold. Those carry the email a person
 *     applied WITH, snapshotted at apply time — changing your address today
 *     does not rewrite an application you sent last month.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Columns safe to return. Note the absence of passwordHash. */
  private static readonly PROFILE_SELECT = {
    id: true,
    email: true,
    fullName: true,
    accountType: true,
    preferredLocale: true,
    avatarStorageKey: true,
    avatarMimeType: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async getMine(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: AccountService.PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('Account not found');
    return this.present(user);
  }

  /**
   * Updates name and/or email.
   *
   * Uniqueness is decided by the `users.email` UNIQUE index, not by the
   * lookup: two simultaneous requests claiming the same free address both pass
   * a pre-check and one of them must still lose. The pre-check exists only so
   * the ordinary case answers 409 with a stable code instead of surfacing a
   * database error, and the P2002 catch is what actually makes it correct
   * under a race.
   *
   * Email is stored lowercased, matching registration and login, so
   * `A@x.com` cannot become a second account beside `a@x.com`.
   */
  async updateProfile(userId: string, dto: UpdateAccountProfileDto) {
    const data: { fullName?: string; email?: string } = {};

    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName.trim();
    }

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      const holder = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (holder && holder.id !== userId) throw emailAlreadyInUse();
      data.email = email;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: AccountService.PROFILE_SELECT,
      });
      return this.present(updated);
    } catch (error) {
      if (isEmailUniqueViolation(error)) throw emailAlreadyInUse();
      if ((error as { code?: string })?.code === 'P2025') {
        throw new NotFoundException('Account not found');
      }
      throw error;
    }
  }

  /**
   * Uploads or REPLACES the profile picture.
   *
   * The new object is written before the row is re-pointed, and the old object
   * is removed only after the row no longer references it — so a crash in the
   * middle leaves an orphaned object, never a profile pointing at bytes that
   * are gone. Cleanup failures are logged and swallowed for the same reason: a
   * successfully changed avatar must not be reported as a failure because the
   * bucket was briefly unhappy about the previous file.
   */
  async uploadAvatar(userId: string, file: ValidatableFile | undefined) {
    const image = validateAvatarFile(file);

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true },
    });
    if (!current) throw new NotFoundException('Account not found');

    // A fresh id per upload rather than a fixed `avatar.png` per user: a
    // replaced picture gets a new URL, so no cache anywhere can keep serving
    // the old face after the change.
    const key = `avatars/${userId}/${randomUUID()}${avatarExtensionFor(image.mimetype)}`;
    await this.storage.upload({
      key,
      body: image.buffer,
      contentType: image.mimetype,
      originalFileName: image.originalname,
    });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: key, avatarMimeType: image.mimetype },
      select: AccountService.PROFILE_SELECT,
    });

    await this.discard(current.avatarStorageKey);
    return this.present(updated);
  }

  /**
   * Removes the profile picture. Idempotent, and never touches anything else:
   * an account with no avatar is a completely valid account that renders as
   * initials — deleting a picture must not delete, disable or sign out the
   * person it belonged to.
   */
  async deleteAvatar(userId: string) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarStorageKey: true },
    });
    if (!current) throw new NotFoundException('Account not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarStorageKey: null, avatarMimeType: null },
      select: AccountService.PROFILE_SELECT,
    });

    // Row first, bytes second — see uploadAvatar.
    await this.discard(current.avatarStorageKey);
    return this.present(updated);
  }

  /**
   * Adds the short-lived URL the browser renders and drops the storage key.
   *
   * The key never leaves the backend: a client that held one could ask for a
   * signature for it forever. `avatarUrl` is null when there is no picture,
   * which is what the UI reads to fall back to initials.
   */
  private async present<T extends { avatarStorageKey: string | null }>(
    user: T,
  ): Promise<
    Omit<T, 'avatarStorageKey' | 'avatarMimeType'> & {
      avatarUrl: string | null;
    }
  > {
    const { avatarStorageKey, ...rest } = user as T & {
      avatarMimeType?: string | null;
    };
    delete (rest as { avatarMimeType?: string | null }).avatarMimeType;
    return {
      ...(rest as Omit<T, 'avatarStorageKey' | 'avatarMimeType'>),
      avatarUrl: await signAvatarUrl(this.storage, avatarStorageKey),
    };
  }

  private async discard(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(`Could not delete replaced avatar: ${String(error)}`);
    }
  }
}

/** True when a Prisma P2002 unique violation involves users.email. */
function isEmailUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes('email');
  // Some drivers report the constraint name ("users_email_key") as a string.
  return typeof target === 'string' ? target.includes('email') : true;
}

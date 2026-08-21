import { Logger } from '@nestjs/common';
import type { StorageService } from '../storage/storage.service';

const logger = new Logger('AvatarUrl');

/**
 * Turns a stored avatar key into the short-lived URL a browser can render.
 *
 * Shared by AccountService (which owns the picture) and AuthService (whose
 * `/auth/me` carries it into every screen's header), so both answer with a URL
 * minted the same way — and neither ever puts the storage key in a response.
 *
 * A key whose object has gone yields null rather than an error: an avatar with
 * no bytes must render as initials, exactly like having no avatar at all. A
 * broken picture is not a reason to fail a sign-in check.
 */
export async function signAvatarUrl(
  storage: StorageService,
  key: string | null | undefined,
): Promise<string | null> {
  if (!key) return null;
  try {
    return await storage.getSignedUrl(key);
  } catch (error) {
    logger.warn(`Could not sign avatar URL: ${String(error)}`);
    return null;
  }
}

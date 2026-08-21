import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { MAX_AVATAR_BYTES } from './account-policy';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ValidatableFile } from '../documents/file-validation';

/**
 * Self-service profile editing, for BOTH account types — the same `users` row
 * and the same rules whether the caller is a recruiter or a job seeker.
 *
 * The invariants under test are the ones a mistake would be expensive for:
 * name and email are required when sent, a taken address is refused (by the
 * unique index, not only by the lookup), and deleting a picture leaves the
 * account intact.
 */
describe('AccountService', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.alloc(64),
  ]);

  function pngFile(overrides: Partial<ValidatableFile> = {}): ValidatableFile {
    return {
      originalname: 'me.png',
      mimetype: 'image/png',
      size: PNG.byteLength,
      buffer: PNG,
      ...overrides,
    };
  }

  function createPrismaMock() {
    return {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
  }

  function createStorageMock() {
    return {
      upload: jest.fn().mockResolvedValue({ storageKey: 'k', size: 1 }),
      delete: jest.fn().mockResolvedValue(undefined),
      getSignedUrl: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(`https://signed.example/${key}`),
        ),
    };
  }

  let prisma: ReturnType<typeof createPrismaMock>;
  let storage: ReturnType<typeof createStorageMock>;
  let service: AccountService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'user-1',
    email: 'hr@northwind.test',
    fullName: 'Dana Reed',
    accountType: 'ORGANIZATION',
    preferredLocale: 'en',
    avatarStorageKey: null,
    avatarMimeType: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    storage = createStorageMock();
    service = new AccountService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  describe('updateProfile', () => {
    it('updates the name (HR and candidate alike — one code path)', async () => {
      prisma.user.update.mockResolvedValue(row({ fullName: 'Dana R. Reed' }));

      const result = await service.updateProfile('user-1', {
        fullName: 'Dana R. Reed',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { fullName: 'Dana R. Reed' },
        }),
      );
      expect(result.fullName).toBe('Dana R. Reed');
    });

    it('trims the name before storing it', async () => {
      prisma.user.update.mockResolvedValue(row());

      await service.updateProfile('user-1', { fullName: '  Dana Reed  ' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fullName: 'Dana Reed' } }),
      );
    });

    it('updates the email, lowercased so it cannot fork the account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(
        row({ email: 'new@northwind.test' }),
      );

      await service.updateProfile('user-1', { email: 'NEW@Northwind.test' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { email: 'new@northwind.test' } }),
      );
    });

    it('rejects an address another account already holds', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.updateProfile('user-1', { email: 'taken@northwind.test' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('accepts the caller re-submitting their own address', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.user.update.mockResolvedValue(row());

      await expect(
        service.updateProfile('user-1', { email: 'hr@northwind.test' }),
      ).resolves.toEqual(expect.objectContaining({ id: 'user-1' }));
    });

    /**
     * The case the pre-check cannot cover: two requests claim the same free
     * address at once and both pass the lookup. The unique index is what
     * decides, and the loser must still get the localizable 409.
     */
    it('answers 409 when the unique index rejects a racing claim', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.update.mockRejectedValue({
        code: 'P2002',
        meta: { target: ['email'] },
      });

      await expect(
        service.updateProfile('user-1', { email: 'race@northwind.test' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('never writes fields the caller did not send', async () => {
      prisma.user.update.mockResolvedValue(row());

      await service.updateProfile('user-1', {});

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} }),
      );
    });

    it('never returns the password hash or the storage key', async () => {
      prisma.user.update.mockResolvedValue(
        row({ avatarStorageKey: 'avatars/user-1/a.png' }),
      );

      const result = await service.updateProfile('user-1', {
        fullName: 'Dana Reed',
      });

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('avatarStorageKey');
      expect(result.avatarUrl).toContain('avatars/user-1/a.png');
    });
  });

  describe('avatar', () => {
    it('uploads a picture and points the row at it', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarStorageKey: null });
      prisma.user.update.mockImplementation(
        ({ data }: { data: { avatarStorageKey: string } }) =>
          Promise.resolve(row({ avatarStorageKey: data.avatarStorageKey })),
      );

      const result = await service.uploadAvatar('user-1', pngFile());

      expect(storage.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          contentType: 'image/png',
          key: expect.stringMatching(/^avatars\/user-1\/.+\.png$/) as unknown,
        }),
      );
      expect(result.avatarUrl).toContain('avatars/user-1/');
    });

    it('deletes the replaced object AFTER the row stops referencing it', async () => {
      prisma.user.findUnique.mockResolvedValue({
        avatarStorageKey: 'avatars/user-1/old.png',
      });
      const order: string[] = [];
      prisma.user.update.mockImplementation(() => {
        order.push('update');
        return Promise.resolve(
          row({ avatarStorageKey: 'avatars/user-1/new.png' }),
        );
      });
      storage.delete.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve();
      });

      await service.uploadAvatar('user-1', pngFile());

      expect(storage.delete).toHaveBeenCalledWith('avatars/user-1/old.png');
      expect(order).toEqual(['update', 'delete']);
    });

    it('refuses a non-image, whatever it claims to be', async () => {
      await expect(
        service.uploadAvatar(
          'user-1',
          pngFile({ buffer: Buffer.from('%PDF-1.4 not an image') }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('refuses an oversized image', async () => {
      await expect(
        service.uploadAvatar('user-1', pngFile({ size: MAX_AVATAR_BYTES + 1 })),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it('clears the reference on delete and keeps the account', async () => {
      prisma.user.findUnique.mockResolvedValue({
        avatarStorageKey: 'avatars/user-1/old.png',
      });
      prisma.user.update.mockResolvedValue(row({ avatarStorageKey: null }));

      const result = await service.deleteAvatar('user-1');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { avatarStorageKey: null, avatarMimeType: null },
        }),
      );
      expect(storage.delete).toHaveBeenCalledWith('avatars/user-1/old.png');
      expect(result.id).toBe('user-1');
      expect(result.avatarUrl).toBeNull();
    });

    it('is idempotent when there is no picture', async () => {
      prisma.user.findUnique.mockResolvedValue({ avatarStorageKey: null });
      prisma.user.update.mockResolvedValue(row());

      await expect(service.deleteAvatar('user-1')).resolves.toEqual(
        expect.objectContaining({ avatarUrl: null }),
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });

    /**
     * A picture whose bytes are gone must render as initials, not blow up the
     * profile — losing an avatar is not losing an account.
     */
    it('survives storage failing to sign a URL', async () => {
      prisma.user.findUnique.mockResolvedValue(
        row({ avatarStorageKey: 'avatars/user-1/gone.png' }),
      );
      storage.getSignedUrl.mockRejectedValue(new Error('missing'));

      await expect(service.getMine('user-1')).resolves.toEqual(
        expect.objectContaining({ avatarUrl: null }),
      );
    });

    it('reports a deleted account rather than writing to it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deleteAvatar('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

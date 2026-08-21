import { BadRequestException } from '@nestjs/common';
import {
  ALLOWED_AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  imageTooLarge,
  unsupportedImageType,
} from './account-policy';
import type { ValidatableFile } from '../documents/file-validation';

/** Leading bytes each accepted image format must start with. */
const MAGIC_NUMBERS: { mime: string; magic: number[] }[] = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] }, // \x89PNG
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  // WEBP is a RIFF container: "RIFF????WEBP" — the size field in between is
  // what the wildcard skips, so the tail is checked separately below.
  { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
];

/**
 * Validates an uploaded profile picture.
 *
 * Same shape as the document validator, and for the same reason: the declared
 * MIME type and the file extension are both attacker-controlled, so the magic
 * number is what actually decides the format. A PDF (or a PHP script) renamed
 * `me.png` is refused here, not stored and served back from our own origin.
 *
 * Kept separate from `validateUploadedFile` rather than parameterised into it:
 * documents accept PDF/DOCX at 50 MB and avatars accept images at 5 MB, and
 * merging them would put one list of allowed types behind a flag, where a
 * mistake silently widens the other path.
 */
export function validateAvatarFile(
  file: ValidatableFile | undefined,
): ValidatableFile {
  if (!file) {
    throw new BadRequestException('An image file is required');
  }

  const allowedExtensions = ALLOWED_AVATAR_MIME_TYPES[file.mimetype];
  if (!allowedExtensions) {
    throw unsupportedImageType(
      `Unsupported image type. Allowed: ${Object.keys(
        ALLOWED_AVATAR_MIME_TYPES,
      ).join(', ')}`,
    );
  }

  const extension = extensionOf(file.originalname);
  if (!allowedExtensions.includes(extension)) {
    throw unsupportedImageType(
      `File extension ${extension || '(none)'} does not match its content type`,
    );
  }

  if (file.size <= 0) {
    throw new BadRequestException('File is empty');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw imageTooLarge();
  }

  if (!hasExpectedMagicNumber(file)) {
    throw unsupportedImageType('File content is not the image it claims to be');
  }

  return file;
}

function hasExpectedMagicNumber(file: ValidatableFile): boolean {
  const expected = MAGIC_NUMBERS.find((entry) => entry.mime === file.mimetype);
  if (!expected) return false;
  if (!file.buffer || file.buffer.length < expected.magic.length) return false;
  if (!expected.magic.every((byte, index) => file.buffer[index] === byte)) {
    return false;
  }
  if (file.mimetype === 'image/webp') {
    // "WEBP" at offset 8, after the 4-byte RIFF tag and the 4-byte length.
    return file.buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return true;
}

/** The extension the stored object keeps, normalised and path-segment-free. */
export function avatarExtensionFor(mimeType: string): string {
  return ALLOWED_AVATAR_MIME_TYPES[mimeType]?.[0] ?? '';
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index).toLowerCase() : '';
}

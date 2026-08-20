import { BadRequestException } from '@nestjs/common';
import { fileTooLarge, unsupportedFileType } from './document-policy';

/** PDF and DOCX only, per the Phase 1 scope. */
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
};

/** Leading bytes each accepted format must start with. */
const MAGIC_NUMBERS: { mime: string; magic: number[] }[] = [
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  {
    // DOCX is a ZIP container: "PK\x03\x04".
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
];

export interface ValidatableFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Validates a browser upload.
 *
 * The declared MIME type and the file extension are both attacker-controlled,
 * so the magic-number check is what actually decides the format. All three must
 * agree before the file is stored.
 */
export function validateUploadedFile(
  file: ValidatableFile | undefined,
  maxFileSizeBytes: number,
): ValidatableFile {
  if (!file) {
    throw new BadRequestException('A file is required');
  }

  const allowedExtensions = ALLOWED_MIME_TYPES[file.mimetype];
  if (!allowedExtensions) {
    throw unsupportedFileType(
      `Unsupported file type. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`,
    );
  }

  const extension = extensionOf(file.originalname);
  if (!allowedExtensions.includes(extension)) {
    throw unsupportedFileType(
      `File extension ${extension || '(none)'} does not match its content type`,
    );
  }

  if (file.size <= 0) {
    throw new BadRequestException('File is empty');
  }
  if (file.size > maxFileSizeBytes) {
    throw fileTooLarge(maxFileSizeBytes);
  }

  if (!hasExpectedMagicNumber(file)) {
    throw unsupportedFileType('File content does not match its declared type');
  }

  return file;
}

function hasExpectedMagicNumber(file: ValidatableFile): boolean {
  const expected = MAGIC_NUMBERS.find((entry) => entry.mime === file.mimetype);
  if (!expected) return false;
  if (!file.buffer || file.buffer.length < expected.magic.length) return false;
  return expected.magic.every((byte, index) => file.buffer[index] === byte);
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index).toLowerCase() : '';
}

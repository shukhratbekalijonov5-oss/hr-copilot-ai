import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { validateUploadedFile, type ValidatableFile } from './file-validation';
import {
  DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES,
  DOCUMENT_ERROR_CODES,
} from './document-policy';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// The product limit: 50 MB per document.
const MAX = DEFAULT_MAX_DOCUMENT_UPLOAD_BYTES;

/** Builds a file whose bytes start with the given magic number. */
function makeFile(
  overrides: Partial<ValidatableFile> & { magic?: number[] } = {},
): ValidatableFile {
  const magic = overrides.magic ?? [0x25, 0x50, 0x44, 0x46]; // %PDF
  const buffer = Buffer.concat([Buffer.from(magic), Buffer.alloc(64, 0x41)]);
  return {
    originalname: 'resume.pdf',
    mimetype: PDF_MIME,
    size: buffer.byteLength,
    buffer,
    ...overrides,
  };
}

describe('validateUploadedFile', () => {
  it('accepts a well-formed PDF', () => {
    const file = makeFile();
    expect(validateUploadedFile(file, MAX)).toBe(file);
  });

  it('accepts a well-formed DOCX', () => {
    const file = makeFile({
      originalname: 'resume.docx',
      mimetype: DOCX_MIME,
      magic: [0x50, 0x4b, 0x03, 0x04], // PK\x03\x04
    });
    expect(validateUploadedFile(file, MAX)).toBe(file);
  });

  it('requires a file', () => {
    expect(() => validateUploadedFile(undefined, MAX)).toThrow(
      BadRequestException,
    );
  });

  describe('type validation', () => {
    it('rejects an unsupported MIME type', () => {
      const file = makeFile({
        originalname: 'photo.png',
        mimetype: 'image/png',
      });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /Unsupported file type/,
      );
    });

    it('rejects plain text renamed to .pdf', () => {
      const file = makeFile({ mimetype: 'text/plain' });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /Unsupported file type/,
      );
    });

    it('rejects a mismatch between extension and declared type', () => {
      const file = makeFile({
        originalname: 'resume.docx',
        mimetype: PDF_MIME,
      });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /does not match its content type/,
      );
    });

    it('rejects a file with no extension', () => {
      const file = makeFile({ originalname: 'resume' });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /does not match its content type/,
      );
    });

    /**
     * The important case: MIME type and extension are both attacker-controlled,
     * so an executable renamed to resume.pdf must still be caught by content.
     */
    it('rejects content that does not match its declared type', () => {
      const file = makeFile({ magic: [0x4d, 0x5a, 0x90, 0x00] }); // MZ (PE binary)
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /content does not match its declared type/,
      );
    });

    it('rejects a ZIP claiming to be a PDF', () => {
      const file = makeFile({ magic: [0x50, 0x4b, 0x03, 0x04] });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /content does not match its declared type/,
      );
    });

    it('rejects a buffer too short to carry a magic number', () => {
      const file = makeFile();
      file.buffer = Buffer.from([0x25, 0x50]);
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /content does not match its declared type/,
      );
    });
  });

  describe('size validation (50 MB product limit)', () => {
    // Sizes are asserted through the metadata field, never by allocating
    // multi-megabyte buffers — the magic-number check only reads the head.
    it('the default limit is exactly 50 MB', () => {
      expect(MAX).toBe(50 * 1024 * 1024);
    });

    it('rejects an empty file', () => {
      const file = makeFile({ size: 0 });
      expect(() => validateUploadedFile(file, MAX)).toThrow(/File is empty/);
    });

    it('accepts a 20 MB file (the old lower limit is gone)', () => {
      const file = makeFile({ size: 20 * 1024 * 1024 });
      expect(() => validateUploadedFile(file, MAX)).not.toThrow();
    });

    it('accepts a 49 MB file', () => {
      const file = makeFile({ size: 49 * 1024 * 1024 });
      expect(() => validateUploadedFile(file, MAX)).not.toThrow();
    });

    it('accepts a file of exactly 50 MB', () => {
      const file = makeFile({ size: MAX });
      expect(() => validateUploadedFile(file, MAX)).not.toThrow();
    });

    it('rejects one byte over the limit as 413 FILE_TOO_LARGE', () => {
      const file = makeFile({ size: MAX + 1 });
      try {
        validateUploadedFile(file, MAX);
        fail('expected the validator to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(PayloadTooLargeException);
        expect((error as PayloadTooLargeException).getResponse()).toMatchObject(
          {
            code: DOCUMENT_ERROR_CODES.FILE_TOO_LARGE,
            message: 'File exceeds the 50 MB limit',
          },
        );
      }
    });
  });

  describe('stable error codes', () => {
    it('type rejections carry UNSUPPORTED_FILE_TYPE for localization', () => {
      const file = makeFile({ mimetype: 'application/zip' });
      try {
        validateUploadedFile(file, MAX);
        fail('expected the validator to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: DOCUMENT_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
        });
      }
    });
  });
});

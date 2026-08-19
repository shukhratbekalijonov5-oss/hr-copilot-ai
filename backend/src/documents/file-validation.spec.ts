import { BadRequestException } from '@nestjs/common';
import { validateUploadedFile, type ValidatableFile } from './file-validation';

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX = 10 * 1024 * 1024;

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

  describe('size validation', () => {
    it('rejects an empty file', () => {
      const file = makeFile({ size: 0 });
      expect(() => validateUploadedFile(file, MAX)).toThrow(/File is empty/);
    });

    it('rejects a file above the limit', () => {
      const file = makeFile({ size: MAX + 1 });
      expect(() => validateUploadedFile(file, MAX)).toThrow(
        /exceeds the 10 MB limit/,
      );
    });

    it('accepts a file exactly at the limit', () => {
      const file = makeFile({ size: MAX });
      expect(() => validateUploadedFile(file, MAX)).not.toThrow();
    });
  });
});

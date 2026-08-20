import { DocumentsController, inlineDisposition } from './documents.controller';
import type { DocumentsService } from './documents.service';
import type { LocalStorageService } from '../storage/local-storage.service';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

/**
 * The local-driver download route is what the candidate-detail preview iframe
 * loads. Its headers ARE the feature: a PDF served as octet-stream is
 * downloaded (or ignored) by the browser instead of rendered, which left the
 * preview panel permanently blank.
 */
describe('DocumentsController download (local driver)', () => {
  const PDF = Buffer.from('%PDF-1.4 fake');

  function makeRes(): Response & { headers: Record<string, unknown> } {
    const headers: Record<string, unknown> = {};
    return {
      headers,
      setHeader: jest.fn((name: string, value: unknown) => {
        headers[name.toLowerCase()] = value;
      }),
      send: jest.fn(),
    } as unknown as Response & { headers: Record<string, unknown> };
  }

  function makeController(metadata: unknown) {
    const documentsService = {
      getServingMetadata: jest.fn().mockResolvedValue(metadata),
    };
    const localStorage = { readSigned: jest.fn().mockResolvedValue(PDF) };
    const controller = new DocumentsController(
      documentsService as unknown as DocumentsService,
      localStorage as unknown as LocalStorageService,
      {} as ConfigService,
    );
    return { controller, documentsService, localStorage };
  }

  it('serves the stored mime type and an inline disposition so a PDF renders in-page', async () => {
    const { controller, localStorage } = makeController({
      mimeType: 'application/pdf',
      originalFileName: 'hr_copilot_test_resume.pdf',
    });
    const res = makeRes();

    await controller.download('org/abc/doc.pdf', '9999999999', 'sig', res);

    // Signature verification always runs first — headers grant nothing.
    expect(localStorage.readSigned).toHaveBeenCalledWith(
      'org/abc/doc.pdf',
      9999999999,
      'sig',
    );
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['content-disposition']).toContain(
      'hr_copilot_test_resume.pdf',
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.send).toHaveBeenCalledWith(PDF);
  });

  it('falls back to octet-stream for an object with no database row', async () => {
    const { controller } = makeController(null);
    const res = makeRes();

    await controller.download('org/abc/orphan.bin', '9999999999', 'sig', res);

    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('inline');
  });

  it('an invalid signature never reaches the metadata lookup', async () => {
    const { controller, documentsService, localStorage } = makeController({
      mimeType: 'application/pdf',
      originalFileName: 'x.pdf',
    });
    localStorage.readSigned.mockRejectedValue(new Error('Invalid link'));

    await expect(
      controller.download('org/abc/doc.pdf', '1', 'forged', makeRes()),
    ).rejects.toThrow('Invalid link');
    expect(documentsService.getServingMetadata).not.toHaveBeenCalled();
  });
});

describe('inlineDisposition', () => {
  it('is always inline, with the plain name as fallback', () => {
    expect(inlineDisposition('resume.pdf')).toBe(
      `inline; filename="resume.pdf"; filename*=UTF-8''resume.pdf`,
    );
  });

  it('carries non-ASCII names via RFC 5987 (ko/ru/uz uploads are routine)', () => {
    const value = inlineDisposition('이력서.pdf');
    expect(value).toContain("filename*=UTF-8''%EC%9D%B4%EB%A0%A5%EC%84%9C.pdf");
  });

  it('strips header-breaking characters from the fallback name', () => {
    const value = inlineDisposition('bad"name\r\nSet-Cookie: x.pdf');
    const fallback = /filename="([^"]*)"/.exec(value)![1];
    expect(fallback).not.toMatch(/[\r\n"]/);
  });
});

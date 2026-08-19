import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { AiServiceClient, AiServiceDisabledError } from './ai-service.client';

const TOKEN = 'shared-internal-service-token';

function makeClient(baseUrl: string, token = TOKEN): AiServiceClient {
  const config = {
    get: jest.fn((key: string, fallback: unknown) => {
      if (key === 'ai.baseUrl') return baseUrl;
      if (key === 'ai.internalToken') return token;
      return fallback;
    }),
  } as unknown as ConfigService;
  return new AiServiceClient(config);
}

function mockFetch(
  response: Partial<Response> & { json?: () => Promise<unknown> },
) {
  const fn = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({}),
    ...response,
  });
  global.fetch = fn;
  return fn;
}

describe('AiServiceClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('when AI_SERVICE_URL is unset', () => {
    let client: AiServiceClient;
    beforeEach(() => {
      client = makeClient('');
    });

    it('reports itself disabled', () => {
      expect(client.enabled).toBe(false);
    });

    it('refuses to process a document rather than faking a result', async () => {
      await expect(
        client.processDocument({
          documentId: 'd1',
          organizationId: 'org-a',
          candidateId: null,
          fileName: 'cv.pdf',
          documentType: 'RESUME',
          content: Buffer.from('%PDF'),
          mimeType: 'application/pdf',
        }),
      ).rejects.toBeInstanceOf(AiServiceDisabledError);
    });

    it('refuses to search rather than inventing hits', async () => {
      await expect(
        client.searchEvidence('kubernetes', { organizationId: 'org-a' }),
      ).rejects.toBeInstanceOf(AiServiceDisabledError);
    });

    it('refuses to rerank', async () => {
      await expect(client.rerank('kubernetes', [])).rejects.toBeInstanceOf(
        AiServiceDisabledError,
      );
    });
  });

  describe('internal authentication', () => {
    it('sends the shared service token on every call', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ hits: [] }),
      });

      await makeClient('http://ai:8000').searchEvidence('kubernetes', {
        organizationId: 'org-a',
      });

      const headers = fetchMock.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Internal-Service-Token']).toBe(TOKEN);
    });

    it('never sends a user Authorization header', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ hits: [] }),
      });

      await makeClient('http://ai:8000').searchEvidence('kubernetes', {
        organizationId: 'org-a',
      });

      const headers = fetchMock.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers.Authorization).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
    });

    it('sends the token on multipart document processing too', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ vectorsIndexed: 1 }),
      });

      await makeClient('http://ai:8000').processDocument({
        documentId: 'd1',
        organizationId: 'org-a',
        candidateId: 'c1',
        fileName: 'cv.pdf',
        documentType: 'RESUME',
        content: Buffer.from('%PDF-1.4'),
        mimeType: 'application/pdf',
      });

      const headers = fetchMock.mock.calls[0][1].headers as Record<
        string,
        string
      >;
      expect(headers['X-Internal-Service-Token']).toBe(TOKEN);
    });
  });

  describe('processDocument', () => {
    it('posts multipart form data to the internal route', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ vectorsIndexed: 3 }),
      });

      await makeClient('http://ai:8000').processDocument({
        documentId: 'd1',
        organizationId: 'org-a',
        candidateId: 'c1',
        fileName: 'cv.pdf',
        documentType: 'RESUME',
        content: Buffer.from('%PDF-1.4'),
        mimeType: 'application/pdf',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ai:8000/internal/documents/process');
      expect(init.body).toBeInstanceOf(FormData);

      const form = init.body as FormData;
      expect(form.get('documentId')).toBe('d1');
      expect(form.get('organizationId')).toBe('org-a');
      expect(form.get('candidateId')).toBe('c1');
    });

    it('omits candidateId when the document has no candidate', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ vectorsIndexed: 1 }),
      });

      await makeClient('http://ai:8000').processDocument({
        documentId: 'd1',
        organizationId: 'org-a',
        candidateId: null,
        fileName: 'cv.pdf',
        documentType: 'RESUME',
        content: Buffer.from('%PDF-1.4'),
        mimeType: 'application/pdf',
      });

      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get('candidateId')).toBeNull();
    });
  });

  describe('searchEvidence', () => {
    it('always sends the organizationId it was given', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ hits: [] }),
      });

      await makeClient('http://ai:8000').searchEvidence('kubernetes', {
        organizationId: 'org-a',
        candidateId: 'c1',
        limit: 5,
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.organizationId).toBe('org-a');
      expect(body.candidateId).toBe('c1');
      expect(body.limit).toBe(5);
    });

    it('defaults to reranking on', async () => {
      const fetchMock = mockFetch({
        json: () => Promise.resolve({ hits: [] }),
      });

      await makeClient('http://ai:8000').searchEvidence('kubernetes', {
        organizationId: 'org-a',
      });

      expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).rerank).toBe(
        true,
      );
    });
  });

  describe('error handling', () => {
    it('maps a non-2xx response to ServiceUnavailable', async () => {
      mockFetch({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () => Promise.resolve({ code: 'corrupt_document' }),
      });

      await expect(
        makeClient('http://ai:8000').searchEvidence('x', {
          organizationId: 'o',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('surfaces the AI service error code, not an arbitrary body', async () => {
      mockFetch({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: () => Promise.resolve({ code: 'empty_document' }),
      });

      await expect(
        makeClient('http://ai:8000').searchEvidence('x', {
          organizationId: 'o',
        }),
      ).rejects.toThrow(/empty_document/);
    });

    it('never leaks the token in an error message', async () => {
      mockFetch({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        json: () => Promise.resolve({}),
      });

      await expect(
        makeClient('http://ai:8000').searchEvidence('x', {
          organizationId: 'o',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining(TOKEN),
        }),
      );
    });

    it('reports a timeout as ServiceUnavailable', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        );

      await expect(
        makeClient('http://ai:8000').searchEvidence('x', {
          organizationId: 'o',
        }),
      ).rejects.toThrow(/did not respond within/);
    });
  });
});

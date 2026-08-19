import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Boundary to the (future) Python FastAPI AI service.
 *
 * IMPORTANT — this client does not implement any AI. While AI_SERVICE_URL is
 * unset the methods throw AiServiceDisabledError. They never return invented
 * parses, embeddings, evidence or rankings: a fabricated result here would flow
 * into candidate evidence a human is meant to trust.
 *
 * Wiring up the real service means implementing the HTTP calls below; no
 * business logic outside this file should need to change.
 */

export class AiServiceDisabledError extends Error {
  constructor(operation: string) {
    super(
      `AI service is not configured (AI_SERVICE_URL is unset); cannot ${operation}`,
    );
    this.name = 'AiServiceDisabledError';
  }
}

export interface ParsedDocumentResult {
  documentId: string;
  pageCount: number;
  sections: { page: number; section: string | null; text: string }[];
}

export interface EmbeddingResult {
  documentId: string;
  chunkCount: number;
}

export interface EvidenceSearchFilters {
  organizationId: string;
  vacancyId?: string;
  candidateId?: string;
  requirementId?: string;
  limit?: number;
}

export interface EvidenceSearchHit {
  candidateId: string;
  documentId: string;
  pageNumber: number | null;
  section: string | null;
  text: string;
}

@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>('ai.baseUrl', '').trim();
    this.timeoutMs = configService.get<number>('ai.timeoutMs', 30_000);

    if (!this.enabled) {
      this.logger.warn(
        'AI service integration is disabled (AI_SERVICE_URL not set). ' +
          'Document processing jobs will fail fast rather than fabricate results.',
      );
    }
  }

  /** False until the Python service is deployed and AI_SERVICE_URL is set. */
  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  async parseDocument(documentId: string): Promise<ParsedDocumentResult> {
    this.assertEnabled('parse document');
    return this.post<ParsedDocumentResult>('/v1/parse', { documentId });
  }

  async generateEmbeddings(documentId: string): Promise<EmbeddingResult> {
    this.assertEnabled('generate embeddings');
    return this.post<EmbeddingResult>('/v1/embeddings', { documentId });
  }

  async searchEvidence(
    query: string,
    filters: EvidenceSearchFilters,
  ): Promise<EvidenceSearchHit[]> {
    this.assertEnabled('search evidence');
    return this.post<EvidenceSearchHit[]>('/v1/search', { query, filters });
  }

  async rerank(
    query: string,
    candidates: EvidenceSearchHit[],
  ): Promise<EvidenceSearchHit[]> {
    this.assertEnabled('rerank results');
    return this.post<EvidenceSearchHit[]>('/v1/rerank', { query, candidates });
  }

  private assertEnabled(operation: string): void {
    if (!this.enabled) throw new AiServiceDisabledError(operation);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ServiceUnavailableException(
          `AI service responded with ${response.status}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

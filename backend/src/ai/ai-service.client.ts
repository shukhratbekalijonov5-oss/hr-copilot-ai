import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Boundary to the Python FastAPI AI service.
 *
 * Everything AI-related crosses this file and nothing else needs to know the
 * service exists. Two rules hold here:
 *
 *  - While AI_SERVICE_URL is unset the methods throw AiServiceDisabledError.
 *    They never return invented parses, embeddings, evidence or rankings — a
 *    fabricated result would flow into candidate evidence a human is meant to
 *    trust.
 *  - Backend-to-AI calls authenticate with INTERNAL_SERVICE_TOKEN, a dedicated
 *    service credential. A recruiter's JWT is never forwarded: an end-user
 *    token must not be replayable against internal machinery.
 */

export class AiServiceDisabledError extends Error {
  constructor(operation: string) {
    super(
      `AI service is not configured (AI_SERVICE_URL is unset); cannot ${operation}`,
    );
    this.name = 'AiServiceDisabledError';
  }
}

/** One stage of the processing pipeline, as actually executed. */
export interface ProcessingStageResult {
  stage: 'parsing' | 'chunking' | 'embedding' | 'indexing';
  durationMs: number;
  detail: string;
}

export interface ProcessDocumentInput {
  documentId: string;
  organizationId: string;
  candidateId: string | null;
  fileName: string;
  documentType: string;
  content: Buffer;
  mimeType: string;
}

export interface ProcessDocumentResult {
  documentId: string;
  pageCount: number;
  chunksCreated: number;
  vectorsIndexed: number;
  sectionsDetected: string[];
  embeddingModel: string;
  embeddingDimension: number;
  durationMs: number;
  stages: ProcessingStageResult[];
}

export interface EvidenceSearchFilters {
  /** Always the authenticated user's organization. Never client-supplied. */
  organizationId: string;
  candidateId?: string;
  documentId?: string;
  limit?: number;
  rerank?: boolean;
}

/**
 * One retrieved passage.
 *
 * `retrievalScore` and `rerankScore` measure how well the passage matches the
 * *query*. Neither is a candidate score, a hiring score or a probability of
 * success, and neither may be presented as one.
 */
export interface EvidenceSearchHit {
  candidateId: string | null;
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  chunkIndex: number;
  text: string;
  retrievalScore: number;
  rerankScore: number | null;
}

export interface EvidenceSearchResult {
  query: string;
  hits: EvidenceSearchHit[];
  totalCandidatesConsidered: number;
  reranked: boolean;
  durationMs: number;
}

/** Locales the product supports for AI generation. */
export const SUPPORTED_LOCALES = ['en', 'ko', 'ru', 'uz'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** A verified pointer back to the passage supporting a claim. */
export interface AiCitation {
  chunkId: string;
  documentId: string;
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
}

/**
 * Quality of the ANSWER and its evidence — never a statement about the
 * candidate and never a hiring decision label.
 */
export type AnswerStatus =
  'GROUNDED' | 'INSUFFICIENT_EVIDENCE' | 'NEEDS_HUMAN_REVIEW';

export interface AiRagResult {
  answer: string;
  status: AnswerStatus;
  citations: AiCitation[];
  locale: SupportedLocale;
  rejectedCitations: string[];
  evidenceConsidered: number;
  durationMs: number;
  model: string | null;
}

export interface AiCandidateSummaryResult {
  summary: string;
  status: AnswerStatus;
  citations: AiCitation[];
  locale: SupportedLocale;
  rejectedCitations: string[];
  durationMs: number;
  model: string | null;
}

export type EvidenceMappingStatus =
  'EVIDENCE_FOUND' | 'NO_EVIDENCE_FOUND' | 'NEEDS_HUMAN_REVIEW';

export interface AiRequirementInput {
  requirementId: string;
  text: string;
  type?: string | null;
  required?: boolean;
}

export interface AiRequirementMapping {
  requirementId: string;
  requirementText: string;
  status: EvidenceMappingStatus;
  evidence: AiCitation[];
  matchedTerms: string[];
  missingTerms: string[];
  reason: string;
}

export interface AiEvidenceMapResult {
  candidateId: string;
  vacancyId: string;
  requirements: AiRequirementMapping[];
  durationMs: number;
}

export interface AiInterviewQuestion {
  question: string;
  reason: string;
  kind: 'evidence_probe' | 'missing_requirement_probe';
  requirementId: string | null;
  citations: AiCitation[];
}

export interface AiInterviewQuestionsResult {
  candidateId: string;
  vacancyId: string;
  questions: AiInterviewQuestion[];
  locale: SupportedLocale;
  durationMs: number;
  model: string | null;
}

export interface AiHealthResult {
  status: 'ok' | 'error';
  checks: Record<string, { status: 'up' | 'down'; error?: string | null }>;
}

// --- Candidate-side (Job Match) ---------------------------------------------
// These contracts are keyed by candidateAccountId — the caller's OWN account,
// derived server-side — and touch only the candidate-scoped collections.

export interface ProcessPersonalResumeResult {
  documentId: string;
  pageCount: number;
  chunksCreated: number;
  vectorsIndexed: number;
  durationMs: number;
}

export interface VacancyIndexInput {
  vacancyId: string;
  organizationId: string;
  status: string;
  title: string;
  description?: string | null;
  location?: string | null;
  employmentType?: string | null;
  /** Candidate-visible requirements ONLY — never recruiter-private notes. */
  requirements: { text: string; required: boolean }[];
}

export interface AiCandidateProfile {
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  skills: string[];
  languages: string[];
  experience: {
    title: string;
    company?: string | null;
    description?: string | null;
  }[];
  education: {
    institution: string;
    degree?: string | null;
    field?: string | null;
  }[];
}

export type JobMatchLabel = 'STRONG' | 'PARTIAL' | 'WEAK';

export interface AiRequirementCheck {
  text: string;
  required: boolean;
  reason: string;
}

export interface AiMatchEvidence {
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
}

export interface AiJobMatch {
  vacancyId: string;
  organizationId: string;
  title: string;
  /** Deterministic evidence-coverage label — never an LLM judgement. */
  match: JobMatchLabel;
  explanation: string | null;
  supportedRequirements: AiRequirementCheck[];
  unsupportedRequirements: AiRequirementCheck[];
  unclearRequirements: AiRequirementCheck[];
  evidence: AiMatchEvidence[];
}

export interface AiJobMatchResult {
  matches: AiJobMatch[];
  locale: SupportedLocale;
  vacanciesConsidered: number;
  generated: boolean;
  durationMs: number;
}

@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>('ai.baseUrl', '').trim();
    this.internalToken = configService
      .get<string>('ai.internalToken', '')
      .trim();
    this.timeoutMs = configService.get<number>('ai.timeoutMs', 120_000);

    if (!this.enabled) {
      this.logger.warn(
        'AI service integration is disabled (AI_SERVICE_URL not set). ' +
          'Document processing jobs will fail fast rather than fabricate results.',
      );
    } else if (!this.internalToken) {
      // Every /internal/* route rejects an unauthenticated call, so this is
      // fatal in practice; surface it at boot rather than per-job.
      this.logger.error(
        'AI_SERVICE_URL is set but INTERNAL_SERVICE_TOKEN is empty; ' +
          'the AI service will reject every request.',
      );
    }
  }

  /** False until the Python service is deployed and AI_SERVICE_URL is set. */
  get enabled(): boolean {
    return this.baseUrl.length > 0;
  }

  /**
   * Parses, chunks, embeds and indexes one document.
   *
   * The file is streamed over the internal channel rather than handed over as
   * a URL: documents stay private (no public or signed URL is ever minted for
   * the AI service) and the same path works for local-disk and R2 storage.
   *
   * Safe to call again for the same documentId — the AI service replaces that
   * document's vectors rather than appending, so a BullMQ retry cannot
   * duplicate them.
   */
  async processDocument(
    input: ProcessDocumentInput,
  ): Promise<ProcessDocumentResult> {
    this.assertEnabled('process document');

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.content)], { type: input.mimeType }),
      input.fileName,
    );
    form.append('documentId', input.documentId);
    form.append('organizationId', input.organizationId);
    form.append('fileName', input.fileName);
    form.append('documentType', input.documentType);
    if (input.candidateId) form.append('candidateId', input.candidateId);

    return this.request<ProcessDocumentResult>(
      '/internal/documents/process',
      form,
    );
  }

  /** Semantic evidence search, always scoped to one organization. */
  async searchEvidence(
    query: string,
    filters: EvidenceSearchFilters,
  ): Promise<EvidenceSearchResult> {
    this.assertEnabled('search evidence');

    return this.request<EvidenceSearchResult>('/internal/search', {
      organizationId: filters.organizationId,
      query,
      candidateId: filters.candidateId ?? null,
      documentId: filters.documentId ?? null,
      limit: filters.limit ?? 10,
      rerank: filters.rerank ?? true,
    });
  }

  /** Reorders supplied passages by query relevance. Provenance is preserved. */
  async rerank(
    query: string,
    hits: EvidenceSearchHit[],
    limit = 10,
  ): Promise<EvidenceSearchHit[]> {
    this.assertEnabled('rerank results');

    const result = await this.request<{ hits: EvidenceSearchHit[] }>(
      '/internal/rerank',
      { query, hits, limit },
    );
    return result.hits;
  }

  /**
   * Answers a question using only the candidate's indexed evidence.
   *
   * The AI service refuses rather than improvising when retrieval is empty,
   * and every citation it returns has been validated against the retrieved
   * context — a fabricated chunk id never reaches this method.
   */
  async answerQuestion(input: {
    organizationId: string;
    query: string;
    candidateId?: string | null;
    vacancyId?: string | null;
    locale: SupportedLocale;
    limit?: number;
  }): Promise<AiRagResult> {
    this.assertEnabled('answer a question');
    return this.request<AiRagResult>('/internal/rag', {
      organizationId: input.organizationId,
      query: input.query,
      candidateId: input.candidateId ?? null,
      vacancyId: input.vacancyId ?? null,
      locale: input.locale,
      limit: input.limit ?? 8,
    });
  }

  /** Summarises what a candidate's documents state. No quality judgement. */
  async summariseCandidate(input: {
    organizationId: string;
    candidateId: string;
    locale: SupportedLocale;
    limit?: number;
  }): Promise<AiCandidateSummaryResult> {
    this.assertEnabled('summarise a candidate');
    return this.request<AiCandidateSummaryResult>(
      '/internal/candidates/summary',
      {
        organizationId: input.organizationId,
        candidateId: input.candidateId,
        locale: input.locale,
        limit: input.limit ?? 12,
      },
    );
  }

  /**
   * Maps job requirements to candidate evidence.
   *
   * Retrieval and classification only — no LLM — so this keeps working when
   * generation is unconfigured or the provider is down.
   */
  async mapEvidence(input: {
    organizationId: string;
    candidateId: string;
    vacancyId: string;
    requirements: AiRequirementInput[];
    locale?: SupportedLocale;
  }): Promise<AiEvidenceMapResult> {
    this.assertEnabled('map requirement evidence');
    return this.request<AiEvidenceMapResult>('/internal/evidence-map', {
      organizationId: input.organizationId,
      candidateId: input.candidateId,
      vacancyId: input.vacancyId,
      requirements: input.requirements,
      locale: input.locale ?? 'en',
    });
  }

  /** Interview prompts drawn from present and missing evidence. */
  async interviewQuestions(input: {
    organizationId: string;
    candidateId: string;
    vacancyId: string;
    requirements: AiRequirementInput[];
    locale: SupportedLocale;
  }): Promise<AiInterviewQuestionsResult> {
    this.assertEnabled('generate interview questions');
    return this.request<AiInterviewQuestionsResult>(
      '/internal/interview-questions',
      {
        organizationId: input.organizationId,
        candidateId: input.candidateId,
        vacancyId: input.vacancyId,
        requirements: input.requirements,
        locale: input.locale,
      },
    );
  }

  /** Removes a document's vectors, e.g. when the document is deleted. */
  async deleteDocument(
    organizationId: string,
    documentId: string,
  ): Promise<void> {
    this.assertEnabled('delete document vectors');
    await this.request('/internal/documents/delete', {
      organizationId,
      documentId,
    });
  }

  // --- Candidate-side (Job Match) ---------------------------------------

  /**
   * Indexes a PERSONAL resume into the candidate-scoped collection — a
   * physically separate Qdrant collection from tenant data. There is no
   * organizationId anywhere in this path.
   */
  async processPersonalResume(input: {
    documentId: string;
    candidateAccountId: string;
    fileName: string;
    content: Buffer;
    mimeType: string;
  }): Promise<ProcessPersonalResumeResult> {
    this.assertEnabled('process personal resume');

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.content)], { type: input.mimeType }),
      input.fileName,
    );
    form.append('documentId', input.documentId);
    form.append('candidateAccountId', input.candidateAccountId);
    form.append('fileName', input.fileName);

    return this.request<ProcessPersonalResumeResult>(
      '/internal/candidate/documents/process',
      form,
    );
  }

  /** Removes a personal resume's vectors (owner-scoped, idempotent). */
  async deletePersonalResume(
    candidateAccountId: string,
    documentId: string,
  ): Promise<void> {
    this.assertEnabled('delete personal resume vectors');
    await this.request('/internal/candidate/documents/delete', {
      candidateAccountId,
      documentId,
    });
  }

  /** Indexes one vacancy's candidate-visible content. Idempotent. */
  async indexVacancy(input: VacancyIndexInput): Promise<void> {
    this.assertEnabled('index vacancy');
    await this.request('/internal/vacancies/index', input);
  }

  /** Removes a vacancy from the candidate-discoverable index. Idempotent. */
  async deleteVacancyIndex(vacancyId: string): Promise<void> {
    this.assertEnabled('delete vacancy index');
    await this.request('/internal/vacancies/delete', { vacancyId });
  }

  /**
   * Candidate → vacancy matching over the candidate's OWN data only.
   * Labels are deterministic; one batched generation call writes the prose.
   */
  async candidateJobMatches(input: {
    candidateAccountId: string;
    profile: AiCandidateProfile;
    locale: SupportedLocale;
    limit?: number;
  }): Promise<AiJobMatchResult> {
    this.assertEnabled('match jobs');
    return this.request<AiJobMatchResult>('/internal/candidate/job-matches', {
      candidateAccountId: input.candidateAccountId,
      profile: input.profile,
      locale: input.locale,
      limit: input.limit ?? 5,
    });
  }

  /** Readiness of the AI service itself; surfaced by /health/ready. */
  async health(): Promise<AiHealthResult> {
    this.assertEnabled('check health');

    const response = await fetch(`${this.baseUrl}/health/ready`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    return (await response.json()) as AiHealthResult;
  }

  private assertEnabled(operation: string): void {
    if (!this.enabled) throw new AiServiceDisabledError(operation);
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const isForm = body instanceof FormData;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          // The service credential. Never a user JWT, and never logged.
          'X-Internal-Service-Token': this.internalToken,
          ...(isForm ? {} : { 'content-type': 'application/json' }),
        },
        body: isForm ? body : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `AI service responded with ${response.status}: ${await readErrorCode(response)}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException(
          `AI service did not respond within ${this.timeoutMs}ms`,
        );
      }
      // fetch() surfaces network faults (connection refused, DNS failure,
      // reset) as TypeError. That is a dependency being unreachable — a 503 —
      // not an internal error, and the raw cause (which may embed the AI
      // service URL) is logged here rather than returned to the client.
      if (error instanceof TypeError) {
        this.logger.error(
          `AI service is unreachable: ${(error as Error & { cause?: Error }).cause?.message ?? error.message}`,
        );
        throw new ServiceUnavailableException('AI service is unreachable');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Extracts the AI service's structured error code. Falls back to the status
 * text — never dumps an arbitrary response body, which could quote document
 * text back into a log or an HTTP error.
 */
async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    return body.code ?? body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

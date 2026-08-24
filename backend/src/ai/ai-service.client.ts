import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EvidenceSourceType } from '../common/evidence/evidence-source';

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
  /**
   * The AUTHORIZED retrieval universe: candidate accounts the caller may
   * read, resolved server-side from the applicant relationships of the
   * caller's OWN vacancies. Never client-supplied. An empty list means
   * "nothing is retrievable" and short-circuits to zero hits.
   */
  candidateAccountIds: string[];
  /** Narrow to ONE current source (a personal document or link id). */
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
  candidateAccountId: string | null;
  /**
   * Id of the CURRENT source this passage came from — a personal Document id
   * for a FILE, a CandidateLink id for a URL. One key space, so deletion and
   * idempotent re-indexing work identically for both.
   */
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  chunkIndex: number;
  text: string;
  retrievalScore: number;
  rerankScore: number | null;
  /** FILE unless stated otherwise — chunks indexed before links existed. */
  sourceType?: EvidenceSourceType;
  /** Human-readable source name ("Resume.pdf", "Portfolio Website"). */
  sourceTitle?: string | null;
  /** The page this passage came from. URL sources only. */
  sourceUrl?: string | null;
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

/**
 * The selected vacancy's grounding context for generation. Candidate-visible
 * fields only (title + requirement texts) — never recruiter-private notes.
 * Passing it makes summaries/answers vacancy-contextual ("how does this
 * evidence relate to THIS vacancy") instead of generic.
 */
export interface AiVacancyContext {
  vacancyId: string;
  title: string;
  requirements: { text: string; required: boolean }[];
}

/**
 * A verified pointer back to the passage supporting a claim.
 *
 * Source-agnostic on purpose: `sourceType` says whether a recruiter should be
 * shown "Resume.pdf · page 2" or "Portfolio Website · Projects ·
 * portfolio.example.com/projects". Collapsing both into "candidate evidence"
 * would hide where a claim actually came from, which is the one thing a
 * citation exists to tell you.
 *
 * `sourceType`/`sourceUrl`/`sourceTitle` are optional so citations produced
 * from chunks indexed before links existed still parse; absent means FILE.
 */
export interface AiCitation {
  chunkId: string;
  documentId: string;
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
  sourceType?: EvidenceSourceType;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
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

// --- Web (URL) evidence sources ---------------------------------------------
//
// The mirror image of processDocument: the backend has ALREADY fetched,
// bounded and normalized the page (see src/web-ingestion), so what crosses
// this boundary is plain text sections — never a URL for the AI service to
// fetch. The AI service performs no network egress to candidate-supplied
// destinations, and this contract is what makes that structurally true.

export interface AiEvidenceSection {
  /** Canonical section name (summary/experience/projects/...), when known. */
  name: string | null;
  /** The heading as written on the page. */
  heading: string | null;
  text: string;
  /** The exact page this text came from — may be a subpage of the link. */
  url: string | null;
}

export interface IndexWebSourceInput {
  /** Stable id of the source row. Becomes the chunk key, so re-indexing is idempotent. */
  sourceId: string;
  /** Human-readable source name for citations ("Portfolio Website"). */
  title: string;
  /** The submitted link. Shown in citations; never fetched by the AI service. */
  url: string;
  detectedType?: string | null;
  sections: AiEvidenceSection[];
}

export interface IndexWebSourceResult {
  sourceId: string;
  chunksCreated: number;
  vectorsIndexed: number;
  durationMs: number;
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

/**
 * One external job, as PUBLIC facts only, for semantic indexing.
 *
 * No provider, no source count, no trust class — deliberately. A job is not a
 * better answer to a search because of where this product found it, and the
 * surest way to keep that true is for the index to be unable to know.
 */
export interface ExternalJobIndexInput {
  externalJobId: string;
  status: string;
  title: string;
  companyName?: string | null;
  description?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  workMode?: string | null;
  employmentType?: string | null;
  seniorityLevel?: string | null;
}

export interface ExternalJobSemanticHit {
  externalJobId: string;
  /** Raw cosine similarity. The caller decides what is worth proposing. */
  similarity: number;
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
  /** Lets Job Match say "Portfolio Website · DevOps Project", not just a name. */
  sourceType?: EvidenceSourceType;
  sourceUrl?: string | null;
}

export interface AiJobMatch {
  vacancyId: string;
  organizationId: string;
  title: string;
  /** Categorical label, DERIVED from `score` so the two cannot disagree. */
  match: JobMatchLabel;
  /**
   * 0-100. Orders the ranked list and nothing else — not a probability of
   * being hired and not a percentage of the role the person can do.
   */
  score: number;
  /** 1-based position in the FULL ranked list. Stable for one run. */
  rank: number;
  /** Per-signal breakdown (semantic/required/preferred/skills/roleFamily). */
  signals: Record<string, number>;
  matchedSkills: string[];
  missingSkills: string[];
  explanation: string | null;
  supportedRequirements: AiRequirementCheck[];
  unsupportedRequirements: AiRequirementCheck[];
  unclearRequirements: AiRequirementCheck[];
  evidence: AiMatchEvidence[];
}

export interface AiJobMatchResult {
  /** EVERY eligible vacancy, ranked strongest to weakest. Not a page. */
  matches: AiJobMatch[];
  locale: SupportedLocale;
  vacanciesConsidered: number;
  eligibleConsidered: number;
  generated: boolean;
  /** Skills, role families and contributing sources the ranking actually saw. */
  capability: Record<string, unknown>;
  durationMs: number;
}

/** The candidate's CURRENT professional context. Minimized before it leaves. */
export interface AiWhyMatchCandidate {
  headline: string | null;
  summary: string | null;
  locationLabel: string | null;
  skills: string[];
  languages: string[];
  experience: string[];
  education: string[];
  preferences: string[];
  evidenceExcerpts: string[];
}

/** One external job's stored facts. Untrusted third-party content. */
export interface AiWhyMatchJob {
  title: string;
  company: string | null;
  status: string;
  locationLabel: string | null;
  workMode: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salaryLabel: string | null;
  skills: string[];
  languages: string[];
  benefits: string[];
  description: string | null;
  requirementsText: string | null;
}

/** What the deterministic pipeline already decided. Supplied, never derived. */
export interface AiWhyMatchFacts {
  score: number | null;
  band: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  alignmentNotes: string[];
}

export interface AiWhyMatchResult {
  jobId: string;
  locale: SupportedLocale;
  summary: string;
  strengths: { title: string; explanation: string }[];
  gaps: { title: string; explanation: string }[];
  model?: string;
  durationMs?: number;
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

  /**
   * Semantic evidence search over CURRENT candidate evidence, scoped to the
   * authorized applicant accounts the backend resolved. Reads the candidate
   * collection only — the tenant collection is no longer a retrieval surface.
   */
  async searchEvidence(
    query: string,
    filters: EvidenceSearchFilters,
  ): Promise<EvidenceSearchResult> {
    this.assertEnabled('search evidence');

    return this.request<EvidenceSearchResult>('/internal/search', {
      candidateAccountIds: filters.candidateAccountIds,
      query,
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
    /**
     * The authorized retrieval universe. One element for Candidate Detail's
     * Ask; every applicant account of the caller's own vacancies for the
     * org-wide mode. Resolved server-side, never client-supplied.
     */
    candidateAccountIds: string[];
    query: string;
    vacancyId?: string | null;
    /** Selected-vacancy grounding for the generated answer. */
    vacancy?: AiVacancyContext | null;
    locale: SupportedLocale;
    limit?: number;
    /**
     * The source ids the AI service may retrieve for this request — the files
     * and link snapshots that CURRENTLY exist for this candidate.
     *
     * This is authorization, not optimisation. Physical vector cleanup can lag
     * (a Qdrant outage, a retrying job), and without this list a passage from a
     * source the candidate deleted an hour ago could still be retrieved and
     * cited. With it, a stale vector is inert: the filter is derived from the
     * database rows, which the delete already removed.
     *
     * `null`/omitted means "no source restriction" and is only correct where the
     * caller has no candidate to scope by (the org-wide AI Search answer, which
     * is filtered against surviving sources on the way back instead).
     */
    allowedSourceIds?: string[] | null;
  }): Promise<AiRagResult> {
    this.assertEnabled('answer a question');
    return this.request<AiRagResult>('/internal/rag', {
      candidateAccountIds: input.candidateAccountIds,
      query: input.query,
      vacancyId: input.vacancyId ?? null,
      vacancy: input.vacancy ?? null,
      locale: input.locale,
      limit: input.limit ?? 8,
      allowedSourceIds: input.allowedSourceIds ?? null,
    });
  }

  /**
   * Summarises what a candidate's documents state. No quality judgement.
   * With `vacancy` set, the summary is grounded in that vacancy's
   * requirements — "what does the evidence say as it relates to THIS role"
   * — instead of a generic profile summary.
   */
  async summariseCandidate(input: {
    /** The applicant's account — resolved through the authorization chain. */
    candidateAccountId: string;
    locale: SupportedLocale;
    vacancy?: AiVacancyContext | null;
    limit?: number;
    /** See answerQuestion — surviving sources only. */
    allowedSourceIds?: string[] | null;
  }): Promise<AiCandidateSummaryResult> {
    this.assertEnabled('summarise a candidate');
    return this.request<AiCandidateSummaryResult>(
      '/internal/candidates/summary',
      {
        candidateAccountId: input.candidateAccountId,
        locale: input.locale,
        vacancy: input.vacancy ?? null,
        limit: input.limit ?? 12,
        allowedSourceIds: input.allowedSourceIds ?? null,
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
    /** The applicant's account — resolved through the authorization chain. */
    candidateAccountId: string;
    vacancyId: string;
    requirements: AiRequirementInput[];
    locale?: SupportedLocale;
    /** See answerQuestion — surviving sources only. */
    allowedSourceIds?: string[] | null;
  }): Promise<AiEvidenceMapResult> {
    this.assertEnabled('map requirement evidence');
    return this.request<AiEvidenceMapResult>('/internal/evidence-map', {
      candidateAccountId: input.candidateAccountId,
      vacancyId: input.vacancyId,
      requirements: input.requirements,
      locale: input.locale ?? 'en',
      allowedSourceIds: input.allowedSourceIds ?? null,
    });
  }

  /** Interview prompts drawn from present and missing evidence. */
  async interviewQuestions(input: {
    /** The applicant's account — resolved through the authorization chain. */
    candidateAccountId: string;
    vacancyId: string;
    requirements: AiRequirementInput[];
    locale: SupportedLocale;
    /** See answerQuestion — surviving sources only. */
    allowedSourceIds?: string[] | null;
  }): Promise<AiInterviewQuestionsResult> {
    this.assertEnabled('generate interview questions');
    return this.request<AiInterviewQuestionsResult>(
      '/internal/interview-questions',
      {
        candidateAccountId: input.candidateAccountId,
        vacancyId: input.vacancyId,
        requirements: input.requirements,
        locale: input.locale,
        allowedSourceIds: input.allowedSourceIds ?? null,
      },
    );
  }

  /**
   * Prose for ONE external job the caller already decided to show (4C.6).
   *
   * Everything travels as ALREADY-RESOLVED facts: the candidate's current
   * professional context, the job's stored fields and the deterministic match
   * facts. The AI service reads no store for this call and ranks nothing, so
   * there is no path from here back into what exists or in what order.
   *
   * Deliberately carries no account id, no document id, no email and no
   * token — a field that does not exist cannot be logged by a third party.
   */
  async externalWhyMatch(input: {
    jobId: string;
    locale: SupportedLocale;
    candidate: AiWhyMatchCandidate;
    job: AiWhyMatchJob;
    facts: AiWhyMatchFacts;
  }): Promise<AiWhyMatchResult> {
    this.assertEnabled('generate an external match explanation');
    return this.request<AiWhyMatchResult>('/internal/external-jobs/why-match', {
      jobId: input.jobId,
      locale: input.locale,
      candidate: input.candidate,
      job: input.job,
      facts: input.facts,
    });
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

  /**
   * Indexes one PERSONAL professional link into the candidate-scoped
   * collection — the same physically separate collection personal resumes live
   * in, so Job Match retrieves files and links together and no recruiter path
   * can reach either. There is no organizationId anywhere in this call.
   */
  async indexPersonalWebSource(
    input: IndexWebSourceInput & { candidateAccountId: string },
  ): Promise<IndexWebSourceResult> {
    this.assertEnabled('index personal web evidence');
    return this.request<IndexWebSourceResult>(
      '/internal/candidate/web-sources/index',
      {
        candidateAccountId: input.candidateAccountId,
        sourceId: input.sourceId,
        title: input.title,
        url: input.url,
        detectedType: input.detectedType ?? null,
        sections: input.sections,
      },
    );
  }

  /** Removes a personal link's vectors (owner-scoped, idempotent). */
  async deletePersonalWebSource(
    candidateAccountId: string,
    sourceId: string,
  ): Promise<void> {
    this.assertEnabled('delete personal web evidence vectors');
    await this.request('/internal/candidate/documents/delete', {
      candidateAccountId,
      documentId: sourceId,
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
   * Indexes a batch of external jobs for semantic retrieval. Idempotent.
   *
   * Batched because the catalogue arrives in provider sweeps of several
   * hundred, and a round trip per job would cost more than the sweep.
   */
  async indexExternalJobs(jobs: ExternalJobIndexInput[]): Promise<number> {
    this.assertEnabled('index external jobs');
    const result = await this.request<{ indexed: number }>(
      '/internal/external-jobs/index',
      { jobs },
    );
    return result.indexed;
  }

  /** Removes external jobs from the semantic index. Idempotent. */
  async deleteExternalJobIndex(externalJobIds: string[]): Promise<number> {
    this.assertEnabled('delete external job index');
    const result = await this.request<{ deleted: number }>(
      '/internal/external-jobs/delete',
      { externalJobIds },
    );
    return result.deleted;
  }

  /**
   * Nearest external jobs to a query — CANDIDATES, not results.
   *
   * Whatever comes back is revalidated against PostgreSQL before a person
   * sees it. This call proposes; it never decides what exists.
   */
  async searchExternalJobs(input: {
    query: string;
    limit: number;
    statuses?: string[];
  }): Promise<ExternalJobSemanticHit[]> {
    this.assertEnabled('search external jobs');
    const result = await this.request<{ hits: ExternalJobSemanticHit[] }>(
      '/internal/external-jobs/search',
      {
        query: input.query,
        limit: input.limit,
        statuses: input.statuses ?? [],
      },
    );
    return result.hits;
  }

  /**
   * Candidate → vacancy matching over the candidate's OWN data only.
   * Labels are deterministic; one batched generation call writes the prose.
   */
  async candidateJobMatches(input: {
    candidateAccountId: string;
    profile: AiCandidateProfile;
    locale: SupportedLocale;
    /**
     * The vacancies this candidate may see, decided HERE from the database.
     *
     * The AI service ranks every one of them. It used to run a top-K vector
     * search instead and rank whatever came back, which meant the index — not
     * the database — decided which jobs existed, and a cascade-deleted vacancy
     * lingering in the index could occupy a slot a real job should have had.
     */
    eligibleVacancyIds: string[];
    /** Which slice of the finished ranking to spend generation on. */
    explainOffset?: number;
    explainLimit?: number;
    /**
     * The candidate's CURRENT personal source ids (files and links alike).
     *
     * The personal collection is keyed by candidateAccountId, which stops
     * another account's evidence being read but not the account's OWN deleted
     * evidence. This list is what does that, and it does not depend on the
     * eviction having completed.
     */
    allowedSourceIds?: string[] | null;
  }): Promise<AiJobMatchResult> {
    this.assertEnabled('match jobs');
    return this.request<AiJobMatchResult>('/internal/candidate/job-matches', {
      candidateAccountId: input.candidateAccountId,
      profile: input.profile,
      locale: input.locale,
      eligibleVacancyIds: input.eligibleVacancyIds,
      explainOffset: input.explainOffset ?? 0,
      explainLimit: input.explainLimit ?? 20,
      allowedSourceIds: input.allowedSourceIds ?? null,
    });
  }

  /**
   * Prose for ONE PAGE of a ranking the backend already holds.
   *
   * Deliberately separate from `candidateJobMatches`: paging to results 41-60
   * must not re-rank the whole catalogue to write a few sentences. This sends
   * the facts the ranking already produced and gets words back — it cannot
   * change the order or the count, which the application owns.
   */
  async matchExplanations(input: {
    locale: SupportedLocale;
    items: {
      vacancyId: string;
      title: string;
      match: JobMatchLabel;
      matchedSkills: string[];
      missingSkills: string[];
      supportedRequirements: AiRequirementCheck[];
      unsupportedRequirements: AiRequirementCheck[];
      unclearRequirements: AiRequirementCheck[];
    }[];
  }): Promise<{ explanations: Record<string, string>; generated: boolean }> {
    this.assertEnabled('explain job matches');
    return this.request('/internal/candidate/match-explanations', {
      locale: input.locale,
      items: input.items,
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

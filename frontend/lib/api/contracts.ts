/**
 * Wire shapes returned by the NestJS API.
 *
 * These exist only so `adapters.ts` has something precise to map from. Nothing
 * outside `lib/api` should import them — components use the domain types in
 * `lib/types.ts`.
 */
import type {
  AnswerStatus,
  ApplicationSource,
  ApplicationStatus,
  DocumentStatus,
  DocumentType,
  EvidenceMappingStatus,
  EvidenceType,
  InterviewQuestionKind,
  ProcessingJobStatus,
  RequirementType,
  Role,
  VacancyStatus,
} from "@/lib/types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The locale codes the API accepts on an AI request.
 *
 * Identical to the frontend's `Locale` by construction — both lists mirror the
 * backend's SUPPORTED_LOCALES — so a locale the UI can select is always one the
 * API will accept.
 */
export type SupportedLocale = Locale;

export interface AuthTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    organizationId: string;
  };
}

export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationId: string;
  organization: { id: string; name: string; slug: string };
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    users: number;
    vacancies: number;
    candidates: number;
    documents: number;
  };
}

export interface OrganizationStatsResponse {
  users: number;
  vacancies: number;
  openVacancies: number;
  candidates: number;
  applications: number;
  documents: number;
}

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface JobRequirementResponse {
  id: string;
  vacancyId: string;
  text: string;
  type: RequirementType;
  required: boolean;
}

export interface VacancyResponse {
  id: string;
  organizationId: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  description: string | null;
  experienceLevel: string | null;
  status: VacancyStatus;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  requirements?: JobRequirementResponse[];
  _count?: { applications: number; requirements: number };
}

export interface DocumentResponse {
  id: string;
  type: DocumentType;
  originalFileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  status: DocumentStatus;
  pageCount?: number | null;
  candidateId?: string | null;
  processingJobId?: string | null;
  createdAt: string;
}

export interface ApplicationResponse {
  id: string;
  candidateId: string;
  vacancyId: string;
  status: ApplicationStatus;
  /** Not returned by the API today. */
  source?: ApplicationSource;
  createdAt: string;
  updatedAt: string;
  vacancy?: { id: string; title: string; status: VacancyStatus };
  candidate?: { id: string; fullName: string; currentTitle: string | null };
}

export interface CandidateResponse {
  id: string;
  organizationId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  createdAt: string;
  updatedAt: string;
  documents?: DocumentResponse[];
  applications?: ApplicationResponse[];
}

export interface ProcessingJobResponse {
  id: string;
  organizationId: string;
  documentId: string;
  bullmqJobId: string | null;
  type: string;
  status: ProcessingJobStatus;
  progress: number;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  document?: {
    id: string;
    originalFileName: string;
    status: DocumentStatus;
    type: DocumentType;
  } | null;
}

export interface EvidenceResponse {
  id: string;
  candidateId: string;
  documentId: string;
  vacancyId: string | null;
  requirementId: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
  evidenceType: EvidenceType | null;
  createdAt: string;
  document?: { id: string; originalFileName: string };
}

export interface DownloadUrlResponse {
  url: string;
  originalFileName: string;
}

/** Payload of every `processing.*` socket.io event. */
export interface ProcessingProgressEvent {
  jobId: string | null;
  documentId: string;
  status: ProcessingJobStatus;
  documentStatus: DocumentStatus;
  progress: number;
  errorMessage?: string;
}

/* -------------------------------------------------------------------------- */
/* Evidence search — POST /search/evidence                                     */
/* -------------------------------------------------------------------------- */

export interface EvidenceSearchHitResponse {
  candidateId: string | null;
  candidateName: string | null;
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  text: string;
  /**
   * How well the passage matches the query. The backend is explicit that this
   * is not a candidate score, a hiring score, or a probability of success — so
   * it is used for ordering only and never rendered as a candidate rating.
   */
  relevance: { retrievalScore: number; rerankScore: number | null };
}

export interface EvidenceSearchResponse {
  query: string;
  results: EvidenceSearchHitResponse[];
  reranked: boolean;
  totalConsidered: number;
  durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Grounded AI                                                                 */
/*                                                                             */
/* Copied field-for-field from backend/src/ai/ai-service.client.ts and          */
/* backend/src/evidence-map/evidence-map.service.ts. Nothing here is a guess:   */
/* a field the API does not return does not appear.                            */
/* -------------------------------------------------------------------------- */

/** A verified pointer back to the passage supporting a claim. */
export interface AiCitationResponse {
  chunkId: string;
  documentId: string;
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
}

/** POST /api/ai/answer */
export interface AiAnswerResponse {
  answer: string;
  status: AnswerStatus;
  citations: AiCitationResponse[];
  locale: SupportedLocale;
  /** Chunk ids the backend rejected as unverifiable. */
  rejectedCitations: string[];
  evidenceConsidered: number;
  durationMs: number;
  model: string | null;
}

/** POST /api/ai/candidates/:candidateId/summary */
export interface AiCandidateSummaryResponse {
  summary: string;
  status: AnswerStatus;
  citations: AiCitationResponse[];
  locale: SupportedLocale;
  rejectedCitations: string[];
  durationMs: number;
  model: string | null;
}

export interface AiInterviewQuestionResponse {
  question: string;
  reason: string;
  kind: InterviewQuestionKind;
  requirementId: string | null;
  citations: AiCitationResponse[];
}

/** POST /api/ai/candidates/:cid/vacancies/:vid/interview-questions */
export interface AiInterviewQuestionsResponse {
  candidateId: string;
  vacancyId: string;
  questions: AiInterviewQuestionResponse[];
  locale: SupportedLocale;
  durationMs: number;
  model: string | null;
}

/**
 * One stored evidence row on an evidence map.
 *
 * Note this is NOT `AiCitationResponse`: the persisted read returns the
 * CandidateEvidence row id plus `sourceChunkId`, where a generation call
 * returns `chunkId` directly.
 */
export interface EvidenceMapEvidenceResponse {
  id: string;
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  section: string | null;
  text: string;
  sourceChunkId: string | null;
}

export interface EvidenceMapRequirementResponse {
  requirement: {
    id: string;
    text: string;
    type: RequirementType;
    required: boolean;
  };
  /** Null when this requirement has never been mapped. */
  status: EvidenceMappingStatus | null;
  reason: string | null;
  matchedTerms: string[];
  missingTerms: string[];
  mappedAt: string | null;
  evidence: EvidenceMapEvidenceResponse[];
}

/**
 * GET and POST /api/candidates/:cid/vacancies/:vid/evidence-map
 *
 * Both verbs return this same shape — the POST persists and then re-reads — so
 * one adapter serves both.
 */
export interface EvidenceMapResponse {
  candidate: { id: string; fullName: string };
  vacancy: { id: string; title: string };
  requirements: EvidenceMapRequirementResponse[];
}

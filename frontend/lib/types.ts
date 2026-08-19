/**
 * Domain types for HR Copilot AI.
 *
 * Enum values and entity fields mirror the NestJS API exactly — the backend
 * contract is the source of truth. Where the UI needs something the API does
 * not return (a display title, a derived status), it is added as a clearly
 * marked derived field and populated in `lib/api/adapters.ts`, never invented
 * inside a component.
 */

import type { Locale } from "@/lib/i18n/locales";

export type ID = string;
/** ISO-8601 timestamp. */
export type ISODateString = string;

/* -------------------------------------------------------------------------- */
/* Identity — mirrors prisma Role                                              */
/* -------------------------------------------------------------------------- */

export const ROLES = ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: ID;
  organizationId: ID;
  fullName: string;
  email: string;
  role: Role;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
  /** Present on GET /organizations/current. */
  counts?: {
    users: number;
    vacancies: number;
    candidates: number;
    documents: number;
  };
}

/** GET /auth/me */
export interface SessionUser extends User {
  organization: Pick<Organization, "id" | "name" | "slug">;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}

/* -------------------------------------------------------------------------- */
/* Vacancies — mirrors prisma VacancyStatus / RequirementType                  */
/* -------------------------------------------------------------------------- */

export const VACANCY_STATUSES = [
  "DRAFT",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

export const REQUIREMENT_TYPES = [
  "SKILL",
  "EXPERIENCE",
  "EDUCATION",
  "LANGUAGE",
  "OTHER",
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export interface JobRequirement {
  id: ID;
  vacancyId: ID;
  /** The requirement as written, e.g. "Kubernetes". */
  text: string;
  type: RequirementType;
  /** true = must have, false = nice to have. */
  required: boolean;
}

export interface Vacancy {
  id: ID;
  organizationId: ID;
  title: string;
  department: string | null;
  location: string | null;
  /** Free-form on the API, not an enum. */
  employmentType: string | null;
  experienceLevel: string | null;
  description: string | null;
  status: VacancyStatus;
  createdById: ID | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  requirements: JobRequirement[];
  /** Derived from `_count.applications` — candidates attached to this vacancy. */
  candidateCount: number;
  /** Derived from `_count.requirements` when the list endpoint omits them. */
  requirementCount: number;
}

export interface CreateVacancyInput {
  title: string;
  department?: string;
  location?: string;
  employmentType?: string;
  experienceLevel?: string;
  description?: string;
  status?: Extract<VacancyStatus, "DRAFT" | "OPEN">;
}

export interface JobRequirementInput {
  text: string;
  type: RequirementType;
  required: boolean;
}

export interface VacancyQuery {
  search?: string;
  status?: VacancyStatus;
  department?: string;
  location?: string;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/* Documents & processing — mirrors DocumentStatus / ProcessingJobStatus       */
/* -------------------------------------------------------------------------- */

export const DOCUMENT_STATUSES = [
  "UPLOADED",
  "QUEUED",
  "PARSING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "COMPLETED",
  "FAILED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Ordered pipeline stages for the progress readout. QUEUED and FAILED are
 * states rather than stages, so they are reported separately.
 */
export const PIPELINE_STAGES = [
  "UPLOADED",
  "PARSING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "COMPLETED",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const DOCUMENT_TYPES = [
  "RESUME",
  "PORTFOLIO",
  "JOB_DESCRIPTION",
  "HR_DOCUMENT",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface CandidateDocument {
  id: ID;
  candidateId: ID | null;
  type: DocumentType;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number | null;
  status: DocumentStatus;
  /** null until the AI service has parsed the file. */
  pageCount: number | null;
  createdAt: ISODateString;
}

export const PROCESSING_JOB_STATUSES = [
  "PENDING",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;
export type ProcessingJobStatus = (typeof PROCESSING_JOB_STATUSES)[number];

export interface ProcessingJob {
  id: ID;
  organizationId: ID;
  documentId: ID;
  type: string;
  status: ProcessingJobStatus;
  /** 0–100 pipeline progress. Never a candidate-quality measure. */
  progress: number;
  attempts: number;
  errorMessage: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  document: {
    id: ID;
    originalFileName: string;
    status: DocumentStatus;
    type: DocumentType;
  } | null;
  /** Derived: resolved from the document's candidate when available. */
  candidateId: ID | null;
  candidateName: string | null;
}

export interface ProcessingSummary {
  total: number;
  failed: number;
  /** Documents that have reached at least the given stage. */
  reached: Record<PipelineStage, number>;
}

/** A file queued in the browser while it is being sent to the backend. */
export interface UploadItem {
  id: ID;
  fileName: string;
  sizeBytes: number;
  status: DocumentStatus;
  progress: number;
  error: string | null;
  /** Set once the backend has accepted the file. */
  documentId: ID | null;
}

/* -------------------------------------------------------------------------- */
/* Candidates & applications                                                   */
/* -------------------------------------------------------------------------- */

export const APPLICATION_STATUSES = [
  "NEW",
  "REVIEWING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Where an application came from.
 *
 * The API has no `source` column yet, so this is never populated today. It is
 * declared with the platform's agreed names so that when the column lands the
 * frontend does not introduce competing vocabulary.
 */
export const APPLICATION_SOURCES = [
  "DIRECT",
  "EMAIL",
  "LINKEDIN",
  "INDEED",
  "SARAMIN",
  "JOBKOREA",
  "WANTED",
  "JUMPIT",
  "REFERRAL",
  "MANUAL_UPLOAD",
] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export interface Application {
  id: ID;
  candidateId: ID;
  vacancyId: ID;
  status: ApplicationStatus;
  /** Absent until the API models provenance. */
  source?: ApplicationSource;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  vacancy?: Pick<Vacancy, "id" | "title" | "status">;
  candidate?: Pick<Candidate, "id" | "fullName" | "currentTitle">;
}

export interface Candidate {
  id: ID;
  organizationId: ID;
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** Present on the detail endpoint. */
  documents: CandidateDocument[];
  applications: Application[];
  /** Derived from the documents' statuses — the worst-case pipeline state. */
  processingStatus: DocumentStatus | null;
  /** Derived from the first application. */
  primaryVacancyId: ID | null;
  primaryVacancyTitle: string | null;
}

export interface CreateCandidateInput {
  fullName: string;
  email?: string;
  phone?: string;
  location?: string;
  currentTitle?: string;
  totalExperienceYears?: number;
}

export type CandidateSortKey = "recent" | "name" | "experience";

export interface CandidateQuery {
  search?: string;
  location?: string;
  currentTitle?: string;
  minExperienceYears?: number;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export const EVIDENCE_TYPES = [
  "SKILL",
  "EXPERIENCE",
  "EDUCATION",
  "LANGUAGE",
  "CERTIFICATION",
  "OTHER",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * One extracted passage. The API deliberately has no score or confidence
 * field — evidence is a pointer to text a person reads and judges.
 */
export interface Evidence {
  id: ID;
  candidateId: ID;
  documentId: ID;
  vacancyId: ID | null;
  requirementId: ID | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
  evidenceType: EvidenceType | null;
  createdAt: ISODateString;
  document?: Pick<CandidateDocument, "id" | "originalFileName">;
}

/**
 * Presentation state for one requirement.
 *
 * Every value maps 1:1 from a backend signal — none is guessed:
 *   EVIDENCE_FOUND      -> FOUND
 *   NO_EVIDENCE_FOUND   -> NOT_FOUND
 *   NEEDS_HUMAN_REVIEW  -> NEEDS_REVIEW
 *   (no stored mapping) -> NOT_RUN
 *
 * NOT_RUN exists because "we have not looked" and "we looked and found
 * nothing" are different facts, and collapsing them would misreport the second.
 */
export type EvidenceStatus =
  | "FOUND"
  | "NOT_FOUND"
  | "NEEDS_REVIEW"
  | "NOT_RUN";

export interface Citation {
  /** Stable key. The evidence row id when stored, else the chunk id. */
  id: ID;
  /**
   * The AI service's chunk identifier, when the citation came from a
   * generation call. Present so a citation can be traced back to the exact
   * indexed passage that produced it.
   */
  chunkId: ID | null;
  documentId: ID;
  /** Null when the API did not report a filename; the UI supplies wording. */
  documentName: string | null;
  /**
   * Page as reported by the backend. Never computed on the client: a
   * client-derived page number would send a reader to the wrong place while
   * looking authoritative.
   */
  page: number | null;
  section: string | null;
  snippet: string;
}

/** A requirement paired with whatever supports it. */
export interface RequirementEvidence {
  requirementId: ID;
  requirementText: string;
  required: boolean;
  status: EvidenceStatus;
  citations: Citation[];
}

/* -------------------------------------------------------------------------- */
/* Evidence search                                                             */
/* -------------------------------------------------------------------------- */

/** One retrieved passage, with everything needed to open its source. */
export interface EvidencePassage {
  documentId: ID;
  /** Null when the API did not report a filename. */
  documentName: string | null;
  page: number | null;
  section: string | null;
  text: string;
}

/**
 * A candidate and the passages of theirs that matched.
 *
 * There is deliberately no score field: retrieval relevance decides ordering
 * inside the service layer and is dropped before the view model, so no screen
 * can present it as a measure of the candidate.
 */
export interface CandidateEvidenceMatch {
  candidateId: ID;
  /** Null when the candidate row no longer resolves to a name. */
  candidateName: string | null;
  passages: EvidencePassage[];
}

export interface EvidenceSearchResult {
  query: string;
  candidates: CandidateEvidenceMatch[];
  reranked: boolean;
  totalConsidered: number;
  durationMs: number;
}


/* -------------------------------------------------------------------------- */
/* Grounded AI                                                                 */
/*                                                                             */
/* Mirrors backend/src/ai/ai-service.client.ts exactly. Every status below      */
/* describes the ANSWER and its evidence — never the candidate, and never a     */
/* hiring decision.                                                            */
/* -------------------------------------------------------------------------- */

export const ANSWER_STATUSES = [
  "GROUNDED",
  "INSUFFICIENT_EVIDENCE",
  "NEEDS_HUMAN_REVIEW",
] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export const EVIDENCE_MAPPING_STATUSES = [
  "EVIDENCE_FOUND",
  "NO_EVIDENCE_FOUND",
  "NEEDS_HUMAN_REVIEW",
] as const;
export type EvidenceMappingStatus = (typeof EVIDENCE_MAPPING_STATUSES)[number];

export const INTERVIEW_QUESTION_KINDS = [
  "evidence_probe",
  "missing_requirement_probe",
] as const;
export type InterviewQuestionKind = (typeof INTERVIEW_QUESTION_KINDS)[number];

/** POST /ai/answer */
export interface GroundedAnswer {
  answer: string;
  status: AnswerStatus;
  citations: Citation[];
  /** The language the answer was written in, as the backend confirmed it. */
  locale: Locale;
  /** How many passages were retrieved before the answer was written. */
  evidenceConsidered: number;
  durationMs: number;
  model: string | null;
  /**
   * Citations the backend validated away because they did not match retrieved
   * context. Surfaced as a count so a reader knows filtering happened, without
   * showing chunk ids that mean nothing to them.
   */
  rejectedCitationCount: number;
}

/** POST /ai/candidates/:id/summary */
export interface CandidateSummary {
  summary: string;
  status: AnswerStatus;
  citations: Citation[];
  locale: Locale;
  durationMs: number;
  model: string | null;
  rejectedCitationCount: number;
}

export interface InterviewQuestion {
  /** Derived stable key — the API returns no id per question. */
  id: string;
  question: string;
  /** Why a human might ask it. Not a finding and not an assessment. */
  reason: string;
  kind: InterviewQuestionKind;
  requirementId: ID | null;
  citations: Citation[];
}

/** POST /ai/candidates/:cid/vacancies/:vid/interview-questions */
export interface InterviewQuestionSet {
  candidateId: ID;
  vacancyId: ID;
  questions: InterviewQuestion[];
  locale: Locale;
  durationMs: number;
  model: string | null;
}

/** One requirement and whatever the mapping found for it. */
export interface RequirementMapping {
  requirementId: ID;
  requirementText: string;
  requirementType: RequirementType;
  required: boolean;
  status: EvidenceStatus;
  /** The backend's own explanation. Null when the mapping has not run. */
  reason: string | null;
  matchedTerms: string[];
  missingTerms: string[];
  mappedAt: ISODateString | null;
  citations: Citation[];
}

/**
 * GET/POST /candidates/:cid/vacancies/:vid/evidence-map
 *
 * There is deliberately no overall score, percentage or verdict field. The
 * backend does not return one, and deriving one here would invent exactly the
 * summary judgement this product refuses to make.
 */
export interface EvidenceMap {
  candidateId: ID;
  candidateName: string;
  vacancyId: ID;
  vacancyTitle: string;
  requirements: RequirementMapping[];
  /** True once at least one requirement has a stored mapping. */
  hasRun: boolean;
  /** Most recent mapping time across requirements, or null. */
  mappedAt: ISODateString | null;
}

/**
 * Why an AI call did not produce a result.
 *
 * Kept distinct on purpose: retrieval being down, generation being down, a
 * network failure and a role restriction need different words on screen, and
 * collapsing them into "Something went wrong" hides which part of the system
 * is actually unavailable.
 */
export type AiFailureReason =
  | "generation_unavailable"
  | "retrieval_unavailable"
  | "network"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "error";

/* -------------------------------------------------------------------------- */
/* Compare                                                                     */
/* -------------------------------------------------------------------------- */

export interface ComparisonCell {
  candidateId: ID;
  status: EvidenceStatus;
  citation: Citation | null;
}

export interface ComparisonRow {
  requirementId: ID;
  requirementText: string;
  required: boolean;
  cells: ComparisonCell[];
}

export interface ComparisonResult {
  vacancyId: ID;
  vacancyTitle: string;
  candidates: Pick<
    Candidate,
    "id" | "fullName" | "currentTitle" | "totalExperienceYears" | "location"
  >[];
  rows: ComparisonRow[];
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface DashboardStats {
  totalCandidates: number;
  activeVacancies: number;
  resumesProcessing: number;
  completedAnalyses: number;
}

export interface DashboardData {
  generatedAt: ISODateString;
  stats: DashboardStats;
  recentVacancies: Vacancy[];
  recentCandidates: Candidate[];
  processing: ProcessingSummary;
  recentJobs: ProcessingJob[];
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface TeamMember {
  id: ID;
  fullName: string;
  email: string;
  role: Role;
  createdAt?: ISODateString;
}

export interface SettingsData {
  user: SessionUser;
  organization: Organization;
  team: TeamMember[];
}

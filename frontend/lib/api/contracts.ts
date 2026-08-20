/**
 * Wire shapes returned by the NestJS API.
 *
 * These exist only so `adapters.ts` has something precise to map from. Nothing
 * outside `lib/api` should import them — components use the domain types in
 * `lib/types.ts`.
 */
import type {
  AnswerStatus,
  ProfileVisibility,
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

/**
 * An account is exactly ONE of these, fixed at registration. A CANDIDATE owns
 * a candidate profile and can never hold organization memberships; an
 * ORGANIZATION account is the reverse.
 */
export type AccountType = "CANDIDATE" | "ORGANIZATION";

/**
 * POST /auth/login | /auth/register/candidate | /auth/register/organization |
 * /auth/refresh
 *
 * `role` and `organizationId` describe the ACTIVE organization and are always
 * null for CANDIDATE accounts, which cannot hold memberships.
 */
export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    accountType: AccountType;
    preferredLocale: SupportedLocale;
    role: Role | null;
    organizationId: string | null;
  };
}

/** POST /auth/switch-organization — a new access token, same refresh session. */
export interface SwitchOrganizationResponse {
  accessToken: string;
  user: AuthSessionResponse["user"];
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: Role;
  };
}

export interface MembershipResponse {
  organization: { id: string; name: string; slug: string };
  role: Role;
  joinedAt: string;
}

/**
 * GET /auth/me
 *
 * The canonical shape is `user` / `candidateAccount` / `activeOrganization` /
 * `memberships`. The flat `role`, `organizationId` and `organization` fields
 * are the backend's compatibility layer for the pre-migration contract and are
 * deliberately NOT read here: authorization comes from the live membership the
 * backend reports, never from a field that used to live on the user row.
 */
export interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  accountType: AccountType;
  preferredLocale: SupportedLocale;
  role: Role | null;
  organizationId: string | null;
  organization: { id: string; name: string; slug: string } | null;

  user: {
    id: string;
    email: string;
    fullName: string;
    accountType: AccountType;
    preferredLocale: SupportedLocale;
  };
  candidateAccount: { exists: boolean };
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: Role;
  } | null;
  memberships: MembershipResponse[];
}

/** GET /auth/sessions */
export interface AuthSessionRowResponse {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
  deviceName: string | null;
  current: boolean;
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

/* -------------------------------------------------------------------------- */
/* Candidate account — the user's own job-seeker identity                      */
/*                                                                             */
/* Never confused with the recruiter-side `Candidate`: this belongs to the      */
/* user and to no organization. Copied field-for-field from                     */
/* backend/src/candidate-account/candidate-account.service.ts.                  */
/* -------------------------------------------------------------------------- */

export interface CandidateExperienceResponse {
  title: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface CandidateEducationResponse {
  institution: string;
  degree?: string;
  field?: string;
  startYear?: number;
  endYear?: number;
}

export interface CandidateResumeResponse {
  id: string;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: string;
}

export interface CandidateAccountResponse {
  id: string;
  headline: string | null;
  location: string | null;
  phone: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  experience: CandidateExperienceResponse[];
  education: CandidateEducationResponse[];
  profileVisibility: ProfileVisibility;
  /** Null until a personal resume is uploaded. */
  resumeDocument: CandidateResumeResponse | null;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Public job board                                                            */
/* -------------------------------------------------------------------------- */

export interface PublicJobResponse {
  publicSlug: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  createdAt: string;
  organization: { name: string };
}

export interface PublicJobDetailResponse extends PublicJobResponse {
  description: string | null;
  requirements: { text: string; type: RequirementType; required: boolean }[];
}

/** POST /public/jobs/:slug/apply */
export interface DirectApplicationResponse {
  id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  createdAt: string;
  vacancy: {
    publicSlug: string;
    title: string;
    organization: { name: string };
  };
}

/** GET /candidate-account/me/applications */
export interface MyApplicationResponse {
  id: string;
  status: ApplicationStatus;
  source: ApplicationSource;
  createdAt: string;
  updatedAt: string;
  vacancy: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    organization: { name: string };
  };
  submittedDocument: { originalFileName: string } | null;
}

/** GET /candidate-account/me/saved-jobs */
export interface SavedJobResponse {
  savedAt: string;
  job: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    /** Present so a bookmark whose job closed can be flagged. */
    status: VacancyStatus;
    organization: { name: string };
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate job matching                                                      */
/* -------------------------------------------------------------------------- */

export type JobMatchStrengthResponse = "STRONG" | "PARTIAL" | "WEAK";

/** One requirement, classified deterministically by the backend. */
export interface MatchRequirementResponse {
  text: string;
  required: boolean;
  reason: string;
}

/** A passage from the candidate's OWN resume/profile that drove the match. */
export interface MatchEvidenceResponse {
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
}

/**
 * POST /candidate-account/me/job-matches.
 *
 * Vacancies are addressed by public slug only — the backend never returns an
 * internal vacancy id on this candidate-facing route.
 */
export interface JobMatchResponse {
  vacancy: {
    slug: string;
    title: string;
    organizationName: string;
    location: string | null;
    employmentType: string | null;
    status: VacancyStatus;
  };
  match: JobMatchStrengthResponse;
  /** Null when generation was unavailable; the deterministic data remains. */
  explanation: string | null;
  supportedRequirements: MatchRequirementResponse[];
  unsupportedRequirements: MatchRequirementResponse[];
  unclearRequirements: MatchRequirementResponse[];
  evidence: MatchEvidenceResponse[];
  saved: boolean;
  applicationState: ApplicationStatus | null;
}

export interface JobMatchesResponse {
  matches: JobMatchResponse[];
  locale: SupportedLocale;
  /** False when the Gemini explanation step was skipped or failed. */
  generated: boolean;
  generatedAt: string;
}

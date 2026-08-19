/**
 * Domain types for HR Copilot AI.
 *
 * These mirror the shape the backend contract is expected to return, so the
 * mock service layer in `lib/api` can be swapped for real HTTP calls without
 * touching any component.
 */

export type ID = string;
/** ISO-8601 timestamp. */
export type ISODateString = string;

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export type UserRole = "owner" | "admin" | "recruiter" | "viewer";

export interface User {
  id: ID;
  organizationId: ID;
  fullName: string;
  email: string;
  role: UserRole;
  jobTitle: string | null;
  avatarUrl: string | null;
  createdAt: ISODateString;
  lastActiveAt: ISODateString | null;
}

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  industry: string | null;
  companySize: string | null;
  website: string | null;
  timezone: string;
  createdAt: ISODateString;
}

export interface AuthSession {
  user: User;
  organization: Organization;
  /** Placeholder — real tokens are issued by the backend. */
  accessToken: string;
  expiresAt: ISODateString;
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
}

/* -------------------------------------------------------------------------- */
/* Vacancies                                                                   */
/* -------------------------------------------------------------------------- */

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary";

export type ExperienceLevel =
  | "intern"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "principal";

export type VacancyStatus = "draft" | "open" | "on_hold" | "closed";

export type RequirementKind = "must_have" | "nice_to_have";

export type RequirementCategory =
  | "skill"
  | "experience"
  | "education"
  | "certification"
  | "language"
  | "other";

export interface JobRequirement {
  id: ID;
  vacancyId: ID;
  /** Short label used as the evidence row header, e.g. "Kubernetes". */
  label: string;
  /** Optional longer phrasing taken from the job description. */
  detail: string | null;
  kind: RequirementKind;
  category: RequirementCategory;
  position: number;
}

export interface Vacancy {
  id: ID;
  organizationId: ID;
  title: string;
  department: string;
  location: string;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  status: VacancyStatus;
  description: string;
  requirements: JobRequirement[];
  preferredSkills: string[];
  candidateCount: number;
  processing: ProcessingSummary;
  ownerId: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** A requirement as typed into the create-vacancy form (no ids yet). */
export interface JobRequirementDraft {
  label: string;
  detail?: string | null;
  kind: RequirementKind;
  category: RequirementCategory;
}

export interface CreateVacancyInput {
  title: string;
  department: string;
  location: string;
  employmentType: EmploymentType;
  experienceLevel: ExperienceLevel;
  description: string;
  requirements: JobRequirementDraft[];
  preferredSkills: string[];
  status: Extract<VacancyStatus, "draft" | "open">;
}

export interface VacancyQuery {
  search?: string;
  status?: VacancyStatus | "all";
  department?: string | "all";
}

/* -------------------------------------------------------------------------- */
/* Documents & processing                                                      */
/* -------------------------------------------------------------------------- */

export const PROCESSING_STATUSES = [
  "uploaded",
  "queued",
  "parsing",
  "chunking",
  "embedding",
  "indexing",
  "completed",
  "failed",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Ordered pipeline stages used by the progress readout. `queued` and `failed`
 * are states rather than stages, so they are reported separately.
 */
export const PIPELINE_STAGES = [
  "uploaded",
  "parsing",
  "chunking",
  "embedding",
  "indexing",
  "completed",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type DocumentKind = "resume" | "cover_letter" | "portfolio" | "other";

export interface CandidateDocument {
  id: ID;
  candidateId: ID | null;
  vacancyId: ID | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  kind: DocumentKind;
  status: ProcessingStatus;
  uploadedAt: ISODateString;
}

export interface ProcessingJob {
  id: ID;
  documentId: ID;
  documentName: string;
  candidateId: ID | null;
  candidateName: string | null;
  vacancyId: ID | null;
  vacancyTitle: string | null;
  status: ProcessingStatus;
  /** 0–100, describes pipeline progress only — not candidate quality. */
  progress: number;
  error: string | null;
  startedAt: ISODateString;
  updatedAt: ISODateString;
  completedAt: ISODateString | null;
}

export interface ProcessingSummary {
  total: number;
  failed: number;
  /** Documents that have reached at least the given stage. */
  reached: Record<PipelineStage, number>;
}

/** A file queued in the browser before/while it is sent to the backend. */
export interface UploadItem {
  id: ID;
  fileName: string;
  sizeBytes: number;
  status: ProcessingStatus;
  progress: number;
  error: string | null;
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Human review state. The product never lets the AI accept or reject anyone —
 * every transition here is recorded against a person.
 */
export type ReviewState = "not_reviewed" | "needs_human_review" | "reviewed";

export interface ExperienceEntry {
  id: ID;
  company: string;
  title: string;
  location: string | null;
  startDate: ISODateString;
  endDate: ISODateString | null;
  highlights: string[];
}

export interface EducationEntry {
  id: ID;
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear: number | null;
}

export interface Candidate {
  id: ID;
  organizationId: ID;
  fullName: string;
  currentTitle: string;
  email: string;
  phone: string | null;
  location: string;
  yearsOfExperience: number;
  skills: string[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  documents: CandidateDocument[];
  processingStatus: ProcessingStatus;
  reviewState: ReviewState;
  primaryVacancyId: ID | null;
  primaryVacancyTitle: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type CandidateSortKey =
  | "recent"
  | "name"
  | "experience"
  | "evidence_coverage";

export interface CandidateQuery {
  search?: string;
  vacancyId?: ID | "all";
  processingStatus?: ProcessingStatus | "all";
  reviewState?: ReviewState | "all";
  sort?: CandidateSortKey;
}

/** Human-owned pipeline stages. The AI never moves an application. */
export type ApplicationStage =
  | "new"
  | "in_review"
  | "interview"
  | "offer"
  | "closed";

export interface Application {
  id: ID;
  candidateId: ID;
  vacancyId: ID;
  stage: ApplicationStage;
  /** User id of the person who last moved this application. */
  movedByUserId: ID | null;
  note: string | null;
  appliedAt: ISODateString;
  updatedAt: ISODateString;
}

/* -------------------------------------------------------------------------- */
/* Evidence & AI-assisted reading                                              */
/* -------------------------------------------------------------------------- */

export type EvidenceStatus = "found" | "not_found" | "needs_human_review";

export interface Citation {
  id: ID;
  documentId: ID;
  documentName: string;
  page: number;
  /** Verbatim excerpt from the source document. */
  snippet: string;
}

export interface CandidateEvidence {
  id: ID;
  candidateId: ID;
  vacancyId: ID;
  requirementId: ID;
  requirementLabel: string;
  requirementKind: RequirementKind;
  status: EvidenceStatus;
  citations: Citation[];
  /** Reviewer-facing note, e.g. why the extraction is uncertain. */
  note: string | null;
}

export interface CandidateSummary {
  candidateId: ID;
  vacancyId: ID | null;
  headline: string;
  bullets: string[];
  /** Points a reviewer should verify themselves. */
  openQuestions: string[];
  generatedAt: ISODateString;
}

export type InterviewQuestionCategory =
  | "technical"
  | "experience"
  | "system_design"
  | "collaboration";

export interface InterviewQuestion {
  id: ID;
  candidateId: ID;
  category: InterviewQuestionCategory;
  question: string;
  /** Which requirement or resume claim prompted the question. */
  rationale: string;
  relatedRequirementId: ID | null;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface SearchQuery {
  query: string;
  vacancyId?: ID | "all";
  limit?: number;
}

export interface SearchMatch {
  /** The part of the query this passage answers, e.g. "Redis Pub/Sub". */
  term: string;
  citation: Citation;
}

export interface SearchResult {
  candidateId: ID;
  candidateName: string;
  currentTitle: string;
  location: string;
  yearsOfExperience: number;
  relevantSkills: string[];
  matches: SearchMatch[];
  /** Query terms with no supporting passage in this candidate's documents. */
  unmatchedTerms: string[];
}

export interface SearchResponse {
  query: string;
  /** Terms the search layer extracted from the natural-language query. */
  interpretedTerms: string[];
  results: SearchResult[];
  tookMs: number;
}

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
  requirementLabel: string;
  requirementKind: RequirementKind;
  cells: ComparisonCell[];
}

export interface ComparisonResult {
  vacancyId: ID;
  vacancyTitle: string;
  candidates: Pick<
    Candidate,
    "id" | "fullName" | "currentTitle" | "yearsOfExperience" | "location"
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

export interface ActivityEntry {
  id: ID;
  kind: "upload" | "processing" | "vacancy" | "review";
  message: string;
  detail: string | null;
  at: ISODateString;
}

export interface DashboardData {
  stats: DashboardStats;
  recentVacancies: Vacancy[];
  recentCandidates: Candidate[];
  processing: ProcessingSummary;
  activity: ActivityEntry[];
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export interface TeamMember {
  id: ID;
  fullName: string;
  email: string;
  role: UserRole;
  status: "active" | "invited";
  invitedAt: ISODateString;
}

export interface AiPreferences {
  /** Show requirement evidence with citations rather than bare claims. */
  requireCitations: boolean;
  /** Route low-confidence extractions to a human instead of hiding them. */
  flagUncertainForReview: boolean;
  /** Redact contact details in shared views. */
  redactContactDetails: boolean;
  summaryLanguage: "en" | "uz" | "ru";
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  sessionTimeoutMinutes: number;
  lastPasswordChangeAt: ISODateString;
}

export interface SettingsData {
  user: User;
  organization: Organization;
  team: TeamMember[];
  ai: AiPreferences;
  security: SecuritySettings;
}

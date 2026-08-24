import type { Entitlements } from "@/lib/entitlements/plan";

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

export type { Locale };

export type ID = string;
/** ISO-8601 timestamp. */
export type ISODateString = string;

/* -------------------------------------------------------------------------- */
/* Identity — mirrors prisma Role                                              */
/* -------------------------------------------------------------------------- */

export const ROLES = ["OWNER", "HR_ADMIN", "RECRUITER", "INTERVIEWER"] as const;
export type Role = (typeof ROLES)[number];

/**
 * A person's account. Roles live on memberships, never here.
 *
 * There is deliberately no `role` and no `organizationId` on this type: the
 * backend removed both from the user row, and reintroducing them in the
 * frontend would recreate the single-organization assumption the identity
 * migration exists to remove.
 */
export interface User {
  id: ID;
  fullName: string;
  email: string;
  preferredLocale: Locale;
}

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  /** The organization's public web address. Optional — null when unset. */
  websiteUrl?: string | null;
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

/** One organization the user belongs to, with the role held THERE. */
export interface Membership {
  organization: Pick<Organization, "id" | "name" | "slug">;
  role: Role;
  joinedAt: ISODateString;
}

/** The organization the current access token points at. */
export interface ActiveOrganization {
  id: ID;
  name: string;
  slug: string;
  role: Role;
}

/**
 * An account is exactly ONE of these, fixed at registration — a CANDIDATE can
 * never hold memberships, an ORGANIZATION account can never own a candidate
 * profile.
 */
export type AccountType = "CANDIDATE" | "ORGANIZATION";

/**
 * GET /auth/me — who the caller is.
 *
 * `accountType` decides which side of the product this account lives on.
 * `activeOrganization` is always null for CANDIDATE accounts, and null for an
 * ORGANIZATION account when the token's organization claim is stale (the
 * membership was revoked) — show the workspace picker in that case.
 */
export interface SessionUser {
  id: ID;
  fullName: string;
  email: string;
  accountType: AccountType;
  preferredLocale: Locale;
  /**
   * Short-lived signed URL for the profile picture, or null for "no picture".
   * Null is a normal state, not a missing value: the UI renders initials.
   */
  avatarUrl: string | null;
  /** True once the user has created their personal job-seeker profile. */
  hasCandidateAccount: boolean;
  /**
   * What this account's plan unlocks, resolved once here from whatever the
   * backend stated. Screens ask `canUseExternalAiJobs`, never `plan === "MAX"`.
   */
  entitlements: Entitlements;
  activeOrganization: ActiveOrganization | null;
  memberships: Membership[];
}

/**
 * The caller's own editable account, as GET/PATCH /account/me returns it.
 *
 * Deliberately smaller than `SessionUser`: this is the identity a person edits
 * (name, sign-in address, picture), not the workspace context they are looking
 * at. Both account types use the same shape.
 */
export interface AccountProfile {
  id: ID;
  fullName: string;
  email: string;
  accountType: AccountType;
  /** null means "no picture" — the UI falls back to initials. */
  avatarUrl: string | null;
}

/** PATCH /account/me — send only the fields that changed. */
export interface AccountProfileInput {
  fullName?: string;
  email?: string;
}

/** One live browser/device session from GET /auth/sessions. */
export interface AuthSessionRow {
  id: ID;
  createdAt: ISODateString;
  lastUsedAt: ISODateString;
  expiresAt: ISODateString;
  userAgent: string | null;
  deviceName: string | null;
  /** True for the session making the request. */
  current: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
  /**
   * Which sign-in door the form represents. When set, credentials of the
   * OTHER account type are refused by the backend (403
   * AUTH_ACCOUNT_TYPE_MISMATCH) after password verification.
   */
  accountType?: AccountType;
  deviceName?: string;
}

/**
 * Registration is split by account type on the backend.
 *
 * Supplying `organizationName` + `organizationSlug` targets
 * POST /auth/register/organization (organization + OWNER membership);
 * omitting both targets POST /auth/register/candidate (user + candidate
 * profile). One email is exactly one account type — cross-type reuse is a 409.
 */
export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  organizationName?: string;
  organizationSlug?: string;
  preferredLocale?: Locale;
  /** Friendly label for the session list, e.g. "Work laptop". */
  deviceName?: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                              */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_TYPES = [
  "NEW_APPLICATION",
  "NEW_MESSAGE",
  "INTERVIEW_INVITATION",
  "VACANCY_DELETED",
  "APPLICATION_REJECTED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_AUDIENCES = ["HR", "CANDIDATE"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export interface Notification {
  id: ID;
  type: NotificationType;
  audience: NotificationAudience;
  isRead: boolean;
  createdAt: ISODateString;
  vacancyId: ID | null;
  vacancyTitle: string | null;
  candidateId: ID | null;
  candidateName: string | null;
  actorUserId: ID | null;
  actorName: string | null;
  conversationId: ID | null;
  messageId: ID | null;
  interviewId: ID | null;
  applicationId: ID | null;
  messagePreview: string | null;
}

export interface NotificationPage {
  notifications: Notification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NotificationQuery {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationType;
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

/* -------------------------------------------------------------------------- */
/* Structured job vocabulary — mirrors the prisma enums of the same names      */
/*                                                                            */
/* These are the words a JOB is described in. Internal vacancies are the only  */
/* producer today, but the names are chosen so an externally sourced job can   */
/* normalize into exactly these values later without a translation layer.      */
/* -------------------------------------------------------------------------- */

export const PAY_PERIODS = ["HOURLY", "MONTHLY", "YEARLY"] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];

export const WORK_MODES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** UNKNOWN is a real answer: the employer did not say, so we do not either. */
export const VISA_SPONSORSHIP_VALUES = ["YES", "NO", "UNKNOWN"] as const;
export type VisaSponsorship = (typeof VISA_SPONSORSHIP_VALUES)[number];

export const CITIZENSHIP_REQUIREMENTS = ["NONE", "SPECIFIC"] as const;
export type CitizenshipRequirement = (typeof CITIZENSHIP_REQUIREMENTS)[number];

export const SENIORITY_LEVELS = [
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "STAFF",
  "MANAGER",
] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

/** ONE scale: CEFR plus NATIVE. "Business"/"conversational" are deliberately absent. */
export const LANGUAGE_PROFICIENCIES = [
  "A1",
  "A2",
  "B1",
  "B2",
  "C1",
  "C2",
  "NATIVE",
] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

export const EDUCATION_LEVELS = [
  "HIGH_SCHOOL",
  "ASSOCIATE",
  "BACHELOR",
  "MASTER",
  "DOCTORATE",
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const HIRING_URGENCIES = ["LOW", "NORMAL", "HIGH"] as const;
export type HiringUrgency = (typeof HIRING_URGENCIES)[number];

export const JOB_BENEFITS = [
  "HEALTH_INSURANCE",
  "MEAL_ALLOWANCE",
  "HOUSING_SUPPORT",
  "RELOCATION_SUPPORT",
  "EDUCATION_BUDGET",
  "REMOTE_ALLOWANCE",
  "FLEXIBLE_HOURS",
  "STOCK_OPTIONS",
  "BONUS",
  "PAID_LEAVE",
  "OTHER",
] as const;
export type JobBenefit = (typeof JOB_BENEFITS)[number];

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "TEMPORARY",
] as const;
/**
 * Normalized employment type — what candidate PREFERENCES store.
 *
 * `Vacancy.employmentType` is still the original free text ("Full-time"); the
 * backend's `normalizeEmploymentType` is the single bridge between the two, so
 * there is one vocabulary with one translation point rather than two that drift.
 */
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** One language the role needs, at one level. */
export interface VacancyLanguageRequirement {
  /** BCP-47 primary subtag, lowercase — not limited to the four UI locales. */
  languageCode: string;
  level: LanguageProficiency;
  /** true = must have, false = nice to have. */
  required: boolean;
}

/**
 * The structured description of a job, shared by internal vacancies and (in a
 * later phase) normalized external jobs.
 *
 * EVERY field is nullable, and that is load-bearing: null means the employer
 * did not state it. A vacancy written before the structured model existed
 * carries nothing but the legacy free-text `location`, and must render as
 * "not specified" rather than as a value nobody gave.
 */
export interface JobProfile {
  salaryMin: number | null;
  salaryMax: number | null;
  /** ISO-4217 alpha-3. */
  currency: string | null;
  payPeriod: PayPeriod | null;
  salaryNegotiable: boolean;

  /** ISO 3166-1 alpha-2 — a code, so all four locales render one value. */
  country: string | null;
  region: string | null;
  city: string | null;
  workMode: WorkMode | null;
  /** 0–7; only meaningful for ONSITE/HYBRID. */
  officeDaysPerWeek: number | null;
  /** ISO 3166-1 alpha-2; only meaningful for REMOTE. */
  remoteCountriesAllowed: string[];

  /** Tri-state — null means the employer did not say. */
  foreignApplicantsAccepted: boolean | null;
  visaSponsorship: VisaSponsorship;
  /** Tri-state, same reason. */
  existingWorkAuthorizationRequired: boolean | null;
  /** Free-form per-country visa classes: "E-7", "H-1B". */
  eligibleVisaTypes: string[];
  citizenshipRequirement: CitizenshipRequirement;
  eligibleNationalities: string[];

  seniorityLevel: SeniorityLevel | null;
  minExperienceYears: number | null;
  preferredExperienceYears: number | null;

  requiredEducation: EducationLevel | null;
  preferredEducation: EducationLevel | null;
  requiredCertifications: string[];
  preferredCertifications: string[];
  domainExperience: string[];

  benefits: JobBenefit[];
  benefitsOther: string | null;

  applicationDeadline: ISODateString | null;
  expectedStartDate: ISODateString | null;
  openingsCount: number | null;
  hiringUrgency: HiringUrgency | null;
  contractDurationMonths: number | null;
}

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

export interface Vacancy extends JobProfile {
  id: ID;
  organizationId: ID;
  title: string;
  department: string | null;
  /**
   * LEGACY free-text location. Superseded by country/region/city + workMode,
   * still displayed as a fallback for vacancies that predate them.
   */
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
  /** Empty on list payloads, which deliberately omit the relation. */
  languages: VacancyLanguageRequirement[];
  /** Derived from `_count.applications` — candidates attached to this vacancy. */
  candidateCount: number;
  /** Derived from `_count.requirements` when the list endpoint omits them. */
  requirementCount: number;
}

/**
 * What the create/edit form sends.
 *
 * Every structured field is optional, and an ABSENT key means "leave it
 * alone" on a PATCH — never "clear it". `languages` is the one exception with
 * set semantics: present replaces the whole set, `[]` clears it.
 */
export interface CreateVacancyInput extends Partial<Omit<JobProfile, "languages">> {
  title: string;
  department?: string;
  location?: string;
  employmentType?: string;
  experienceLevel?: string;
  description?: string;
  status?: Extract<VacancyStatus, "DRAFT" | "OPEN">;
  languages?: {
    languageCode: string;
    level: LanguageProficiency;
    required?: boolean;
  }[];
}

export type UpdateVacancyInput = Partial<CreateVacancyInput>;

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

/**
 * Which KIND of evidence a passage, citation or source is.
 *
 * The AI layer is source-agnostic after normalization, but the UI is not
 * allowed to be: "Resume.pdf · page 2" and "Portfolio Website · Projects ·
 * portfolio.example.com/projects" are different things to a reader, and
 * collapsing both into "candidate evidence" would hide where a claim came from.
 */
export const EVIDENCE_SOURCE_TYPES = ["FILE", "URL"] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/**
 * One CURRENT document of a candidate, as recruiters see it. Since the
 * snapshot removal there are no application-time copies: this is the
 * candidate's own live file, read behind the owned-vacancy + applicant chain.
 */
export interface CandidateDocument {
  id: ID;
  type: DocumentType;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number | null;
  status: DocumentStatus;
  /** null until the AI service has parsed the file. */
  pageCount: number | null;
  uploadedAt: ISODateString;
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
 * New applications are always `DIRECT` — applying is the only way one can be
 * created. `MANUAL_UPLOAD` mirrors the backend enum, which keeps the value so
 * historical rows from the removed recruiter-created-candidate feature stay
 * truthful about their origin; no UI renders it. The remaining members are
 * reserved for future ingestion channels.
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
  candidate?: Pick<Candidate, "id" | "fullName" | "currentTitle"> & {
    avatarUrl?: string | null;
  };
}

export interface Candidate {
  id: ID;
  organizationId: ID;
  /**
   * Null means this is a manual recruiter-created candidate. A value means the
   * row is linked to a job-seeker CandidateAccount, so HR must not upload files
   * onto it.
   */
  candidateAccountId: ID | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** The LIVE account avatar, signed server-side. Null → initials fallback. */
  avatarUrl: string | null;
  /** How many CURRENT personal documents the person holds right now. */
  documentCount: number;
  /** The current documents' statuses — the inputs of `processingStatus`. */
  documentStatuses: DocumentStatus[];
  applications: Application[];
  /** Derived from the current documents' statuses — worst-case state. */
  processingStatus: DocumentStatus | null;
  /** Derived from the first application. */
  primaryVacancyId: ID | null;
  primaryVacancyTitle: string | null;
}

/**
 * POST /candidates.

/**
 * Recruiter enrichment of an applicant's org-side record. There is no create
 * counterpart: HR cannot create a candidate.
 */
export interface UpdateCandidateInput {
  fullName?: string;
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
/* Interview chat — vacancy-scoped HR ↔ candidate conversations                */
/* -------------------------------------------------------------------------- */

export type InterviewChatParty = "ORGANIZATION" | "CANDIDATE";
export type InterviewChatClosedReason = "VACANCY_CLOSED" | "CANDIDATE_REJECTED";

export interface InterviewMessage {
  id: ID;
  conversationId: ID;
  senderParty: InterviewChatParty;
  senderName: string;
  content: string;
  createdAt: ISODateString;
}

export interface OrganizationInterviewConversation {
  side: "organization";
  id: ID;
  vacancyId: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  vacancy: Pick<Vacancy, "id" | "title" | "status">;
  candidate: Pick<Candidate, "id" | "fullName" | "email">;
}

export interface CandidateInterviewConversation {
  side: "candidate";
  id: ID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  vacancy: {
    publicSlug: string;
    title: string;
    status: VacancyStatus;
    organizationName: string;
  };
}

export type InterviewConversation =
  | OrganizationInterviewConversation
  | CandidateInterviewConversation;

export interface InterviewConversationPage<T extends InterviewConversation> {
  conversations: T[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Inviting always unlocks the conversation: every applicant owns the
 * CandidateAccount they applied with, so there is no accountless case left to
 * describe.
 */
export interface InviteToInterviewResult {
  application: Application;
  conversation: { id: ID; vacancyId: ID; createdAt: ISODateString };
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
  /**
   * FILE unless stated otherwise. Absent on citations produced before URL
   * evidence existed, and on stored evidence rows, which are always files.
   */
  sourceType: EvidenceSourceType;
  /**
   * The exact page a URL citation came from — possibly a subpage of the
   * submitted link. Null for files, where `page` plays that role.
   */
  sourceUrl: string | null;
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
  /** File name, or link title. Null when the API reported neither. */
  documentName: string | null;
  page: number | null;
  section: string | null;
  text: string;
  sourceType: EvidenceSourceType;
  /** The page a URL passage came from. Null for files. */
  sourceUrl: string | null;
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
  /**
   * Candidates with no stored evidence map for this vacancy.
   *
   * Their cells read NOT_RUN rather than "no evidence": nobody has checked, and
   * reporting that as an absence would understate what those candidates show.
   */
  unmappedCandidateIds: ID[];
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
  /** The caller's live sessions, for the security section. */
  sessions: AuthSessionRow[];
}

/* -------------------------------------------------------------------------- */
/* Candidate account — the user's own job-seeker identity                      */
/*                                                                             */
/* Separate from `Candidate`, which is a recruiter-owned record inside one      */
/* organization. A person may have both; they are never merged.                */
/* -------------------------------------------------------------------------- */

export const PROFILE_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

/** Dates are free text on purpose — a resume is not a form. */
export interface CandidateExperience {
  title: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface CandidateEducation {
  institution: string;
  degree?: string;
  field?: string;
  startYear?: number;
  endYear?: number;
}

/**
 * The personal resume.
 *
 * Stored against the candidate account with no organization, in a private
 * namespace, and never indexed for recruiter search. An organization only ever
 * receives a snapshot copy made at apply time.
 */
export interface PersonalResume {
  id: ID;
  originalFileName: string;
  mimeType: string | null;
  fileSize: number | null;
  createdAt: ISODateString;
}

export interface PersonalDocument extends PersonalResume {
  status: DocumentStatus;
}

export interface PersonalDocumentCollection {
  documents: PersonalDocument[];
  limit: number;
  remaining: number;
  primaryDocumentId: ID | null;
}

/* -------------------------------------------------------------------------- */
/* Professional links (the other half of personal evidence)                    */
/* -------------------------------------------------------------------------- */

/**
 * The applicant's CURRENT profile and evidence, as the vacancy-contextual HR
 * Candidate Detail reads it. Live account data — never application-time
 * copies — behind the owned-vacancy + legitimate-applicant chain.
 */
export interface CandidateCurrentEvidence {
  candidate: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string | null;
  };
  documents: CurrentEvidenceDocument[];
  professionalLinks: CurrentEvidenceLink[];
}

export interface CurrentEvidenceDocument {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number | null;
  sourceType: DocumentType;
  status: DocumentStatus;
  pageCount: number | null;
  uploadedAt: string;
  updatedAt: string;
}

export interface CurrentEvidenceLink {
  id: string;
  title: string | null;
  url: string;
  sourceType: string | null;
  status: LinkStatus;
  analysedAt: string | null;
  updatedAt: string;
}

export const LINK_STATUSES = [
  "PENDING",
  "FETCHING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/**
 * Why a link could not be turned into evidence.
 *
 * A stable API contract the UI localizes on — the backend's `failureMessage`
 * is a developer detail and is never rendered.
 */
export const LINK_FAILURE_CODES = [
  "INVALID_URL",
  "UNSUPPORTED_PROTOCOL",
  "PRIVATE_NETWORK_URL",
  "FETCH_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "CONTENT_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "ACCESS_DENIED",
  "NO_MEANINGFUL_CONTENT",
  "RENDER_FAILED",
  "UPSTREAM_ERROR",
  "INDEXING_FAILED",
] as const;
export type LinkFailureCode = (typeof LINK_FAILURE_CODES)[number];

/**
 * One professional link the signed-in job seeker maintains.
 *
 * Personal evidence, exactly like a personal document: it belongs to the
 * account, no organization can read it, and applying is what creates the
 * org-scoped snapshot a recruiter eventually sees.
 */
export interface CandidateLink {
  id: ID;
  url: string;
  /** The candidate's own label, or the page title, or the hostname. */
  title: string;
  /** Display-only classification ("GITHUB", "WEBSITE", ...). Never a score. */
  detectedType: string | null;
  status: LinkStatus;
  /** Set only when status is FAILED. */
  failureCode: LinkFailureCode | null;
  charCount: number | null;
  pagesFetched: number | null;
  lastFetchedAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CandidateLinkCollection {
  links: CandidateLink[];
  limit: number;
  remaining: number;
}

export interface CandidateLinkInput {
  url: string;
  title?: string;
}

export interface CandidateAccount {
  id: ID;
  headline: string | null;
  location: string | null;
  phone: string | null;
  summary: string | null;
  skills: string[];
  languages: string[];
  experience: CandidateExperience[];
  education: CandidateEducation[];
  profileVisibility: ProfileVisibility;
  resume: PersonalResume | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CandidateAccountInput {
  headline?: string;
  location?: string;
  phone?: string;
  summary?: string;
  skills?: string[];
  languages?: string[];
  experience?: CandidateExperience[];
  education?: CandidateEducation[];
  profileVisibility?: ProfileVisibility;
}

/* -------------------------------------------------------------------------- */
/* Candidate job preferences — what the candidate WANTS                        */
/*                                                                            */
/* A different layer from everything around it: the profile says who they are, */
/* their documents and links say what they can demonstrate, and THIS says what */
/* they are looking for. Expressed in the same vocabulary a job is, so the two */
/* are comparable — and so a future external job normalizes into the same      */
/* value space without a translation layer.                                   */
/* -------------------------------------------------------------------------- */

/**
 * One place the candidate wants — or refuses.
 *
 * The country is canonical (ISO 3166-1 alpha-2) and localized only for
 * display; region and city are the candidate's own words kept in their
 * country's context, so "Cambridge" is never ambiguous. Not geocoded, and the
 * UI does not pretend otherwise.
 */
export interface JobIntentLocation {
  countryCode: string;
  region: string | null;
  city: string | null;
}

export interface JobIntentCompensation {
  minAmount: number;
  /** Null when only a floor was stated. Never a ceiling. */
  maxAmount: number | null;
  currency: string;
  payPeriod: PayPeriod;
}

/**
 * The candidate's stated preferences, exactly as they stated them.
 *
 * EMPTY AND NULL ARE ANSWERS. `preferredWorkModes: []` means "stated no
 * work-mode preference", never "rejects every work mode"; `desiredSalaryMin:
 * null` means "named no threshold", never zero; `willingToRelocate: null`
 * means "did not say", never false. Every screen must preserve that.
 */
export interface CandidateJobPreferences {
  /** Whether a preference profile exists at all — distinct from a blank one. */
  stated: boolean;
  preferredJobTitles: string[];
  preferredLocations: JobIntentLocation[];
  preferredWorkModes: WorkMode[];
  preferredEmploymentTypes: EmploymentType[];
  preferredSeniorityLevels: SeniorityLevel[];
  desiredSalaryMin: number | null;
  /** Top of the range they had in mind. A target, never a ceiling. */
  desiredSalaryMax: number | null;
  salaryCurrency: string | null;
  payPeriod: PayPeriod | null;
  willingToRelocate: boolean | null;
  preferredIndustries: string[];
  preferredBenefits: JobBenefit[];
  excludedCompanies: string[];
  excludedJobTitles: string[];
  excludedLocations: JobIntentLocation[];
  createdAt: ISODateString | null;
  updatedAt: ISODateString | null;
}

/**
 * PUT body — the COMPLETE current state.
 *
 * Anything absent is not stated: an absent list is empty, an absent scalar is
 * null. There is deliberately no "leave this one alone", so a saved profile is
 * always exactly what the candidate last confirmed.
 */
export interface JobPreferencesInput {
  preferredJobTitles?: string[];
  preferredLocations?: JobIntentLocation[];
  preferredWorkModes?: WorkMode[];
  preferredEmploymentTypes?: EmploymentType[];
  preferredSeniorityLevels?: SeniorityLevel[];
  desiredSalaryMin?: number | null;
  desiredSalaryMax?: number | null;
  salaryCurrency?: string | null;
  payPeriod?: PayPeriod | null;
  willingToRelocate?: boolean | null;
  preferredIndustries?: string[];
  preferredBenefits?: JobBenefit[];
  excludedCompanies?: string[];
  excludedJobTitles?: string[];
  excludedLocations?: JobIntentLocation[];
}

/**
 * The canonical intent every candidate→jobs surface reads.
 *
 * Deliberately the same shape the backend resolver produces: one candidate has
 * ONE interpretation of what they want, whether it is being matched against an
 * internal vacancy or (later) a Greenhouse, Lever, Ashby or Ninehire job.
 */
export interface CandidateJobIntent {
  candidateAccountId: ID;
  stated: boolean;
  roles: string[];
  locations: JobIntentLocation[];
  /** De-duplicated country codes from `locations`; derived, never stored. */
  countries: string[];
  workModes: WorkMode[];
  compensation: JobIntentCompensation | null;
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];
  relocation: boolean | null;
  preferredIndustries: string[];
  preferredBenefits: JobBenefit[];
  exclusions: {
    companies: string[];
    jobTitles: string[];
    locations: JobIntentLocation[];
  };
  updatedAt: ISODateString | null;
}

/**
 * Where one search dimension's value came from.
 *
 * UNSPECIFIED means NO RESTRICTION — never "reject everything".
 */
export type JobIntentSource = "REQUEST" | "PREFERENCE" | "UNSPECIFIED";

export interface ResolvedDimension<T> {
  value: T;
  source: JobIntentSource;
}

/** One search's effective intent, dimension by dimension. */
export interface JobSearchContext {
  candidateAccountId: ID;
  jobIntent: CandidateJobIntent;
  resolved: {
    query: ResolvedDimension<string | null>;
    roles: ResolvedDimension<string[]>;
    countries: ResolvedDimension<string[]>;
    workModes: ResolvedDimension<WorkMode[]>;
    employmentTypes: ResolvedDimension<EmploymentType[]>;
    seniorityLevels: ResolvedDimension<SeniorityLevel[]>;
    compensation: ResolvedDimension<JobIntentCompensation | null>;
    exclusions: CandidateJobIntent["exclusions"];
  };
  locale: string;
}


/* -------------------------------------------------------------------------- */
/* Public job board                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A job as a job seeker sees it.
 *
 * Addressed by `publicSlug` only — no internal vacancy id is exposed — and
 * carrying advertisement-safe fields alone: no applicant counts, no creator,
 * no processing or evidence data.
 */
/**
 * A job CARD. Carries the structured facts a seeker actually filters on —
 * pay, where, how remote, how senior — and none of the long tail.
 */
export interface PublicJob {
  publicSlug: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  createdAt: ISODateString;
  organizationName: string;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;
  salaryNegotiable: boolean;
  country: string | null;
  region: string | null;
  city: string | null;
  workMode: WorkMode | null;
  seniorityLevel: SeniorityLevel | null;
  /** People who applied — the same number the recruiter sees. Never who. */
  applicantCount: number;
  /** Why this result is placed here, when the search asked for anything soft. */
  searchAlignment?: { score: number | null; alignments: IntentAlignment[] };
}

/**
 * The full advertised job.
 *
 * Work-authorization facts are advertisement content, not internal data: for a
 * candidate who needs a visa they are the most decision-changing thing on the
 * page, so they are shown rather than withheld.
 */
export interface PublicJobDetail extends PublicJob, Omit<JobProfile, keyof PublicJob> {
  description: string | null;
  requirements: {
    text: string;
    type: RequirementType;
    required: boolean;
  }[];
  languages: VacancyLanguageRequirement[];
}

export interface PublicJobPage {
  jobs: PublicJob[];
  total: number;
  page: number;
  totalPages: number;
}

/** One of the caller's own direct applications. */
export interface MyApplication {
  id: ID;
  status: ApplicationStatus;
  source: ApplicationSource;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  job: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    organizationName: string;
    /** People who applied — the same number every other surface shows. */
    applicantCount: number;
  };
}

export interface MyApplicationPage {
  applications: MyApplication[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SavedJob {
  savedAt: ISODateString;
  job: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    /** A bookmark whose job is no longer OPEN is shown but not actionable. */
    status: VacancyStatus;
    organizationName: string;
  };
}

export interface SavedJobPage {
  saved: SavedJob[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Why a candidate-platform action did not succeed.
 *
 * Distinct reasons because each needs different words and a different next
 * step: creating a profile, uploading a resume, and having already applied are
 * three different situations, not one generic failure.
 */
export type CandidateActionReason =
  | "no_candidate_account"
  | "no_resume"
  | "already_applied"
  | "job_unavailable"
  | "cannot_withdraw"
  | "unauthorized"
  | "network"
  | "error";

/* -------------------------------------------------------------------------- */
/* Candidate AI job matching                                                   */
/*                                                                             */
/* The STRONG/PARTIAL/WEAK label is the backend's deterministic classification  */
/* of evidence coverage. It is never a score, a percentage or a hiring          */
/* recommendation, and the frontend must not derive one from it.               */
/* -------------------------------------------------------------------------- */

export const JOB_MATCH_STRENGTHS = ["STRONG", "PARTIAL", "WEAK"] as const;
export type JobMatchStrength = (typeof JOB_MATCH_STRENGTHS)[number];

export interface MatchRequirement {
  text: string;
  required: boolean;
  /** The backend's stated basis for the classification. */
  reason: string;
}

/**
 * A passage from the candidate's OWN evidence behind a match.
 *
 * Any of their sources: a file, a profile field, or a professional link. A
 * skill shown only on a portfolio counts exactly as much as one on a CV, and
 * the job seeker is told which it was.
 */
export interface MatchEvidence {
  fileName: string | null;
  pageNumber: number | null;
  section: string | null;
  text: string;
  sourceType: EvidenceSourceType;
  sourceUrl: string | null;
}

/**
 * The label beside a score. Presentation ONLY — a LOW match is rendered like
 * any other and is never hidden or filtered out.
 */
export const MATCH_BANDS = ["STRONG", "GOOD", "PARTIAL", "LOW"] as const;
export type MatchBand = (typeof MATCH_BANDS)[number];

export type AlignmentState =
  | "MATCH"
  | "PARTIAL"
  | "MISMATCH"
  | "UNKNOWN"
  | "NOT_COMPARABLE";

/** Salary figures behind an alignment: what was offered, and in what money. */
export interface AlignmentSalary {
  originalMin: number | null;
  originalMax: number | null;
  originalCurrency: string | null;
  originalPayPeriod: PayPeriod | null;
  convertedMin: number | null;
  convertedMax: number | null;
  convertedCurrency: string | null;
  convertedPayPeriod: PayPeriod | null;
}

/**
 * One preference dimension's verdict, computed deterministically by the
 * backend. The UI localizes `reason`; it never re-derives it, and never
 * calculates money.
 */
export interface IntentAlignment {
  dimension: string;
  state: AlignmentState;
  reason: string;
  score: number | null;
  salary?: AlignmentSalary;
}

/** Which exchange rates a ranking's salary figures came from. */
export interface FxStamp {
  snapshotVersion: string | null;
  fetchedAt: string | null;
}

export interface JobSalaryView {
  original: {
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    payPeriod: PayPeriod | null;
    salaryNegotiable: boolean;
  };
  converted: {
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string;
    payPeriod: PayPeriod;
  } | null;
  reason:
    | "CONVERTED"
    | "SAME_CURRENCY"
    | "NO_PREFERENCE"
    | "SALARY_UNKNOWN"
    | "NOT_COMPARABLE";
  fx: {
    snapshotVersion: string | null;
    fetchedAt: string | null;
    freshness: "FRESH" | "STALE_USABLE" | "UNAVAILABLE";
  } | null;
}

export interface JobMatch {
  vacancy: {
    /** Public slug — the only identifier this surface ever sees. */
    slug: string;
    title: string;
    organizationName: string;
    location: string | null;
    employmentType: string | null;
    status: VacancyStatus;
    /** ORIGINAL pay as the employer stated it — never a converted figure. */
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    payPeriod: PayPeriod | null;
    salaryNegotiable: boolean;
    country: string | null;
    region: string | null;
    city: string | null;
    workMode: WorkMode | null;
    seniorityLevel: SeniorityLevel | null;
  };
  match: JobMatchStrength;
  band: MatchBand;
  /** 1-based position in the full ranked list. */
  rank: number;
  /**
   * 0-100, and its only job is to ORDER the list. Not a probability of being
   * hired and not a percentage of the role the person can do — the UI must
   * never label it as either.
   */
  score: number;
  /** The evidence half of the score. Equals `score` when no intent applied. */
  capabilityScore: number;
  /**
   * The preference half, or null when the candidate stated nothing this job
   * could be compared on. Null and 0 mean opposite things: null is "no
   * signal", 0 is "contradicts everything they asked for".
   */
  intentScore: number | null;
  /** Per-dimension verdicts with machine-readable reason codes. */
  alignments: IntentAlignment[];
  /** Per-signal breakdown, for showing WHY a job ranked where it did. */
  signals: Record<string, number>;
  /** Technologies the posting names that the candidate has evidence for. */
  matchedSkills: string[];
  /** Technologies the posting names that the evidence does not show. */
  missingSkills: string[];
  /** Null when generation was unavailable; deterministic data still stands. */
  explanation: string | null;
  supportedRequirements: MatchRequirement[];
  unsupportedRequirements: MatchRequirement[];
  unclearRequirements: MatchRequirement[];
  evidence: MatchEvidence[];
  saved: boolean;
  applicationState: ApplicationStatus | null;
}

export interface JobMatchResult {
  matches: JobMatch[];
  locale: Locale;
  /** False when the grounded explanation step did not run. */
  generated: boolean;
  generatedAt: ISODateString;
  /**
   * The evidence revision this analysis describes. Compared against the
   * account's CURRENT revision to decide whether what is on screen still
   * reflects the candidate's evidence, or is a picture of a deleted file.
   */
  evidenceRevision: number;
  /** Evidence changed while this was being generated. */
  stale: boolean;
  /** Prose for this page is still being written; not the same as failed. */
  explanationsPending: boolean;
  /** 1-based page of the ranked list carried by this result. */
  page: number;
  limit: number;
  /**
   * The FULL ranked count.
   *
   * Deliberately not the length of `matches`: the list is paginated, and a
   * client needs the real total to know how far it can scroll. This is the
   * number that used to be a top-5.
   */
  total: number;
  totalPages: number;
  hasMore: boolean;
  /** How many vacancies the candidate was eligible for in the first place. */
  totalEligible: number;
  /** How many jobs the candidate's own explicit exclusions removed. */
  totalExcluded: number;
  /** The rates behind every converted figure in this ranking. */
  fx: FxStamp;
  /** What the ranking knew about the candidate; for the evidence summary. */
  capability: CandidateCapabilitySummary;
}

/** The grounded picture of a candidate that ranking was built from. */
export interface CandidateCapabilitySummary {
  skills?: string[];
  roleFamilies?: string[];
  /** Source title -> how many blocks of text it contributed. */
  evidenceSources?: Record<string, number>;
  evidenceChars?: number;
  probes?: number;
}

/**
 * How much evidence the signed-in candidate currently has.
 *
 * Files and links count independently and equally: matching needs evidence of
 * SOME kind, and a portfolio is as real as a CV. (Applying is a separate rule
 * that still requires a resume — the two are deliberately not the same gate.)
 */
export interface CandidateEvidenceState {
  hasAccount: boolean;
  files: number;
  links: number;
  total: number;
  evidenceRevision: number;
  canRunJobMatch: boolean;
}

/* -------------------------------------------------------------------------- */
/* Vacancy-scoped HR workspace                                                 */
/*                                                                             */
/* HR users work inside vacancies they personally created. The backend         */
/* re-validates the selected vacancy on every request, so the selection here   */
/* is UX only: a stale one degrades to a localized 403/404, never to another   */
/* user's data.                                                                */
/* -------------------------------------------------------------------------- */

/** A row from GET /vacancies/mine — the creator-scoped selector source. */
export interface MyVacancy {
  id: ID;
  title: string;
  status: VacancyStatus;
  createdAt: ISODateString;
  candidateCount: number;
  requirementCount: number;
}

/**
 * An APPLICANT of one selected vacancy — somebody who applied to it
 * themselves. That is the only way anybody appears here, so there is no
 * source or account flag to branch on.
 */
export interface VacancyCandidate {
  candidate: {
    id: ID;
    fullName: string;
    email: string | null;
    phone: string | null;
    location: string | null;
    currentTitle: string | null;
    totalExperienceYears: number | null;
    documentCount: number;
    evidenceCount: number;
  };
  application: {
    id: ID;
    /** The stage in THIS vacancy — never a candidate-global property. */
    status: ApplicationStatus;
    createdAt: ISODateString;
  };
}

/**
 * Why a vacancy-scoped operation was refused.
 *
 * Mapped from the backend's machine-readable `code` (and the 404 that means
 * "foreign or unknown"), never from its English message.
 */
export type VacancyAccessReason =
  | "not_owned"
  | "candidate_not_in_vacancy"
  | "candidate_already_in_vacancy"
  | "vacancy_not_found";

/* -------------------------------------------------------------------------- */
/* External jobs (Task 4C.2)                                                   */
/*                                                                            */
/* Roles published outside HR Copilot, discovered by the backend's provider    */
/* integrations. They are NOT vacancies: nobody applies through this product,  */
/* no Application row exists for one, and the apply link leaves for the        */
/* employer's own site. The types below deliberately carry no provider         */
/* internals — a job seeker is shown WHERE a role was published, never how it  */
/* was ingested.                                                              */
/* -------------------------------------------------------------------------- */

/** One place a job is open in. Every part may be absent — nothing is inferred. */
export interface ExternalJobPlace {
  countryCode: string | null;
  region: string | null;
  city: string | null;
}

/**
 * Where a listing came from and where applying goes.
 *
 * `sourceCount` is shown as corroboration and is NEVER a ranking input: two
 * observations make a job better evidenced, not a better job. The backend does
 * not let it reach the scorer, and neither does this type.
 */
export interface ExternalJobProvenance {
  /** Provider code, e.g. GREENHOUSE. Localized for display; never a filter. */
  primarySource: string | null;
  applyVia: string | null;
  sourceCount: number;
}

/**
 * One deterministic reason a job ranked where it did.
 *
 * The backend emits CODES, never prose, and the UI localizes them. An unknown
 * code is dropped rather than rendered raw — a future backend reason must not
 * be able to print `SALARY_FOO_BAR` on a candidate's screen.
 */
export interface ExternalJobReason {
  code: string;
  dimension: string;
  state: string;
}

/** Money exactly as the employer stated it. Never converted by this app. */
export interface ExternalJobSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  payPeriod: PayPeriod | null;
}

/**
 * How a result list is ordered.
 *
 * RELEVANCE is the default. NEWEST orders by the EMPLOYER's publication date —
 * never by when this product first saw a posting, which is a fact about our
 * crawler and not about the job.
 */
export const EXTERNAL_JOB_SORTS = ["RELEVANCE", "NEWEST"] as const;
export type ExternalJobSort = (typeof EXTERNAL_JOB_SORTS)[number];

/** One ranked external job, as the search returns it. */
export interface ExternalJobResult {
  externalJobId: ID;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  /** ACTIVE or STALE. Closed/expired jobs never reach a candidate. */
  status: string;
  location: ExternalJobPlace;
  /** Other offices this ONE posting is open in. Eligible, not duplicates. */
  additionalLocations: ExternalJobPlace[];
  workMode: WorkMode | null;
  /**
   * Countries a REMOTE role may be worked from, when the employer said so.
   * Empty means the employer did not say — which is unknown, never worldwide.
   */
  remoteCountriesAllowed: string[];
  employmentType: EmploymentType | null;
  seniorityLevel: SeniorityLevel | null;
  salary: ExternalJobSalary;
  /**
   * When the EMPLOYER's source says this listing was published, or null.
   *
   * Roughly half the catalogue is null, because one provider publishes no
   * publication date at all. Null renders as nothing — never as a guess, and
   * never filled in from when this product first saw the posting.
   */
  employerPostedAt: ISODateString | null;
  /** 0–100 search relevance. Not a probability of being hired. */
  score: number;
  /**
   * The backend's own band label. Null when it sent one this build does not
   * know — the chip is then omitted rather than the threshold re-derived here,
   * because there must be exactly one place that decides what STRONG means.
   */
  band: MatchBand | null;
  textScore: number | null;
  intentScore: number | null;
  reasons: ExternalJobReason[];
  applyUrl: string | null;
  /**
   * Per-candidate state: whether THIS reader saved it, and their own tracking
   * record if they made one. Both are the backend's answer, never inferred
   * here — and the two are independent of each other in both directions.
   */
  saved: boolean;
  tracking: ExternalJobTracking | null;
  provenance: ExternalJobProvenance;
}

/** Which dimensions came from this request and which from a saved preference. */
export interface ExternalJobAppliedIntent {
  query: string | null;
  countries: { value: string[]; source: JobIntentSource };
  workModes: { value: string[]; source: JobIntentSource };
  employmentTypes: { value: string[]; source: JobIntentSource };
  seniorityLevels: { value: string[]; source: JobIntentSource };
  compensation: { stated: boolean; source: JobIntentSource };
}

export interface ExternalJobSearchPage {
  runId: ID;
  algorithmVersion: string;
  /** The order the backend applied. Read from the response, never guessed. */
  sort: ExternalJobSort;
  /**
   * When the backend produced this page.
   *
   * Relative posting ages are measured against this rather than against a
   * clock read during render — which keeps the server pass and the browser
   * hydration in agreement, and ties the wording to the moment the data was
   * actually computed.
   */
  asOf: ISODateString;
  applied: ExternalJobAppliedIntent;
  /**
   * How many results this snapshot holds — exactly what pagination covers.
   * NOT the number of jobs matching the filters; that is `matched`. Paging
   * off the larger number would offer pages that do not exist.
   */
  total: number;
  /** How many jobs answer the hard filters, counted in the database. */
  matched: number;
  ranked: number;
  /** True when deeper matches exist that this run did not rank. */
  truncated: boolean;
  page: number;
  pageSize: number;
  /** True when semantic retrieval was unavailable and this ran text-only. */
  degraded: boolean;
  results: ExternalJobResult[];
}

/** One external job in full, for a reader who opened it. No score, no rank. */
export interface ExternalJobDetail {
  externalJobId: ID;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  status: string;
  /** Plain text, sanitized at ingestion. Rendered as text, never as markup. */
  description: string | null;
  requirementsText: string | null;
  location: ExternalJobPlace;
  additionalLocations: ExternalJobPlace[];
  workMode: WorkMode | null;
  remoteCountriesAllowed: string[];
  employmentType: EmploymentType | null;
  seniorityLevel: SeniorityLevel | null;
  salary: ExternalJobSalary;
  employerPostedAt: ISODateString | null;
  skills: string[];
  industries: string[];
  benefits: string[];
  languageCodes: string[];
  applyUrl: string | null;
  /**
   * Per-candidate state: whether THIS reader saved it, and their own tracking
   * record if they made one. Both are the backend's answer, never inferred
   * here — and the two are independent of each other in both directions.
   */
  saved: boolean;
  tracking: ExternalJobTracking | null;
  provenance: ExternalJobProvenance;
}

/* -------------------------------------------------------------------------- */
/* External jobs — saving and self-tracked applications                        */
/* -------------------------------------------------------------------------- */

/**
 * A listing's own lifecycle, as the catalogue last observed it.
 *
 * Search only ever returns ACTIVE and STALE — a closed job is not a search
 * result. The other three exist because a SAVED job outlives the search that
 * found it: a candidate can hold on to a posting for weeks, and the honest
 * answer when they come back is "this closed", not a silently missing row.
 *
 * CLOSED, EXPIRED and UNAVAILABLE are three different facts and are not
 * collapsed: an employer ending a role, a stated deadline passing, and every
 * source becoming unreadable are things a reader may act on differently.
 */
export const EXTERNAL_JOB_LIFECYCLES = [
  "ACTIVE",
  "STALE",
  "CLOSED",
  "EXPIRED",
  "UNAVAILABLE",
] as const;
export type ExternalJobLifecycle = (typeof EXTERNAL_JOB_LIFECYCLES)[number];

/**
 * How far along the candidate says they are — THEIR record, not ours.
 *
 * Nothing in this product observes an external hiring process. These values
 * are typed in by the person, mean whatever they meant when they typed them,
 * and are never inferred from behaviour: opening an employer's site is not
 * applying, and this product must never claim it saw an interview happen.
 *
 * Deliberately flat. Real external processes skip stages, restart, and end in
 * ways no linear machine models, so any status may follow any other.
 */
export const EXTERNAL_APPLICATION_STATUSES = [
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type ExternalApplicationStatus =
  (typeof EXTERNAL_APPLICATION_STATUSES)[number];

/**
 * The candidate's own tracking record against one external job.
 *
 * Independent of saving in both directions: a job may be tracked and not
 * saved, saved and not tracked, or both. Nothing here creates an internal
 * `Application` — this never enters an organization's pipeline, and no
 * recruiter can see it.
 */
/**
 * One point a generated explanation makes — a strength or a gap.
 *
 * Both halves are PLAIN TEXT and are rendered as text. Model output is never
 * markup here: a title that happens to contain `<b>` is a title containing
 * those characters, not an instruction to this product.
 */
export interface AiInsight {
  /** Short label, e.g. "Six years of backend Python". */
  title: string;
  /** One or two sentences. May be empty when the model gave only a title. */
  explanation: string;
}

/**
 * Gemini's account of why a job was ranked where it was.
 *
 * ## It explains a score; it never computes one
 *
 * The number on the card comes from the deterministic ranker and is the only
 * score this product has. Nothing here replaces it, adjusts it, or adds a
 * second one — an explanation that disagreed with the ordering it explains
 * would be worse than no explanation, and a model-authored percentage beside a
 * computed one is exactly how that happens.
 *
 * ## Generated on request, for one job
 *
 * There is no field for "all jobs" because the explanation is never asked for
 * in bulk. See the service function, which is called from one place.
 */
export interface ExternalWhyMatch {
  externalJobId: ID;
  /** The prompt/format contract that produced this, e.g. `external-why-match-v1`. */
  version: string | null;
  /** The locale the text is written in, when the backend states it. */
  locale: string | null;
  summary: string | null;
  strengths: AiInsight[];
  /** May legitimately be empty: a strong match with nothing to flag. */
  gaps: AiInsight[];
  /** ISO instant, or null. Not displayed by default. */
  generatedAt: ISODateString | null;
}

/**
 * A cover letter written for one job.
 *
 * Held in memory for as long as the reader is looking at it and never sent
 * back: this task stores no drafts, so nothing here is a record of anything.
 * The reader copies it and it is theirs.
 */
export interface ExternalCoverLetter {
  externalJobId: ID;
  version: string | null;
  locale: string | null;
  subject: string | null;
  /** Plain text. Paragraphs are blank-line separated, rendered as text nodes. */
  content: string | null;
  generatedAt: ISODateString | null;
}

/** One question a reader might be asked, and what to do about it. */
export interface AiInterviewQuestion {
  question: string;
  /** Why an interviewer would ask it. May be empty. */
  whyAsked: string;
  /** How to prepare. May be empty. */
  preparation: string;
}

/**
 * Interview preparation for one job.
 *
 * Questions somebody MIGHT be asked and how to think about them — never a
 * predicted score, never a model-authored claim about the reader's own
 * experience. Everything displayed comes from the backend; nothing is inferred
 * on this side.
 */
export interface ExternalInterviewPrep {
  externalJobId: ID;
  version: string | null;
  locale: string | null;
  questions: AiInterviewQuestion[];
  /** May legitimately be empty — the section then does not render. */
  focusAreas: AiInsight[];
  generatedAt: ISODateString | null;
}

/**
 * How one dimension of a match stands.
 *
 * `UNKNOWN` is NOT a weak `GAP`. A gap says the product looked and the thing
 * is missing; UNKNOWN says nobody stated it — an employer who did not publish
 * a salary has not published a bad salary. Collapsing the two would let this
 * product invent a deficiency out of an employer's silence, which is the
 * single most damaging thing a "match breakdown" could do to a job seeker.
 */
export const MATCH_BREAKDOWN_STATUSES = [
  "STRONG",
  "PARTIAL",
  "GAP",
  "UNKNOWN",
] as const;
export type MatchBreakdownStatus = (typeof MATCH_BREAKDOWN_STATUSES)[number];

/** One row of the breakdown — skills, location, pay, and so on. */
export interface MatchBreakdownDimension {
  /** Machine key, kept for React keys and tests. Never rendered. */
  key: string;
  /** The backend's display text. A dimension without one is not rendered. */
  label: string;
  status: MatchBreakdownStatus;
  /** May be empty when the model gave only a status. */
  explanation: string;
  /** Both may legitimately be empty — an UNKNOWN dimension has neither. */
  matched: string[];
  missing: string[];
}

/**
 * A dimension-by-dimension account of an already-computed ranking.
 *
 * Like every premium tool here it EXPLAINS the deterministic score and never
 * produces one. There is deliberately no numeric field anywhere in this type:
 * no percentage, no weight, no per-dimension rating a reader could mistake for
 * the ranker's own number or, worse, average themselves.
 */
export interface ExternalMatchBreakdown {
  externalJobId: ID;
  version: string | null;
  locale: string | null;
  summary: string | null;
  dimensions: MatchBreakdownDimension[];
  generatedAt: ISODateString | null;
}

export interface ExternalJobTracking {
  id: ID;
  status: ExternalApplicationStatus;
  /** When the candidate says they applied. */
  appliedAt: ISODateString;
  /** The candidate's own reminder. Null when they wrote none. */
  note: string | null;
  updatedAt: ISODateString;
}

/**
 * The per-candidate state layered over a job.
 *
 * Carried on search results, the detail read, and every list row, so one type
 * describes "what is true for ME about this job" everywhere it is rendered.
 */
export interface ExternalJobPersonalState {
  saved: boolean;
  tracking: ExternalJobTracking | null;
}

/**
 * One row of the saved list.
 *
 * A saved job is a snapshot the candidate chose to keep, so it carries the
 * facts a card needs without a second read — and its own `status`, which is
 * how a closed listing can say so instead of vanishing.
 */
export interface SavedExternalJob {
  externalJobId: ID;
  title: string;
  company: string;
  status: ExternalJobLifecycle;
  location: ExternalJobPlace;
  additionalLocations: ExternalJobPlace[];
  workMode: WorkMode | null;
  remoteCountriesAllowed: string[];
  employmentType: EmploymentType | null;
  seniorityLevel: SeniorityLevel | null;
  salary: ExternalJobSalary;
  employerPostedAt: ISODateString | null;
  applyUrl: string | null;
  provenance: ExternalJobProvenance;
  /** When the candidate saved it. */
  savedAt: ISODateString;
  tracking: ExternalJobTracking | null;
}

export interface SavedExternalJobPage {
  /**
   * When the BACKEND read this list, so relative ages ("Posted 3 days ago")
   * measure from one instant the server chose — never from a clock read during
   * render, which would give the server pass and hydration different answers.
   */
  asOf: ISODateString;
  saved: SavedExternalJob[];
  total: number;
  page: number;
  pageSize: number;
  /** Derived: the API reports `total` and `pageSize`, not a page count. */
  totalPages: number;
}

/**
 * One row of "my external applications".
 *
 * The tracker is the row; the listing is `job`, and `job` is NULLABLE. A
 * tracker outlives the catalogue entry it points at — a candidate who applied
 * to a job that has since been purged still applied to it, and their record
 * must not vanish with the posting. The list renders such a row with the
 * tracker's own facts and says the listing is no longer available.
 */
export interface ExternalJobApplication extends ExternalJobTracking {
  externalJobId: ID;
  job: ExternalTrackedJobCard | null;
}

/** The listing behind a tracked application, when the catalogue still has it. */
export interface ExternalTrackedJobCard {
  externalJobId: ID;
  title: string;
  company: string;
  /** The LISTING's lifecycle — never a substitute for the tracked status. */
  status: ExternalJobLifecycle;
  location: ExternalJobPlace;
  applyUrl: string | null;
  /** Whether the same job is also saved. Independent of being tracked. */
  saved: boolean;
}

export interface ExternalJobApplicationPage {
  /** See SavedExternalJobPage.asOf. */
  asOf: ISODateString;
  applications: ExternalJobApplication[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

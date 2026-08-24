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
  EvidenceSourceType,
  EvidenceType,
  InterviewQuestionKind,
  LinkFailureCode,
  LinkStatus,
  NotificationAudience,
  NotificationType,
  ProcessingJobStatus,
  RequirementType,
  Role,
  VacancyStatus,
  CitizenshipRequirement,
  EducationLevel,
  HiringUrgency,
  JobBenefit,
  LanguageProficiency,
  PayPeriod,
  SeniorityLevel,
  VisaSponsorship,
  WorkMode,
  EmploymentType,
  JobIntentLocation,
  JobIntentCompensation,
  JobIntentSource,
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
    /** Short-lived signed URL, or null when the account has no picture. */
    avatarUrl?: string | null;
  };
  candidateAccount: {
    exists: boolean;
    /**
     * The candidate's plan, when this API knows about plans.
     *
     * Optional on purpose: builds of this frontend run against backends that
     * predate plan entitlement, and the adapter reads absence as "not stated"
     * rather than as FREE. Accepted here AND at the top level because the
     * field's final home is the backend's call, not ours — reading both costs
     * one `??` and removes a coordination step from a parallel rollout.
     */
    plan?: string | null;
    /** The backend's own capability grants, when it sends them. */
    capabilities?: string[] | null;
  };
  /** @see candidateAccount.plan — the same value, if the backend puts it here. */
  plan?: string | null;
  capabilities?: string[] | null;
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

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  audience: NotificationAudience;
  isRead: boolean;
  createdAt: string;
  vacancyId?: string | null;
  vacancyTitle?: string | null;
  candidateId?: string | null;
  candidateName?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  interviewId?: string | null;
  applicationId?: string | null;
  messagePreview?: string | null;
  /**
   * Temporary tolerance for the parallel backend branch's nested view shape.
   * Components never read these fields directly.
   */
  vacancy?: { id: string; title: string; deleted?: boolean } | null;
  candidate?: { id: string; name?: string | null; fullName?: string | null } | null;
  actor?: { id?: string | null; name?: string | null } | null;
}

export interface UnreadNotificationCountResponse {
  unread?: number;
  count?: number;
  unreadCount?: number;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  /** Optional public web address; null when the organization has none. */
  websiteUrl?: string | null;
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

/**
 * GET/PATCH /account/me, and the reply to an avatar upload or delete.
 *
 * The storage key is never in here: the backend mints a short-lived
 * `avatarUrl` per response instead, so nothing durable a client holds can be
 * turned back into a permanent link to somebody's picture.
 */
export interface AccountProfileResponse {
  id: string;
  email: string;
  fullName: string;
  accountType: AccountType;
  preferredLocale: SupportedLocale;
  avatarUrl: string | null;
  createdAt?: string;
  updatedAt?: string;
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

export interface VacancyLanguageResponse {
  languageCode: string;
  level: LanguageProficiency;
  required: boolean;
}

/**
 * The structured job profile as the API sends it.
 *
 * Optional at the TYPE level because summary payloads (the vacancy list, a
 * public job card) omit the long tail; `null` inside it means the employer
 * stated nothing. The adapter collapses both to null so a component never has
 * to tell "absent from this payload" from "absent from this job".
 */
export interface JobProfileResponse {
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  payPeriod?: PayPeriod | null;
  salaryNegotiable?: boolean;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  workMode?: WorkMode | null;
  officeDaysPerWeek?: number | null;
  remoteCountriesAllowed?: string[];
  foreignApplicantsAccepted?: boolean | null;
  visaSponsorship?: VisaSponsorship;
  existingWorkAuthorizationRequired?: boolean | null;
  eligibleVisaTypes?: string[];
  citizenshipRequirement?: CitizenshipRequirement;
  eligibleNationalities?: string[];
  seniorityLevel?: SeniorityLevel | null;
  minExperienceYears?: number | null;
  preferredExperienceYears?: number | null;
  requiredEducation?: EducationLevel | null;
  preferredEducation?: EducationLevel | null;
  requiredCertifications?: string[];
  preferredCertifications?: string[];
  domainExperience?: string[];
  benefits?: JobBenefit[];
  benefitsOther?: string | null;
  applicationDeadline?: string | null;
  expectedStartDate?: string | null;
  openingsCount?: number | null;
  hiringUrgency?: HiringUrgency | null;
  contractDurationMonths?: number | null;
}

export interface VacancyResponse extends JobProfileResponse {
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
  /** Detail payloads only — the list endpoint omits the relation. */
  languages?: VacancyLanguageResponse[];
  /**
   * How many PEOPLE are attached, not how many applications. The two differ
   * for any vacancy someone re-applied to, so the count is its own field —
   * `_count.applications` stays a truthful attempt count.
   */
  candidateCount?: number;
  _count?: { applications: number; requirements: number };
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
  candidate?: {
    id: string;
    fullName: string;
    email?: string | null;
    currentTitle?: string | null;
    /** Signed URL of the LIVE account avatar; null → initials fallback. */
    avatarUrl?: string | null;
  };
}

export interface CandidateResponse {
  id: string;
  organizationId: string;
  candidateAccountId?: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  totalExperienceYears: number | null;
  createdAt: string;
  updatedAt: string;
  /** Signed URL of the LIVE account avatar; null → initials fallback. */
  avatarUrl?: string | null;
  /** Count of CURRENT personal documents. */
  documentCount?: number;
  /** Current documents' statuses, for the aggregate processing state. */
  documentStatuses?: DocumentStatus[];
  applications?: ApplicationResponse[];
}

/* -------------------------------------------------------------------------- */
/* Interview chat                                                              */
/* -------------------------------------------------------------------------- */

export interface InviteToInterviewResponse {
  application: ApplicationResponse;
  /** Always present: every applicant owns the account they applied with. */
  conversation: { id: string; vacancyId: string; createdAt: string };
}

export interface OrganizationConversationResponse {
  id: string;
  vacancyId: string;
  createdAt: string;
  updatedAt: string;
  vacancy: { id: string; title: string; status: VacancyStatus };
  candidate: { id: string; fullName: string; email: string | null };
}

export interface CandidateConversationResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  vacancy: {
    publicSlug: string;
    title: string;
    status: VacancyStatus;
    organization: { name: string };
  };
}

export interface ConversationMessageResponse {
  id: string;
  conversationId: string;
  senderParty: "ORGANIZATION" | "CANDIDATE";
  senderName: string;
  content: string;
  createdAt: string;
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
    /** Resolved by the API in the same query. Null for unattached documents. */
    candidate?: { id: string; fullName: string } | null;
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
  /** The SOURCE key: a document id for a file, a link-source id for a link. */
  documentId: string;
  fileName: string | null;
  section: string | null;
  pageNumber: number | null;
  text: string;
  /** Absent on chunks indexed before URL evidence existed — those are files. */
  sourceType?: EvidenceSourceType;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
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
  /** Absent on citations from chunks indexed before URL evidence existed. */
  sourceType?: EvidenceSourceType;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
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
  /** The SOURCE id: a document id for a file, a link-source id for a link. */
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  section: string | null;
  text: string;
  sourceChunkId: string | null;
  /** Absent on rows stored before URL evidence existed — those are files. */
  sourceType?: EvidenceSourceType;
  sourceUrl?: string | null;
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
  status?: DocumentStatus;
  createdAt: string;
}

/** GET /candidate-account/me/links */
export interface CandidateLinkResponse {
  id: string;
  url: string;
  title: string | null;
  detectedType: string | null;
  status: LinkStatus;
  failureCode: LinkFailureCode | null;
  charCount: number | null;
  pagesFetched: number | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateLinksResponse {
  data: CandidateLinkResponse[];
  limit: number;
  remaining: number;
}

export interface CandidatePersonalDocumentsResponse {
  data: Array<CandidateResumeResponse & { status: DocumentStatus }>;
  limit: number;
  remaining: number;
  primaryDocumentId: string | null;
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
/* Candidate job preferences                                                   */
/* -------------------------------------------------------------------------- */

/** GET/PUT /candidate-account/me/job-preferences */
export interface JobPreferencesResponse {
  stated: boolean;
  preferredJobTitles: string[];
  preferredLocations: JobIntentLocation[];
  preferredWorkModes: WorkMode[];
  preferredEmploymentTypes: EmploymentType[];
  preferredSeniorityLevels: SeniorityLevel[];
  desiredSalaryMin: number | null;
  desiredSalaryMax?: number | null;
  salaryCurrency: string | null;
  payPeriod: PayPeriod | null;
  willingToRelocate: boolean | null;
  preferredIndustries: string[];
  preferredBenefits: JobBenefit[];
  excludedCompanies: string[];
  excludedJobTitles: string[];
  excludedLocations: JobIntentLocation[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CandidateJobIntentResponse {
  candidateAccountId: string;
  stated: boolean;
  roles: string[];
  locations: JobIntentLocation[];
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
  updatedAt: string | null;
}

/** GET /candidate-account/me/job-preferences/search-context */
export interface JobSearchContextResponse {
  candidateAccountId: string;
  jobIntent: CandidateJobIntentResponse;
  resolved: {
    query: { value: string | null; source: JobIntentSource };
    roles: { value: string[]; source: JobIntentSource };
    countries: { value: string[]; source: JobIntentSource };
    workModes: { value: WorkMode[]; source: JobIntentSource };
    employmentTypes: { value: EmploymentType[]; source: JobIntentSource };
    seniorityLevels: { value: SeniorityLevel[]; source: JobIntentSource };
    compensation: { value: JobIntentCompensation | null; source: JobIntentSource };
    exclusions: CandidateJobIntentResponse["exclusions"];
  };
  locale: string;
}

/* -------------------------------------------------------------------------- */
/* Public job board                                                            */
/* -------------------------------------------------------------------------- */

export interface PublicJobResponse extends JobProfileResponse {
  publicSlug: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  createdAt: string;
  organization: { name: string };
  /**
   * How many PEOPLE have applied — the same live number the recruiter sees.
   * Aggregate only: nothing about WHO applied crosses this boundary.
   */
  applicantCount: number;
  /**
   * Why this result sits where it does. Present only when the search stated a
   * soft preference; an unranked list has no ordering to explain.
   */
  searchAlignment?: {
    score: number | null;
    alignments: IntentAlignmentResponse[];
  };
}

export interface PublicJobDetailResponse extends PublicJobResponse {
  description: string | null;
  requirements: { text: string; type: RequirementType; required: boolean }[];
  languages?: VacancyLanguageResponse[];
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
    /**
     * How many PEOPLE have applied — the same live number the recruiter and
     * the job board see. Aggregate only; nothing about WHO applied.
     */
    applicantCount: number;
  };
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
  /** Absent on evidence from chunks indexed before URL sources existed. */
  sourceType?: EvidenceSourceType;
  sourceUrl?: string | null;
}

/**
 * POST /candidate-account/me/job-matches.
 *
 * Vacancies are addressed by public slug only — the backend never returns an
 * internal vacancy id on this candidate-facing route.
 */
/** STRONG | GOOD | PARTIAL | LOW — presentation only; LOW is still shown. */
export type MatchBandResponse = 'STRONG' | 'GOOD' | 'PARTIAL' | 'LOW';

export type AlignmentStateResponse =
  | 'MATCH'
  | 'PARTIAL'
  | 'MISMATCH'
  | 'UNKNOWN'
  | 'NOT_COMPARABLE';

/** One preference dimension's verdict, as the backend computed it. */
export interface IntentAlignmentResponse {
  dimension: string;
  state: AlignmentStateResponse;
  /** Canonical machine code, e.g. SALARY_WITHIN_DESIRED_RANGE. */
  reason: string;
  score: number | null;
  /** Salary only: original and converted figures behind the verdict. */
  salary?: {
    originalMin: number | null;
    originalMax: number | null;
    originalCurrency: string | null;
    originalPayPeriod: PayPeriod | null;
    convertedMin: number | null;
    convertedMax: number | null;
    convertedCurrency: string | null;
    convertedPayPeriod: PayPeriod | null;
  };
}

/** One job's pay restated in the candidate's own currency. */
export interface JobSalaryViewResponse {
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
    | 'CONVERTED'
    | 'SAME_CURRENCY'
    | 'NO_PREFERENCE'
    | 'SALARY_UNKNOWN'
    | 'NOT_COMPARABLE';
  fx: {
    snapshotVersion: string | null;
    fetchedAt: string | null;
    freshness: 'FRESH' | 'STALE_USABLE' | 'UNAVAILABLE';
  } | null;
}

export interface JobMatchResponse {
  vacancy: {
    slug: string;
    title: string;
    organizationName: string;
    location: string | null;
    employmentType: string | null;
    status: VacancyStatus;
    /** ORIGINAL pay, exactly as the employer stated it. */
    salaryMin?: number | null;
    salaryMax?: number | null;
    currency?: string | null;
    payPeriod?: PayPeriod | null;
    salaryNegotiable?: boolean;
    country?: string | null;
    region?: string | null;
    city?: string | null;
    workMode?: WorkMode | null;
    seniorityLevel?: SeniorityLevel | null;
  };
  match: JobMatchStrengthResponse;
  /** Presentation band derived from the canonical score. Never a filter. */
  band?: MatchBandResponse;
  /** 1-based position in the FULL ranked list. Stable for one ranking. */
  rank: number;
  /** 0-100. Orders the list; never a probability of being hired. */
  score: number;
  /** Evidence-side score. Equals `score` when no intent applied. */
  capabilityScore?: number | null;
  /**
   * Intent-side score, or null when the candidate stated nothing comparable.
   * Null and 0 are different: null is "no signal", 0 is "contradicts".
   */
  intentScore?: number | null;
  /** Per-dimension preference verdicts with machine-readable reason codes. */
  alignments?: IntentAlignmentResponse[];
  /** Per-signal breakdown (semantic/required/preferred/skills/roleFamily). */
  signals: Record<string, number>;
  matchedSkills: string[];
  missingSkills: string[];
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
  /** The evidence revision this analysis was computed from. */
  evidenceRevision: number;
  /**
   * Prose for this page is still being written in the background.
   *
   * Distinct from `generated: false`, which means generation is unavailable —
   * a card must not say "unavailable" about text that is simply not here yet.
   */
  explanationsPending: boolean;
  /** 1-based page of the ranked list this response carries. */
  page: number;
  /** Page size. Bounds the PAGE, never the ranking. */
  limit: number;
  /** The FULL ranked count — how far a client can scroll. */
  total: number;
  totalPages: number;
  hasMore: boolean;
  /** How many vacancies the candidate was eligible for. */
  totalEligible: number;
  /** How many the candidate's OWN explicit exclusions removed. */
  totalExcluded?: number;
  /** The exchange rates this ranking's salary figures were computed from. */
  fx?: { snapshotVersion: string | null; fetchedAt: string | null };
  /** Skills, role families and sources the ranking actually used. */
  capability: Record<string, unknown>;
  /**
   * True when the candidate's evidence changed WHILE this was being generated
   * — a ~20s call can outlive the files it describes. A stale result is never
   * presented as the current analysis.
   */
  stale: boolean;
}

/** GET /candidate-account/me/evidence — the evidence gate's input. */
export interface CandidateEvidenceStateResponse {
  hasAccount: boolean;
  files: number;
  links: number;
  total: number;
  evidenceRevision: number;
  /** The backend's own answer, so the button and the endpoint agree. */
  canRunJobMatch: boolean;
}

/* -------------------------------------------------------------------------- */
/* Vacancy-scoped HR workspace                                                 */
/* -------------------------------------------------------------------------- */

/**
 * GET /vacancies/mine — deliberately slim rows for the selector.
 *
 * Only the caller's OWN vacancies in the active organization. This is the
 * source for every creator-scoped selector; the org-wide `GET /vacancies`
 * catalog stays readable by every member but must not drive them.
 */
export interface MyVacancyResponse {
  id: string;
  title: string;
  status: VacancyStatus;
  createdAt: string;
  candidateCount: number;
  requirementCount: number;
}

/**
 * GET /vacancies/:vacancyId/candidates — one normalized row for manual and
 * platform candidates alike. `application.status` is the stage in THIS
 * vacancy; the same person can sit in several with independent stages.
 */
export interface VacancyCandidateRowResponse {
  candidate: {
    id: string;
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
    id: string;
    status: ApplicationStatus;
    createdAt: string;
  };
}

/** POST /vacancies/bulk-delete — all-or-nothing. */
export interface BulkDeleteVacanciesResponse {
  deletedIds: string[];
  deletedCount: number;
}

/* -------------------------------------------------------------------------- */
/* External job search (Task 4C.1 backend contract)                            */
/* -------------------------------------------------------------------------- */

/**
 * What POST /candidate-account/me/external-jobs/search returns.
 *
 * `reasons` and `additionalLocations` are typed `unknown` on purpose: the
 * backend stores both as JSON columns, so the wire shape is whatever was
 * written when the snapshot was taken. The adapter validates them rather than
 * trusting a cast — a snapshot written by an older algorithm version must not
 * be able to crash a render.
 */
export interface ExternalJobSearchResultResponse {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  status: string;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additionalLocations: unknown;
  workMode: string | null;
  remoteCountriesAllowed: string[] | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  };
  /** The employer's own publication date, ISO. Never a crawler timestamp. */
  employerPostedAt: string | null;
  score: number;
  band: string;
  textScore: number | null;
  intentScore: number | null;
  reasons: unknown;
  applyUrl: string | null;
  /**
   * Per-candidate state, owned by the backend.
   *
   * OPTIONAL on the wire: the search and detail endpoints predate saving, and
   * an older API simply omits them. Absent is adapted to "not saved, not
   * tracked" — which is the truth about a build that cannot save anything —
   * never to a client-side guess that gets rendered as fact.
   */
  saved?: boolean;
  applicationTracking?: ExternalJobTrackingResponse | null;
  provenance: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  };
}

export interface ExternalJobSearchResponse {
  runId: string;
  algorithmVersion: string;
  /** The order the backend actually applied. Echoed, never inferred. */
  sort: string;
  /** When the backend produced this response. Relative ages measure from it. */
  asOf: string;
  applied: {
    query: string | null;
    countries: { value: string[]; source: string };
    workModes: { value: string[]; source: string };
    employmentTypes: { value: string[]; source: string };
    seniorityLevels: { value: string[]; source: string };
    compensation: { stated: boolean; source: string };
  };
  total: number;
  matched: number;
  ranked: number;
  truncated: boolean;
  page: number;
  pageSize: number;
  degraded: boolean;
  results: ExternalJobSearchResultResponse[];
  /** Retrieval counters. Read by nothing in the UI; never shown to a reader. */
  diagnostics?: unknown;
}

/** GET /candidate-account/me/external-jobs/:id — one job, no personalization. */
export interface ExternalJobDetailResponse {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  status: string;
  description: string | null;
  requirementsText: string | null;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additionalLocations: unknown;
  workMode: string | null;
  remoteCountriesAllowed: string[] | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  };
  employerPostedAt: string | null;
  skills: string[] | null;
  industries: string[] | null;
  benefits: string[] | null;
  languageCodes: string[] | null;
  applyUrl: string | null;
  /** See ExternalJobSearchResultResponse — same optionality, same meaning. */
  saved?: boolean;
  applicationTracking?: ExternalJobTrackingResponse | null;
  provenance: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  };
}

/* -------------------------------------------------------------------------- */
/* External jobs — saving and self-tracked applications                        */
/* -------------------------------------------------------------------------- */

/**
 * The candidate's own tracking record.
 *
 * `status` is `string` on the wire on purpose: it is an enum the BACKEND owns,
 * and a build that has not been redeployed must not print a value it cannot
 * localize. The adapter narrows it and drops anything unrecognised.
 */
export interface ExternalJobTrackingResponse {
  id: string;
  status: string;
  appliedAt: string;
  note?: string | null;
  updatedAt?: string | null;
}

/**
 * The job card both candidate-owned lists embed.
 *
 * One shape, because the backend builds both from the same
 * `ExternalJobCardService` — so the saved list and the tracked list cannot
 * drift apart, and neither can their adapters.
 */
export interface SavedExternalJobCardResponse {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl?: string | null;
  /** The listing's lifecycle. Distinct from any tracking status. */
  status: string;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  } | null;
  additionalLocations?: unknown;
  workMode: string | null;
  remoteCountriesAllowed?: string[] | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  } | null;
  employerPostedAt: string | null;
  applyUrl: string | null;
  provenance?: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  } | null;
}

export interface SavedExternalJobResponse extends SavedExternalJobCardResponse {
  savedAt: string;
  applicationTracking?: ExternalJobTrackingResponse | null;
}

/**
 * One tracked application.
 *
 * The tracker's own fields sit at the top level; everything about the LISTING
 * is nested under `job` — and `job` is nullable, because a tracker outlives
 * the catalogue row it points at. A candidate who applied to a job that has
 * since been purged still applied to it, and the record stays.
 */
export interface ExternalJobApplicationResponse
  extends ExternalJobTrackingResponse {
  externalJobId: string;
  createdAt?: string | null;
  job: (SavedExternalJobCardResponse & { saved?: boolean }) | null;
}

/** What the save/unsave routes answer with. The backend stays authoritative. */
export interface ExternalJobSaveStateResponse {
  externalJobId: string;
  saved: boolean;
  /** Present on a save, absent on an unsave — there is no time to report. */
  savedAt?: string;
}

/**
 * The envelope the candidate-owned external lists use.
 *
 * Deliberately NOT the shared `Paginated<T>` the rest of the API uses: these
 * routes answer `{page, pageSize, total, asOf, results}` with no `meta` and no
 * `totalPages`. Modelling it honestly here is what keeps the difference in one
 * file instead of turning into an always-empty list in a component that
 * reached for `.data`.
 *
 * `asOf` is the backend's own read instant, which is why the frontend does not
 * invent one: relative ages measure from when the server answered.
 */
export interface ExternalPagedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  asOf: string;
  results: T[];
}

/** The 409 body when a job is already tracked. */
/**
 * POST /candidate-account/me/external-jobs/:externalJobId/why-match
 *
 * The generated explanation returned by the backend. The adapter still treats
 * malformed model payloads defensively, but the API contract itself is this
 * complete envelope.
 *
 * `cached` is deliberately typed and deliberately NOT surfaced: whether the
 * backend answered from Redis is our plumbing, and telling a reader about it
 * would be noise dressed as transparency.
 */
export interface ExternalWhyMatchResponse {
  jobId: string;
  version: string;
  locale: string;
  summary: string | null;
  strengths: { title?: string | null; explanation?: string | null }[];
  gaps: { title?: string | null; explanation?: string | null }[];
  /** Backend cache metadata. Read, then intentionally dropped. */
  cached: boolean;
  generatedAt: string;
}

export interface ExternalAlreadyTrackedResponse {
  message: string;
  trackingId: string | null;
}

/**
 * Wire types, mirroring what the NestJS BFF already returns.
 *
 * Deliberately narrow: only the fields the mobile app renders. Nothing here
 * is invented — every field exists on the web client's contract for the same
 * endpoint, so the two stay in step without the mobile app defining a second
 * version of the truth.
 */
export type AccountType = "CANDIDATE" | "ORGANIZATION";
export type Role = "OWNER" | "HR_ADMIN" | "RECRUITER" | "INTERVIEWER";
export type CandidatePlan = "FREE" | "PRO" | "MAX";
export type PlanCapability = "INTERNAL_AI_SEARCH" | "EXTERNAL_AI_SEARCH";

export type ApplicationStatus =
  | "NEW"
  | "REVIEWING"
  | "INTERVIEW"
  | "OFFER"
  | "HIRED"
  | "REJECTED"
  | "WITHDRAWN";

export type VacancyStatus = "OPEN" | "CLOSED" | "DRAFT" | "ARCHIVED";

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

/** GET /auth/me. The ONLY source of account type and entitlements. */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  accountType: AccountType;
  hasCandidateAccount: boolean;
  activeOrganization: SessionOrganization | null;
  organizations: SessionOrganization[];
  /** Absent on an API that does not report a plan — never assume FREE. */
  plan?: CandidatePlan | null;
  capabilities?: PlanCapability[] | null;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  job: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    organizationName: string;
    applicantCount: number;
  };
}

export interface SavedJob {
  savedAt: string;
  job: {
    publicSlug: string;
    title: string;
    location: string | null;
    employmentType: string | null;
    status: VacancyStatus;
    organizationName: string;
  };
}

export interface CandidateEvidenceState {
  hasAccount: boolean;
  files: number;
  links: number;
  total: number;
  canRunJobMatch: boolean;
}

export type MatchBand = "STRONG" | "GOOD" | "PARTIAL" | "LOW";

export interface JobMatch {
  vacancy: {
    slug: string;
    title: string;
    organizationName: string;
    location: string | null;
    employmentType: string | null;
    status: VacancyStatus;
  };
  band: MatchBand;
  rank: number;
  score: number;
  explanation: string | null;
  saved: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  audience: "HR" | "CANDIDATE";
  isRead: boolean;
  createdAt: string;
  vacancyTitle?: string | null;
  candidateName?: string | null;
  messagePreview?: string | null;
}

export interface Vacancy {
  id: string;
  title: string;
  status: VacancyStatus;
  location: string | null;
  applicantCount?: number;
  createdAt: string;
}

export interface Conversation {
  id: string;
  vacancyTitle?: string | null;
  counterpartName?: string | null;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
}

/* ------------------------------------------------------------------ */
/* Public job search                                                   */
/* ------------------------------------------------------------------ */

export interface PublicJob {
  publicSlug: string;
  title: string;
  organizationName: string;
  location: string | null;
  employmentType: string | null;
  workMode?: string | null;
  seniority?: string | null;
  status: VacancyStatus;
  applicantCount?: number;
  publishedAt?: string | null;
  description?: string | null;
  /** Present only on the detail read; the list does not carry it. */
  requirements?: { id: string; text: string; required: boolean }[];
}

/* ------------------------------------------------------------------ */
/* External jobs                                                       */
/* ------------------------------------------------------------------ */

/**
 * One external job as the search returns it.
 *
 * Field names mirror the backend's response exactly — `externalJobId`, not
 * `id`; `company`, not `companyName` — because a rename here is a translation
 * layer that has to be maintained in both directions the first time the
 * contract moves.
 */
export interface ExternalJob {
  externalJobId: string;
  title: string;
  company: string;
  status: string;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  workMode: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  };
  /**
   * The employer's own publication date. Never a crawler timestamp — several
   * providers state no date at all, and showing when we SAW a job as when it
   * was POSTED is a fabrication the UI must not commit.
   */
  employerPostedAt: string | null;
  score: number;
  band: string;
  applyUrl: string | null;
  /** Absent on an older API means "not saved" — never a client-side guess. */
  saved?: boolean;
  provenance?: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  };
}

export interface ExternalSearchResult {
  runId: string;
  sort: string;
  asOf: string;
  total: number;
  page: number;
  pageSize: number;
  /** The backend answered from a degraded path; results may be incomplete. */
  degraded: boolean;
  results: ExternalJob[];
}

/* ------------------------------------------------------------------ */
/* Candidate profile, documents, preferences                           */
/* ------------------------------------------------------------------ */

export interface CandidateAccount {
  id: string;
  fullName: string;
  email?: string | null;
  currentTitle: string | null;
  location: string | null;
  totalExperienceYears: number | null;
  summary?: string | null;
  skills?: string[];
  avatarUrl?: string | null;
}

export type DocumentStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "QUEUED";

/**
 * GET /candidate-account/me/documents.
 *
 * An ENVELOPE, not a bare array. `remaining` is the authoritative upload-cap
 * state — the app must not derive it from `data.length`, because the cap and
 * the count are the server's to reconcile (a tombstoned row can occupy a slot
 * that no longer appears in the list).
 */
export interface CandidateDocumentList {
  data: CandidateDocument[];
  limit: number;
  remaining: number;
  primaryDocumentId: string | null;
}

export interface CandidateDocument {
  id: string;
  originalFileName: string;
  status: DocumentStatus;
  sizeBytes?: number | null;
  createdAt: string;
  errorMessage?: string | null;
}

export interface JobPreferences {
  desiredTitles?: string[];
  locations?: string[];
  workModes?: string[];
  employmentTypes?: string[];
  seniority?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryCurrency?: string | null;
  openToRelocation?: boolean | null;
}

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

/** GET /candidate-account/me/billing — the server's word on what is paid for. */
export interface BillingState {
  plan: CandidatePlan;
  capabilities?: string[];
  subscriptionStatus?: string | null;
  /** Paid access runs to here after a cancellation. */
  effectiveUntil?: string | null;
  version?: number | null;
}

/**
 * POST /candidate-account/me/billing/checkout.
 *
 * `redirectUrl` is the hosted Toss page. The device opens it and never sees a
 * card, a token or a key; `reused` says an idempotent retry returned the same
 * logical checkout rather than starting a second one.
 */
export interface CheckoutSession {
  paymentId: string;
  checkoutId: string;
  redirectUrl: string;
  reused: boolean;
}

/* ------------------------------------------------------------------ */
/* Recruiter                                                           */
/* ------------------------------------------------------------------ */

export interface CandidateSummaryRow {
  id: string;
  fullName: string;
  currentTitle: string | null;
  location: string | null;
  totalExperienceYears: number | null;
  documentCount?: number;
  primaryVacancyId?: string | null;
  primaryVacancyTitle?: string | null;
}

export interface VacancyRequirement {
  id: string;
  text: string;
  required: boolean;
}

export interface VacancyDetail extends Vacancy {
  description?: string | null;
  requirements: VacancyRequirement[];
}

/**
 * What one candidate's evidence says about one requirement.
 *
 * `NOT_RUN` is a fourth state and NOT a synonym for "no evidence": it means
 * the map has never been generated for this pair, which is a different fact
 * from "generated, and found nothing".
 */
export type EvidenceStatus = "STRONG" | "PARTIAL" | "GAP" | "NOT_RUN";

export interface EvidenceCitation {
  snippet: string;
  documentName?: string | null;
  page?: number | null;
  section?: string | null;
}

export interface EvidenceMapRequirement {
  requirementId: string;
  status: EvidenceStatus;
  citations: EvidenceCitation[];
}

export interface EvidenceMap {
  hasRun: boolean;
  requirements: EvidenceMapRequirement[];
}

export interface ComparisonCell {
  candidateId: string;
  status: EvidenceStatus;
  citation: EvidenceCitation | null;
}

export interface ComparisonRow {
  requirementId: string;
  requirementText: string;
  required: boolean;
  cells: ComparisonCell[];
}

export interface ComparisonResult {
  vacancyId: string;
  vacancyTitle: string;
  candidates: CandidateSummaryRow[];
  rows: ComparisonRow[];
  /** Candidates whose evidence map has never been generated. */
  unmappedCandidateIds: string[];
}

export interface SearchEvidenceHit {
  candidateId: string;
  candidateName: string;
  snippet: string;
  documentName?: string | null;
  page?: number | null;
  score?: number | null;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
  senderRole?: "CANDIDATE" | "ORGANIZATION" | string;
  senderName?: string | null;
  isMine?: boolean;
}

/** GET /organizations/current/stats — the recruiting overview's counters. */
export interface OrganizationStats {
  users: number;
  vacancies: number;
  openVacancies: number;
  candidates: number;
  applications: number;
  documents: number;
}

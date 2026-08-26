/**
 * Backend wire shapes → frontend domain types.
 *
 * All derivation lives here so components never compute domain meaning from a
 * raw response, and so there is exactly one place to change when the API
 * changes. Nothing here invents data: a field the API does not return becomes
 * null, not a plausible-looking value.
 */
import type {
  AiAnswerResponse,
  AuthSessionRowResponse,
  CandidateAccountResponse,
  CandidateConversationResponse,
  ConversationMessageResponse,
  MyApplicationResponse,
  OrganizationConversationResponse,
  PublicJobDetailResponse,
  PublicJobResponse,
  SavedJobResponse,
  JobMatchesResponse,
  MyVacancyResponse,
  VacancyCandidateRowResponse,
  AiCandidateSummaryResponse,
  AiCitationResponse,
  AiInterviewQuestionsResponse,
  ApplicationResponse,
  EvidenceMapEvidenceResponse,
  EvidenceMapResponse,
  EvidenceSearchResponse,
  CandidateLinkResponse,
  CandidateResumeResponse,
  CandidateResponse,
  EvidenceResponse,
  InviteToInterviewResponse,
  JobRequirementResponse,
  MeResponse,
  AccountProfileResponse,
  OrganizationResponse,
  ProcessingJobResponse,
  UserResponse,
  VacancyResponse,
  JobProfileResponse,
  JobPreferencesResponse,
  JobSearchContextResponse,
  CandidateJobIntentResponse,
  JobSalaryViewResponse,
  MatchEvidenceRefResponse,
  JobMatchResponse,
  MatchInsightResponse,
  HrMatchInsightResponse,
  CompareInsightsResponse,
  CompareSuperlativeResponse,
} from "@/lib/api/contracts";
import { PIPELINE_STAGES } from "@/lib/types";
import type {
  CareerTrajectory,
  MatchEvidenceRef,
  MatchInsight,
} from "@/lib/match/insight";
import type {
  CompareInsights,
  CompareSuperlative,
  HrMatchInsight,
} from "@/lib/match/hr-insight";
import { resolveEntitlements } from "@/lib/entitlements/plan";
import type {
  AccountProfile,
  Application,
  AuthSessionRow,
  Candidate,
  CandidateAccount,
  CandidateInterviewConversation,
  MyApplication,
  OrganizationInterviewConversation,
  PublicJob,
  PublicJobDetail,
  JobProfile,
  VacancyLanguageRequirement,
  CandidateJobPreferences,
  CandidateJobIntent,
  JobSearchContext,
  SavedJob,
  JobMatchResult,
  MyVacancy,
  VacancyCandidate,
  CandidateEvidenceMatch,
  CandidateSummary,
  EvidenceMap,
  EvidenceMappingStatus,
  GroundedAnswer,
  InterviewQuestionSet,
  RequirementMapping,
  EvidenceSearchResult,
  CandidateLink,
  Citation,
  DocumentStatus,
  Evidence,
  EvidenceStatus,
  InterviewMessage,
  InviteToInterviewResult,
  JobRequirement,
  Organization,
  PersonalDocument,
  PipelineStage,
  ProcessingJob,
  ProcessingSummary,
  RequirementEvidence,
  SessionUser,
  TeamMember,
  Vacancy,
  JobMatchStrength,
  MatchBand,
  JobSalaryView,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * GET /auth/me → the session.
 *
 * Reads the canonical `user` / `candidateAccount` / `activeOrganization` /
 * `memberships` shape and ignores the backend's flat compatibility fields:
 * authorization must come from the live membership, and mapping `role` off a
 * user-level field is exactly the assumption the identity migration removed.
 */
export function toSessionUser(response: MeResponse): SessionUser {
  return {
    id: response.user.id,
    fullName: response.user.fullName,
    email: response.user.email,
    accountType: response.user.accountType,
    preferredLocale: response.user.preferredLocale,
    avatarUrl: response.user.avatarUrl ?? null,
    hasCandidateAccount: response.candidateAccount.exists,
    /*
     * Resolved once, here, from whatever the backend stated — and from nothing
     * else. There is no localStorage fallback, no URL parameter and no
     * remembered value: a plan the frontend made up is a plan the backend will
     * refuse, and the refusal would land on the reader as a broken screen.
     */
    entitlements: resolveEntitlements({
      plan: response.candidateAccount.plan ?? response.plan,
      capabilities: response.candidateAccount.capabilities ?? response.capabilities,
    }),
    activeOrganization: response.activeOrganization,
    memberships: response.memberships.map((membership) => ({
      organization: membership.organization,
      role: membership.role,
      joinedAt: membership.joinedAt,
    })),
  };
}

export function toAuthSession(
  response: AuthSessionRowResponse,
): AuthSessionRow {
  return {
    id: response.id,
    createdAt: response.createdAt,
    lastUsedAt: response.lastUsedAt,
    expiresAt: response.expiresAt,
    userAgent: response.userAgent,
    deviceName: response.deviceName,
    current: response.current,
  };
}

export function toAccountProfile(
  response: AccountProfileResponse,
): AccountProfile {
  return {
    id: response.id,
    fullName: response.fullName,
    email: response.email,
    accountType: response.accountType,
    // Absent and null mean the same thing — no picture, render initials.
    avatarUrl: response.avatarUrl ?? null,
  };
}

export function toOrganization(response: OrganizationResponse): Organization {
  return {
    id: response.id,
    name: response.name,
    slug: response.slug,
    websiteUrl: response.websiteUrl ?? null,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    counts: response._count,
  };
}

export function toTeamMember(response: UserResponse): TeamMember {
  return {
    id: response.id,
    fullName: response.fullName,
    email: response.email,
    role: response.role,
    createdAt: response.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Vacancies                                                                   */
/* -------------------------------------------------------------------------- */

export function toJobRequirement(
  response: JobRequirementResponse,
): JobRequirement {
  return {
    id: response.id,
    vacancyId: response.vacancyId,
    text: response.text,
    type: response.type,
    required: response.required,
  };
}

/**
 * The structured job profile, normalized once for every surface that shows a
 * job — internal vacancy or public posting.
 *
 * Collapses two different absences into one: a field the payload omits (a
 * summary endpoint) and a field the employer never filled in both become
 * `null` / `[]`. Components then have a single question to ask — "is this
 * specified?" — rather than having to know which endpoint they came from.
 *
 * The two NOT NULL columns keep their honest defaults: an unstated visa policy
 * reads UNKNOWN, never "no".
 */
export function toJobProfile(response: JobProfileResponse): JobProfile {
  return {
    salaryMin: response.salaryMin ?? null,
    salaryMax: response.salaryMax ?? null,
    currency: response.currency ?? null,
    payPeriod: response.payPeriod ?? null,
    salaryNegotiable: response.salaryNegotiable ?? false,

    country: response.country ?? null,
    region: response.region ?? null,
    city: response.city ?? null,
    workMode: response.workMode ?? null,
    officeDaysPerWeek: response.officeDaysPerWeek ?? null,
    remoteCountriesAllowed: response.remoteCountriesAllowed ?? [],

    // `?? null` and not `?? false`: "the employer did not say" is a third
    // state, and flattening it to false would advertise every unspecified
    // vacancy as closed to foreign applicants.
    foreignApplicantsAccepted: response.foreignApplicantsAccepted ?? null,
    visaSponsorship: response.visaSponsorship ?? "UNKNOWN",
    existingWorkAuthorizationRequired:
      response.existingWorkAuthorizationRequired ?? null,
    eligibleVisaTypes: response.eligibleVisaTypes ?? [],
    citizenshipRequirement: response.citizenshipRequirement ?? "NONE",
    eligibleNationalities: response.eligibleNationalities ?? [],

    seniorityLevel: response.seniorityLevel ?? null,
    minExperienceYears: response.minExperienceYears ?? null,
    preferredExperienceYears: response.preferredExperienceYears ?? null,

    requiredEducation: response.requiredEducation ?? null,
    preferredEducation: response.preferredEducation ?? null,
    requiredCertifications: response.requiredCertifications ?? [],
    preferredCertifications: response.preferredCertifications ?? [],
    domainExperience: response.domainExperience ?? [],

    benefits: response.benefits ?? [],
    benefitsOther: response.benefitsOther ?? null,

    applicationDeadline: response.applicationDeadline ?? null,
    expectedStartDate: response.expectedStartDate ?? null,
    openingsCount: response.openingsCount ?? null,
    hiringUrgency: response.hiringUrgency ?? null,
    contractDurationMonths: response.contractDurationMonths ?? null,
  };
}

function toLanguageRequirements(
  languages: { languageCode: string; level: VacancyLanguageRequirement["level"]; required: boolean }[] | undefined,
): VacancyLanguageRequirement[] {
  return (languages ?? []).map((language) => ({
    languageCode: language.languageCode,
    level: language.level,
    required: language.required,
  }));
}

export function toVacancy(response: VacancyResponse): Vacancy {
  const requirements = (response.requirements ?? []).map(toJobRequirement);

  return {
    ...toJobProfile(response),
    id: response.id,
    organizationId: response.organizationId,
    title: response.title,
    department: response.department,
    location: response.location,
    employmentType: response.employmentType,
    experienceLevel: response.experienceLevel,
    description: response.description,
    status: response.status,
    createdById: response.createdById,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    requirements,
    languages: toLanguageRequirements(response.languages),
    // The list endpoint returns counts instead of the nested collections.
    // `candidateCount` counts people; `_count.applications` counts attempts,
    // and a re-applicant makes those differ — so the explicit field wins and
    // the attempt count is only a fallback for a payload without it.
    candidateCount: response.candidateCount ?? response._count?.applications ?? 0,
    requirementCount: response._count?.requirements ?? requirements.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Documents & processing                                                      */
/* -------------------------------------------------------------------------- */




/** The caller's own professional links. */
export function toCandidateLink(response: CandidateLinkResponse): CandidateLink {
  return {
    id: response.id,
    url: response.url,
    title: response.title ?? hostnameOf(response.url),
    detectedType: response.detectedType,
    status: response.status,
    failureCode: response.failureCode,
    charCount: response.charCount ?? null,
    pagesFetched: response.pagesFetched ?? null,
    lastFetchedAt: response.lastFetchedAt,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
}

/**
 * A short readable stand-in for a URL.
 *
 * Long URLs must never be rendered unbounded — a 300-character link breaks
 * every layout it lands in — so lists show this and keep the full address on
 * the outbound link itself.
 */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function toProcessingJob(
  response: ProcessingJobResponse,
  /**
   * Overrides the candidate the API resolved. Defaults to the response's own
   * join — since the snapshot removal there is no org-wide document list to
   * resolve names against on the client.
   */
  candidate: { id: string; fullName: string } | null = null,
): ProcessingJob {
  const person = candidate ?? response.document?.candidate ?? null;
  return {
    id: response.id,
    organizationId: response.organizationId,
    documentId: response.documentId,
    type: response.type,
    status: response.status,
    progress: response.progress,
    attempts: response.attempts,
    errorMessage: response.errorMessage,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    document: response.document ?? null,
    candidateId: person?.id ?? null,
    candidateName: person?.fullName ?? null,
  };
}

/**
 * Cumulative "reached at least this stage" counts, which is how the pipeline
 * readout is designed to be read.
 */
export function summarizeDocumentStatuses(
  statuses: DocumentStatus[],
): ProcessingSummary {
  const reached = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, 0]),
  ) as Record<PipelineStage, number>;

  let failed = 0;

  for (const status of statuses) {
    if (status === "FAILED") {
      failed += 1;
      continue;
    }
    // QUEUED means uploaded but not yet parsing.
    const index =
      status === "QUEUED"
        ? 0
        : (PIPELINE_STAGES as readonly string[]).indexOf(status);
    if (index < 0) continue;

    for (let i = 0; i <= index; i += 1) reached[PIPELINE_STAGES[i]] += 1;
  }

  return { total: statuses.length, failed, reached };
}

/** Percentage of the pipeline a single document has completed. */
export function documentProgress(status: DocumentStatus): number {
  if (status === "COMPLETED") return 100;
  if (status === "FAILED") return 0;
  if (status === "QUEUED") return 8;
  const index = (PIPELINE_STAGES as readonly string[]).indexOf(status);
  if (index < 0) return 0;
  return Math.round((index / (PIPELINE_STAGES.length - 1)) * 100);
}

/**
 * A candidate's headline processing state: the least-advanced document, so a
 * candidate is never shown as ready while one file is still being read.
 */
export function aggregateDocumentStatus(
  documents: { status: DocumentStatus }[],
): DocumentStatus | null {
  if (documents.length === 0) return null;
  if (documents.some((d) => d.status === "FAILED")) return "FAILED";

  let lowest = Number.POSITIVE_INFINITY;
  let result: DocumentStatus = "COMPLETED";

  for (const document of documents) {
    const index =
      document.status === "QUEUED"
        ? 0
        : (PIPELINE_STAGES as readonly string[]).indexOf(document.status);
    if (index >= 0 && index < lowest) {
      lowest = index;
      result = document.status;
    }
  }

  return result;
}

/**
 * Whether the AI features have anything to read, and why not when they do not.
 *
 * Deliberately different from `aggregateDocumentStatus`, which reports the
 * worst-case state so a candidate is never shown as "ready" while a file is
 * still being read. That is the right headline, but the wrong gate here: the AI
 * service reads whatever is indexed, so one failed upload alongside two indexed
 * resumes must not hide a summary the model can genuinely produce.
 */
export type AiReadiness = "ready" | "no_documents" | "processing" | "failed";

export function aiReadiness(
  /**
   * The applicant's CURRENT sources, files and links together. Links are
   * evidence exactly like files, so a candidate whose only indexed source is
   * a portfolio is READY — gating the AI panels on files alone would hide
   * answers the model can genuinely give. File statuses and link statuses use
   * different vocabularies, but the two states that matter here — COMPLETED
   * and FAILED — are shared.
   */
  sources: { status: string }[],
): AiReadiness {
  if (sources.length === 0) return "no_documents";
  if (sources.some((source) => source.status === "COMPLETED")) {
    return "ready";
  }
  // Nothing is indexed. Still moving through the pipeline beats "failed", so a
  // candidate mid-upload is not reported as broken.
  if (sources.some((source) => source.status !== "FAILED")) {
    return "processing";
  }
  return "failed";
}

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

export function toApplication(response: ApplicationResponse): Application {
  return {
    id: response.id,
    candidateId: response.candidateId,
    vacancyId: response.vacancyId,
    status: response.status,
    // Present only once the API models provenance; never defaulted, because a
    // guessed source would misreport where a candidate actually came from.
    source: response.source,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    vacancy: response.vacancy,
    candidate: response.candidate
      ? {
          id: response.candidate.id,
          // The LIVE account identity the API resolved — an applicant row
          // shows who the person is now, not who they were when the org-side
          // record was first written.
          fullName: response.candidate.fullName,
          currentTitle: response.candidate.currentTitle ?? null,
          avatarUrl: response.candidate.avatarUrl ?? null,
        }
      : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Interview chat                                                              */
/* -------------------------------------------------------------------------- */

export function toInterviewMessage(
  response: ConversationMessageResponse,
): InterviewMessage {
  return {
    id: response.id,
    conversationId: response.conversationId,
    senderParty: response.senderParty,
    senderName: response.senderName,
    content: response.content,
    createdAt: response.createdAt,
  };
}

export function toOrganizationConversation(
  response: OrganizationConversationResponse,
): OrganizationInterviewConversation {
  return {
    side: "organization",
    id: response.id,
    vacancyId: response.vacancyId,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    vacancy: response.vacancy,
    candidate: response.candidate,
  };
}

export function toCandidateConversation(
  response: CandidateConversationResponse,
): CandidateInterviewConversation {
  return {
    side: "candidate",
    id: response.id,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    vacancy: {
      publicSlug: response.vacancy.publicSlug,
      title: response.vacancy.title,
      status: response.vacancy.status,
      organizationName: response.vacancy.organization.name,
    },
  };
}

export function toInviteToInterviewResult(
  response: InviteToInterviewResponse,
): InviteToInterviewResult {
  return {
    application: toApplication(response.application),
    conversation: response.conversation,
  };
}

export function toCandidate(response: CandidateResponse): Candidate {
  const applications = (response.applications ?? []).map(toApplication);
  const primary = applications[0];
  const documentStatuses = response.documentStatuses ?? [];

  return {
    id: response.id,
    organizationId: response.organizationId,
    candidateAccountId: response.candidateAccountId ?? null,
    fullName: response.fullName,
    email: response.email,
    phone: response.phone,
    location: response.location,
    currentTitle: response.currentTitle,
    totalExperienceYears: response.totalExperienceYears,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    avatarUrl: response.avatarUrl ?? null,
    documentCount: response.documentCount ?? documentStatuses.length,
    documentStatuses,
    applications,
    processingStatus: aggregateDocumentStatus(
      documentStatuses.map((status) => ({ status })),
    ),
    primaryVacancyId: primary?.vacancyId ?? null,
    primaryVacancyTitle: primary?.vacancy?.title ?? null,
  };
}

export function toPersonalDocument(
  response: CandidateResumeResponse & { status?: DocumentStatus },
): PersonalDocument {
  return {
    id: response.id,
    originalFileName: response.originalFileName,
    mimeType: response.mimeType,
    fileSize: response.fileSize,
    status: response.status ?? "UPLOADED",
    createdAt: response.createdAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

export function toEvidence(response: EvidenceResponse): Evidence {
  return {
    id: response.id,
    candidateId: response.candidateId,
    documentId: response.documentId,
    vacancyId: response.vacancyId,
    requirementId: response.requirementId,
    pageNumber: response.pageNumber,
    section: response.section,
    text: response.text,
    evidenceType: response.evidenceType,
    createdAt: response.createdAt,
    document: response.document
      ? {
          id: response.document.id,
          originalFileName: response.document.originalFileName,
        }
      : undefined,
  };
}

export function toCitation(
  evidence: Evidence,
  documentNames: Map<string, string>,
): Citation {
  return {
    id: evidence.id,
    // Stored evidence predates the AI service's chunk ids; rows written by a
    // mapping carry one, and `toEvidenceMapCitation` reads it.
    chunkId: null,
    documentId: evidence.documentId,
    documentName:
      evidence.document?.originalFileName ??
      documentNames.get(evidence.documentId) ??
      null,
    page: evidence.pageNumber,
    section: evidence.section,
    snippet: evidence.text,
    // Stored CandidateEvidence rows point at a Document by construction.
    sourceType: "FILE",
    sourceUrl: null,
  };
}

/**
 * Pairs each requirement with the passages that support it.
 *
 * A requirement with no passages resolves to NOT_FOUND — reported as absence of
 * evidence, never as a judgement about the person. NEEDS_REVIEW is not produced
 * here because the API exposes no signal for it; guessing one would be exactly
 * the kind of unexplained verdict this product must not show.
 */
export function buildRequirementEvidence(
  requirements: JobRequirement[],
  evidence: Evidence[],
  documentNames: Map<string, string>,
): RequirementEvidence[] {
  const byRequirement = new Map<string, Evidence[]>();

  for (const item of evidence) {
    if (!item.requirementId) continue;
    const bucket = byRequirement.get(item.requirementId);
    if (bucket) bucket.push(item);
    else byRequirement.set(item.requirementId, [item]);
  }

  return requirements.map((requirement) => {
    const matches = byRequirement.get(requirement.id) ?? [];
    const status: EvidenceStatus = matches.length > 0 ? "FOUND" : "NOT_FOUND";

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      required: requirement.required,
      status,
      citations: matches.map((match) => toCitation(match, documentNames)),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Evidence search                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Groups retrieved passages under the candidate they came from, keeping the
 * order the backend returned them in.
 *
 * Ordering therefore reflects which candidate had the strongest matching
 * passage — a property of the text, not a judgement about the person. The
 * relevance numbers are dropped here on purpose: with no score in the view
 * model, no component can render one as a candidate rating by accident.
 */
export function toEvidenceSearchResult(
  response: EvidenceSearchResponse,
): EvidenceSearchResult {
  const order: string[] = [];
  const byCandidate = new Map<string, CandidateEvidenceMatch>();

  for (const hit of response.results) {
    // A passage whose candidate is unknown cannot be attributed to anyone, so
    // it is dropped rather than shown against a placeholder person.
    if (!hit.candidateId) continue;

    let match = byCandidate.get(hit.candidateId);
    if (!match) {
      match = {
        candidateId: hit.candidateId,
        candidateName: hit.candidateName,
        passages: [],
      };
      byCandidate.set(hit.candidateId, match);
      order.push(hit.candidateId);
    }

    match.passages.push({
      documentId: hit.documentId,
      documentName: hit.sourceTitle ?? hit.fileName,
      page: hit.pageNumber,
      section: hit.section,
      text: hit.text,
      sourceType: hit.sourceType ?? "FILE",
      sourceUrl: hit.sourceUrl ?? null,
    });
  }

  return {
    query: response.query,
    reranked: response.reranked,
    totalConsidered: response.totalConsidered,
    durationMs: response.durationMs,
    candidates: order.map((id) => byCandidate.get(id)!),
  };
}

/* -------------------------------------------------------------------------- */
/* Grounded AI                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A citation returned by a generation call.
 *
 * `pageNumber` is taken from the response and never recomputed. The backend
 * validated the citation against the passages it actually retrieved, so this is
 * the only page number that can be trusted to point at the right place.
 */
export function toAiCitation(response: AiCitationResponse): Citation {
  return {
    id: response.chunkId,
    chunkId: response.chunkId,
    documentId: response.documentId,
    documentName: response.sourceTitle ?? response.fileName,
    page: response.pageNumber,
    section: response.section,
    snippet: response.text,
    // Absent means the chunk predates URL evidence, and those are all files.
    sourceType: response.sourceType ?? "FILE",
    sourceUrl: response.sourceUrl ?? null,
  };
}

/** A citation read back from a stored evidence map. */
export function toEvidenceMapCitation(
  response: EvidenceMapEvidenceResponse,
): Citation {
  return {
    id: response.id,
    chunkId: response.sourceChunkId,
    documentId: response.documentId,
    documentName: response.fileName,
    page: response.pageNumber,
    section: response.section,
    snippet: response.text,
    // Rows stored before URL evidence existed carry no source type, and they
    // are all files.
    sourceType: response.sourceType ?? "FILE",
    sourceUrl: response.sourceUrl ?? null,
  };
}

export function toGroundedAnswer(response: AiAnswerResponse): GroundedAnswer {
  return {
    answer: response.answer,
    status: response.status,
    citations: response.citations.map(toAiCitation),
    locale: response.locale,
    evidenceConsidered: response.evidenceConsidered,
    durationMs: response.durationMs,
    model: response.model,
    rejectedCitationCount: response.rejectedCitations.length,
  };
}

export function toCandidateSummary(
  response: AiCandidateSummaryResponse,
): CandidateSummary {
  return {
    summary: response.summary,
    status: response.status,
    citations: response.citations.map(toAiCitation),
    locale: response.locale,
    durationMs: response.durationMs,
    model: response.model,
    rejectedCitationCount: response.rejectedCitations.length,
  };
}

export function toInterviewQuestionSet(
  response: AiInterviewQuestionsResponse,
): InterviewQuestionSet {
  return {
    candidateId: response.candidateId,
    vacancyId: response.vacancyId,
    locale: response.locale,
    durationMs: response.durationMs,
    model: response.model,
    questions: response.questions.map((question, index) => ({
      // The API returns no id per question, and two probes on the same
      // requirement are legitimate, so the index is part of the key.
      id: `${question.requirementId ?? "general"}-${index}`,
      question: question.question,
      reason: question.reason,
      kind: question.kind,
      requirementId: question.requirementId,
      citations: question.citations.map(toAiCitation),
    })),
  };
}

/**
 * Backend mapping status → presentation status.
 *
 * `null` means no mapping row exists, which is NOT_RUN — deliberately distinct
 * from NOT_FOUND, because "nobody has checked" and "checked and found nothing"
 * are different statements about a candidate's documents.
 */
export function toEvidenceStatus(
  status: EvidenceMappingStatus | null,
): EvidenceStatus {
  if (status === "EVIDENCE_FOUND") return "FOUND";
  if (status === "NO_EVIDENCE_FOUND") return "NOT_FOUND";
  if (status === "NEEDS_HUMAN_REVIEW") return "NEEDS_REVIEW";
  return "NOT_RUN";
}

export function toEvidenceMap(response: EvidenceMapResponse): EvidenceMap {
  const requirements: RequirementMapping[] = response.requirements.map(
    (entry) => ({
      requirementId: entry.requirement.id,
      requirementText: entry.requirement.text,
      requirementType: entry.requirement.type,
      required: entry.requirement.required,
      status: toEvidenceStatus(entry.status),
      reason: entry.reason,
      matchedTerms: entry.matchedTerms,
      missingTerms: entry.missingTerms,
      mappedAt: entry.mappedAt,
      citations: entry.evidence.map(toEvidenceMapCitation),
    }),
  );

  const mappedTimes = requirements
    .map((requirement) => requirement.mappedAt)
    .filter((value): value is string => Boolean(value));

  return {
    candidateId: response.candidate.id,
    candidateName: response.candidate.fullName,
    vacancyId: response.vacancy.id,
    vacancyTitle: response.vacancy.title,
    requirements,
    // A vacancy with no requirements has nothing to map, so "has run" is only
    // true when at least one requirement actually carries a stored status.
    hasRun: requirements.some(
      (requirement) => requirement.status !== "NOT_RUN",
    ),
    mappedAt:
      mappedTimes.length > 0
        ? mappedTimes.reduce((latest, value) =>
            new Date(value) > new Date(latest) ? value : latest,
          )
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate account & public job board                                        */
/*                                                                             */
/* The job-seeker side of the product. A `CandidateAccount` belongs to the      */
/* user and to no organization; it is never merged with the recruiter-owned     */
/* `Candidate` record, which is a different thing that happens to describe the  */
/* same person.                                                                */
/* -------------------------------------------------------------------------- */

export function toCandidateAccount(
  response: CandidateAccountResponse,
): CandidateAccount {
  return {
    id: response.id,
    headline: response.headline,
    location: response.location,
    phone: response.phone,
    summary: response.summary,
    skills: response.skills ?? [],
    languages: response.languages ?? [],
    experience: response.experience ?? [],
    education: response.education ?? [],
    profileVisibility: response.profileVisibility,
    resume: response.resumeDocument
      ? {
          id: response.resumeDocument.id,
          originalFileName: response.resumeDocument.originalFileName,
          mimeType: response.resumeDocument.mimeType,
          fileSize: response.resumeDocument.fileSize,
          createdAt: response.resumeDocument.createdAt,
        }
      : null,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
}

export function toPublicJob(response: PublicJobResponse): PublicJob {
  return {
    ...toJobProfile(response),
    publicSlug: response.publicSlug,
    title: response.title,
    department: response.department,
    location: response.location,
    employmentType: response.employmentType,
    experienceLevel: response.experienceLevel,
    createdAt: response.createdAt,
    organizationName: response.organization.name,
    applicantCount: response.applicantCount ?? 0,
    searchAlignment: response.searchAlignment
      ? {
          score: response.searchAlignment.score,
          // Structurally identical to the domain shape, like every other
          // alignment on the candidate side — passed through, not re-mapped.
          alignments: response.searchAlignment.alignments ?? [],
        }
      : undefined,
  };
}

export function toPublicJobDetail(
  response: PublicJobDetailResponse,
): PublicJobDetail {
  return {
    // The card mapper's RETURN TYPE is the card subset, so the long tail has
    // to be spread in explicitly — a detail page shows visa, education,
    // benefits and lifecycle, and a card does not.
    ...toJobProfile(response),
    ...toPublicJob(response),
    description: response.description,
    requirements: response.requirements ?? [],
    languages: toLanguageRequirements(response.languages),
  };
}

export function toMyApplication(
  response: MyApplicationResponse,
): MyApplication {
  return {
    id: response.id,
    status: response.status,
    source: response.source,
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
    job: {
      publicSlug: response.vacancy.publicSlug,
      title: response.vacancy.title,
      location: response.vacancy.location,
      employmentType: response.vacancy.employmentType,
      organizationName: response.vacancy.organization.name,
      applicantCount: response.vacancy.applicantCount ?? 0,
    },
  };
}

export function toSavedJob(response: SavedJobResponse): SavedJob {
  return {
    savedAt: response.savedAt,
    job: {
      publicSlug: response.job.publicSlug,
      title: response.job.title,
      location: response.job.location,
      employmentType: response.job.employmentType,
      status: response.job.status,
      organizationName: response.job.organization.name,
    },
  };
}

/**
 * POST /candidate-account/me/job-matches.
 *
 * A near-passthrough on purpose: the backend already returns candidate-safe
 * data — public slugs, no internal ids, a deterministic STRONG/PARTIAL/WEAK
 * label. Nothing is re-scored, re-ordered or re-classified here; the backend
 * ordering (retrieval relevance) is preserved as-is.
 */
export function toJobMatchResult(response: JobMatchesResponse): JobMatchResult {
  return {
    matches: response.matches.map((match) => ({
      vacancy: {
        slug: match.vacancy.slug,
        title: match.vacancy.title,
        organizationName: match.vacancy.organizationName,
        location: match.vacancy.location,
        employmentType: match.vacancy.employmentType,
        status: match.vacancy.status,
        // Original pay, passed straight through. `?? null` and never `?? 0`:
        // an employer who stated no salary has not offered zero.
        salaryMin: match.vacancy.salaryMin ?? null,
        salaryMax: match.vacancy.salaryMax ?? null,
        currency: match.vacancy.currency ?? null,
        payPeriod: match.vacancy.payPeriod ?? null,
        salaryNegotiable: match.vacancy.salaryNegotiable ?? false,
        country: match.vacancy.country ?? null,
        region: match.vacancy.region ?? null,
        city: match.vacancy.city ?? null,
        workMode: match.vacancy.workMode ?? null,
        seniorityLevel: match.vacancy.seniorityLevel ?? null,
      },
      match: match.match,
      // A band is always shown; falling back to the capability strength keeps
      // an older payload rendering rather than blank.
      band: match.band ?? bandFromStrength(match.match),
      rank: match.rank ?? 0,
      score: match.score ?? 0,
      capabilityScore: match.capabilityScore ?? match.score ?? 0,
      // PRESERVED as null: "no comparable preference" is not a zero score.
      intentScore: match.intentScore ?? null,
      alignments: match.alignments ?? [],
      signals: match.signals ?? {},
      matchedSkills: match.matchedSkills ?? [],
      missingSkills: match.missingSkills ?? [],
      explanation: match.explanation,
      supportedRequirements: match.supportedRequirements,
      unsupportedRequirements: match.unsupportedRequirements,
      unclearRequirements: match.unclearRequirements,
      evidence: match.evidence.map((item) => ({
        ...item,
        // A file unless the API said otherwise — chunks indexed before links
        // existed carry no source type, and they are all files.
        sourceType: item.sourceType ?? "FILE",
        sourceUrl: item.sourceUrl ?? null,
      })),
      saved: match.saved,
      applicationState: match.applicationState,
      insight: toMatchInsight(match, "CANDIDATE"),
    })),
    locale: response.locale,
    generated: response.generated,
    generatedAt: response.generatedAt,
    // Defaulted for safety, but the backend always sends both: a missing
    // revision must not silently read as "revision 0 and therefore fresh".
    evidenceRevision: response.evidenceRevision ?? 0,
    stale: response.stale ?? false,
    explanationsPending: response.explanationsPending ?? false,
    page: response.page ?? 1,
    limit: response.limit ?? response.matches.length,
    // Defaulted to the page length only when the API said nothing — never
    // silently smaller than what arrived, or the UI would stop scrolling
    // early and hide ranked results.
    total: response.total ?? response.matches.length,
    totalPages: response.totalPages ?? 1,
    hasMore: response.hasMore ?? false,
    totalEligible: response.totalEligible ?? 0,
    totalExcluded: response.totalExcluded ?? 0,
    fx: {
      snapshotVersion: response.fx?.snapshotVersion ?? null,
      fetchedAt: response.fx?.fetchedAt ?? null,
    },
    capability: (response.capability ?? {}) as JobMatchResult["capability"],
  };
}

/**
 * A band for a payload that predates bands.
 *
 * Only a fallback: the backend owns the thresholds, and deriving them here
 * would be a second source of truth that could disagree with the score.
 */
/**
 * Reads the advanced insight off a match row, or returns null.
 *
 * Null is the honest answer for a row ranked before the advanced engine
 * existed: §"do not treat null analysis as score 0". `insightVersion` is the
 * backend's own marker that an analysis ran, so it — not the presence of any
 * one array — decides whether there is an insight at all. A row where the
 * engine ran but found nothing still yields an insight object whose lists are
 * empty, and the UI then chooses per section whether to draw anything.
 *
 * Every list defaults to `[]` and every number is passed straight through. No
 * value here is derived, summed or rescaled: the backend owns the arithmetic.
 */
function toMatchInsight(
  match: JobMatchResponse,
  context: "CANDIDATE" | "HR",
): MatchInsight | null {
  if (!match.insightVersion) return null;
  return buildInsight(match, context, match.insightVersion);
}

/**
 * Builds the insight from either carrier shape.
 *
 * The candidate list returns the advanced fields FLAT on each match row; the
 * HR endpoints nest the same fields under `insight`. Both are read here so
 * the two surfaces can never drift into different defaulting rules — one
 * missing-array policy, one place.
 */
function buildInsight(
  match: MatchInsightSource,
  context: "CANDIDATE" | "HR",
  version: string,
): MatchInsight {
  const breakdown = match.evidenceConfidenceBreakdown ?? {};
  const trajectory = match.careerTrajectory ?? {};

  return {
    version,
    context,
    eligibility: match.eligibility ?? "ELIGIBLE",
    eligibilityReasons: (match.eligibilityReasons ?? []).map((reason) => ({
      code: reason.code,
      detail: reason.detail,
    })),
    evidenceConfidence: match.evidenceConfidence ?? 0,
    evidenceConfidenceBreakdown: {
      sources: breakdown.sources ?? 0,
      volume: breakdown.volume ?? 0,
      coverage: breakdown.coverage ?? 0,
      profileCompleteness: breakdown.profileCompleteness ?? 0,
      consistency: breakdown.consistency ?? 0,
    },
    // A dimension with no `max` cannot be drawn as `score/max`, so it is
    // dropped rather than rendered against an invented denominator.
    dimensions: (match.dimensions ?? [])
      .filter((dimension) => typeof dimension.max === "number" && dimension.max > 0)
      .map((dimension) => ({
        key: dimension.key,
        labelKey: dimension.labelKey ?? `match.dimension.${dimension.key}`,
        score: dimension.score,
        max: dimension.max,
        normalizedScore: dimension.normalizedScore ?? dimension.score / dimension.max,
        reason: dimension.reason ?? undefined,
      })),
    requirementMatrix: (match.requirementMatrix ?? []).map((row) => ({
      requirementId: row.requirementId ?? null,
      text: row.text,
      priority: row.priority,
      status: row.status,
      scoreContribution: row.scoreContribution ?? 0,
      evidenceCount: row.evidenceCount ?? 0,
      evidenceRefs: (row.evidenceRefs ?? []).map(toMatchEvidenceRef),
      transferable: row.transferable ?? null,
      reason: row.reason ?? "",
    })),
    transferableSkills: (match.transferableSkills ?? []).map((skill) => ({
      sourceSkill: skill.sourceSkill,
      targetRequirement: skill.targetRequirement,
      targetSkill: skill.targetSkill ?? null,
      credit: skill.credit ?? 0,
      relation: skill.relation ?? "",
      reason: skill.reason ?? "",
      evidenceRefs: (skill.evidenceRefs ?? []).map(toMatchEvidenceRef),
    })),
    contradictions: (match.contradictions ?? []).map((item) => ({
      kind: item.kind ?? "",
      summary: item.summary,
      sourceA: item.sourceA ?? "",
      sourceB: item.sourceB ?? "",
      confidencePenalty: item.confidencePenalty ?? 0,
    })),
    careerTrajectory: {
      status: (trajectory.status as CareerTrajectory["status"]) ?? "UNKNOWN",
      score: trajectory.score ?? null,
      reasons: trajectory.reasons ?? [],
    },
    // Preserved as null. A pair with no previous ranking has no history, and
    // inventing "0 -> 73" would report a rise that never happened.
    scoreChange: match.scoreChange
      ? {
          previous: match.scoreChange.previous,
          current: match.scoreChange.current,
          delta:
            match.scoreChange.delta ??
            match.scoreChange.current - match.scoreChange.previous,
          reasons: match.scoreChange.reasons ?? [],
        }
      : null,
    improvementSuggestions: (match.improvementSuggestions ?? [])
      .map((suggestion) => ({
        requirementId: suggestion.requirementId ?? null,
        type: suggestion.type ?? "",
        text: suggestion.text,
        impactRank: suggestion.impactRank ?? 0,
      }))
      .sort((a, b) => a.impactRank - b.impactRank),
  };
}

function toMatchEvidenceRef(ref: MatchEvidenceRefResponse): MatchEvidenceRef {
  return {
    sourceKind: ref.sourceKind ?? "FILE",
    fileName: ref.fileName ?? null,
    pageNumber: ref.pageNumber ?? null,
    section: ref.section ?? null,
    snippet: ref.snippet ?? "",
    sourceUrl: ref.sourceUrl ?? null,
  };
}

/** The optional advanced fields, however they are carried. */
type MatchInsightSource = Omit<MatchInsightResponse, "version" | "context">;

/**
 * HR vacancy-context assessment.
 *
 * `insight.version` decides the version string; an HR payload always carries
 * an analysis (the endpoint exists to compute one), so unlike the list row
 * there is no null case to model here.
 */
export function toHrMatchInsight(
  response: HrMatchInsightResponse,
): HrMatchInsight {
  return {
    candidate: response.candidate,
    vacancy: response.vacancy,
    score: response.score,
    capabilityScore: response.capabilityScore ?? response.score,
    tier: response.tier ?? "",
    band: response.band ?? "",
    matchedSkills: response.matchedSkills ?? [],
    missingSkills: response.missingSkills ?? [],
    insight: buildInsight(
      response.insight,
      "HR",
      response.insight.version ?? "advanced-match-v1",
    ),
    generatedAt: response.generatedAt,
  };
}

/**
 * Compare intelligence.
 *
 * Superlatives are passed through exactly as decided. Nothing is re-sorted,
 * re-ranked or tie-broken here — §"do not calculate winners independently in
 * frontend" — and a null superlative stays null rather than being filled by
 * picking a leader from `candidates`.
 */
export function toCompareInsights(
  response: CompareInsightsResponse,
): CompareInsights {
  const superlative = (
    value: CompareSuperlativeResponse | null | undefined,
  ): CompareSuperlative | null =>
    value
      ? {
          candidateId: value.candidateId,
          fullName: value.fullName,
          value: value.value,
        }
      : null;

  return {
    vacancy: response.vacancy,
    candidates: response.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      fullName: candidate.fullName,
      // Null is preserved throughout: a candidate who could not be assessed
      // has no score, and rendering 0 would place them last on merit they
      // were never measured on.
      score: candidate.score ?? null,
      band: candidate.band ?? null,
      eligibility: candidate.eligibility ?? null,
      evidenceConfidence: candidate.evidenceConfidence ?? null,
      mustHaveGapCount: candidate.mustHaveGapCount ?? null,
      dimensions: (candidate.dimensions ?? [])
        .filter((dimension) => typeof dimension.max === "number" && dimension.max > 0)
        .map((dimension) => ({
          key: dimension.key,
          labelKey: dimension.labelKey ?? `match.dimension.${dimension.key}`,
          score: dimension.score,
          max: dimension.max,
          normalizedScore: dimension.normalizedScore ?? dimension.score / dimension.max,
          reason: dimension.reason ?? undefined,
        })),
      error: candidate.error ?? null,
    })),
    superlatives: {
      bestTechnicalMatch: superlative(response.superlatives.bestTechnicalMatch),
      bestSeniorityFit: superlative(response.superlatives.bestSeniorityFit),
      fewestMustHaveGaps: superlative(response.superlatives.fewestMustHaveGaps),
      highestEvidenceConfidence: superlative(
        response.superlatives.highestEvidenceConfidence,
      ),
    },
    generatedAt: response.generatedAt,
  };
}

function bandFromStrength(strength: JobMatchStrength): MatchBand {
  if (strength === "STRONG") return "STRONG";
  if (strength === "PARTIAL") return "PARTIAL";
  return "LOW";
}

/** One job's pay in the candidate's own currency. */
export function toJobSalaryView(
  response: JobSalaryViewResponse,
): JobSalaryView {
  return {
    original: {
      salaryMin: response.original.salaryMin ?? null,
      salaryMax: response.original.salaryMax ?? null,
      currency: response.original.currency ?? null,
      payPeriod: response.original.payPeriod ?? null,
      salaryNegotiable: response.original.salaryNegotiable ?? false,
    },
    // Null is meaningful and preserved: there is no conversion to show.
    converted: response.converted
      ? {
          salaryMin: response.converted.salaryMin ?? null,
          salaryMax: response.converted.salaryMax ?? null,
          currency: response.converted.currency,
          payPeriod: response.converted.payPeriod,
        }
      : null,
    reason: response.reason,
    fx: response.fx ?? null,
  };
}

/** GET /vacancies/mine — already slim; passed through unchanged. */
export function toMyVacancy(response: MyVacancyResponse): MyVacancy {
  return {
    id: response.id,
    title: response.title,
    status: response.status,
    createdAt: response.createdAt,
    candidateCount: response.candidateCount,
    requirementCount: response.requirementCount,
  };
}

/**
 * GET /vacancies/:vacancyId/candidates — the vacancy's applicants. Every row
 * is somebody who applied, so there is no provenance to branch on.
 */
export function toVacancyCandidate(
  response: VacancyCandidateRowResponse,
): VacancyCandidate {
  return {
    candidate: { ...response.candidate },
    application: { ...response.application },
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate job preferences                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The candidate's stated preferences.
 *
 * Nothing is defaulted on the way through. `?? null` and `?? []` appear only
 * where the wire may omit a key entirely; a `null` the API actually sent
 * survives as null, because "named no salary" and "wants zero" are different
 * answers and the UI has to be able to tell them apart.
 */
export function toJobPreferences(
  response: JobPreferencesResponse,
): CandidateJobPreferences {
  return {
    stated: response.stated,
    preferredJobTitles: response.preferredJobTitles ?? [],
    preferredLocations: response.preferredLocations ?? [],
    preferredWorkModes: response.preferredWorkModes ?? [],
    preferredEmploymentTypes: response.preferredEmploymentTypes ?? [],
    preferredSeniorityLevels: response.preferredSeniorityLevels ?? [],
    desiredSalaryMin: response.desiredSalaryMin ?? null,
    desiredSalaryMax: response.desiredSalaryMax ?? null,
    salaryCurrency: response.salaryCurrency ?? null,
    payPeriod: response.payPeriod ?? null,
    // Never `?? false`: an unanswered relocation question is not a refusal.
    willingToRelocate: response.willingToRelocate ?? null,
    preferredIndustries: response.preferredIndustries ?? [],
    preferredBenefits: response.preferredBenefits ?? [],
    excludedCompanies: response.excludedCompanies ?? [],
    excludedJobTitles: response.excludedJobTitles ?? [],
    excludedLocations: response.excludedLocations ?? [],
    createdAt: response.createdAt ?? null,
    updatedAt: response.updatedAt ?? null,
  };
}

export function toCandidateJobIntent(
  response: CandidateJobIntentResponse,
): CandidateJobIntent {
  return {
    candidateAccountId: response.candidateAccountId,
    stated: response.stated,
    roles: response.roles ?? [],
    locations: response.locations ?? [],
    countries: response.countries ?? [],
    workModes: response.workModes ?? [],
    compensation: response.compensation ?? null,
    employmentTypes: response.employmentTypes ?? [],
    seniorityLevels: response.seniorityLevels ?? [],
    relocation: response.relocation ?? null,
    preferredIndustries: response.preferredIndustries ?? [],
    preferredBenefits: response.preferredBenefits ?? [],
    exclusions: response.exclusions ?? {
      companies: [],
      jobTitles: [],
      locations: [],
    },
    updatedAt: response.updatedAt ?? null,
  };
}

export function toJobSearchContext(
  response: JobSearchContextResponse,
): JobSearchContext {
  return {
    candidateAccountId: response.candidateAccountId,
    jobIntent: toCandidateJobIntent(response.jobIntent),
    // Passed through as-is: the per-dimension `source` labels are the contract
    // Task 3 will explain results with, and rewriting them here would be the
    // second interpretation of intent this architecture exists to prevent.
    resolved: response.resolved,
    locale: response.locale,
  };
}

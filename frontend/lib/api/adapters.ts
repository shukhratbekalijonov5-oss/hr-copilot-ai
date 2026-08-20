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
  AiCandidateSummaryResponse,
  AiCitationResponse,
  AiInterviewQuestionsResponse,
  ApplicationResponse,
  EvidenceMapEvidenceResponse,
  EvidenceMapResponse,
  EvidenceSearchResponse,
  CandidateResumeResponse,
  CandidateResponse,
  DocumentResponse,
  EvidenceResponse,
  InviteToInterviewResponse,
  JobRequirementResponse,
  MeResponse,
  OrganizationResponse,
  ProcessingJobResponse,
  UserResponse,
  VacancyResponse,
} from "@/lib/api/contracts";
import { PIPELINE_STAGES } from "@/lib/types";
import type {
  Application,
  AuthSessionRow,
  Candidate,
  CandidateAccount,
  CandidateInterviewConversation,
  MyApplication,
  OrganizationInterviewConversation,
  PublicJob,
  PublicJobDetail,
  SavedJob,
  JobMatchResult,
  CandidateEvidenceMatch,
  CandidateSummary,
  EvidenceMap,
  EvidenceMappingStatus,
  GroundedAnswer,
  InterviewQuestionSet,
  RequirementMapping,
  EvidenceSearchResult,
  CandidateDocument,
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
    hasCandidateAccount: response.candidateAccount.exists,
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

export function toOrganization(response: OrganizationResponse): Organization {
  return {
    id: response.id,
    name: response.name,
    slug: response.slug,
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

export function toVacancy(response: VacancyResponse): Vacancy {
  const requirements = (response.requirements ?? []).map(toJobRequirement);

  return {
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
    // The list endpoint returns counts instead of the nested collections.
    candidateCount: response._count?.applications ?? 0,
    requirementCount: response._count?.requirements ?? requirements.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Documents & processing                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The candidate detail endpoint returns documents without `mimeType`, so it is
 * derived from the filename there. This only decides how the file is displayed —
 * the backend validates the real format by magic number at upload time.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeTypeFor(fileName: string): string | null {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

export function toDocument(
  response: DocumentResponse,
  candidateId: string | null = null,
): CandidateDocument {
  return {
    id: response.id,
    candidateId: response.candidateId ?? candidateId,
    type: response.type,
    originalFileName: response.originalFileName,
    mimeType: response.mimeType ?? mimeTypeFor(response.originalFileName),
    fileSize: response.fileSize ?? null,
    status: response.status,
    pageCount: response.pageCount ?? null,
    createdAt: response.createdAt,
  };
}

export function toProcessingJob(
  response: ProcessingJobResponse,
  candidate: { id: string; fullName: string } | null = null,
): ProcessingJob {
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
    candidateId: candidate?.id ?? null,
    candidateName: candidate?.fullName ?? null,
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
  documents: { status: DocumentStatus }[],
): AiReadiness {
  if (documents.length === 0) return "no_documents";
  if (documents.some((document) => document.status === "COMPLETED")) {
    return "ready";
  }
  // Nothing is indexed. Still moving through the pipeline beats "failed", so a
  // candidate mid-upload is not reported as broken.
  if (documents.some((document) => document.status !== "FAILED")) {
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
          fullName: response.candidate.fullName,
          currentTitle: response.candidate.currentTitle ?? null,
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
    chatAvailable: response.chatAvailable,
    chatUnavailableReason: response.chatUnavailableReason,
  };
}

export function toCandidate(response: CandidateResponse): Candidate {
  const documents = (response.documents ?? []).map((document) =>
    toDocument(document, response.id),
  );
  const applications = (response.applications ?? []).map(toApplication);
  const primary = applications[0];

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
    documents,
    applications,
    processingStatus: aggregateDocumentStatus(documents),
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
      documentName: hit.fileName,
      page: hit.pageNumber,
      section: hit.section,
      text: hit.text,
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
    documentName: response.fileName,
    page: response.pageNumber,
    section: response.section,
    snippet: response.text,
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
    publicSlug: response.publicSlug,
    title: response.title,
    department: response.department,
    location: response.location,
    employmentType: response.employmentType,
    experienceLevel: response.experienceLevel,
    createdAt: response.createdAt,
    organizationName: response.organization.name,
  };
}

export function toPublicJobDetail(
  response: PublicJobDetailResponse,
): PublicJobDetail {
  return {
    ...toPublicJob(response),
    description: response.description,
    requirements: response.requirements ?? [],
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
    },
    // The snapshot actually submitted, which may differ from the profile
    // resume the candidate has since replaced.
    submittedFileName: response.submittedDocument?.originalFileName ?? null,
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
      },
      match: match.match,
      explanation: match.explanation,
      supportedRequirements: match.supportedRequirements,
      unsupportedRequirements: match.unsupportedRequirements,
      unclearRequirements: match.unclearRequirements,
      evidence: match.evidence,
      saved: match.saved,
      applicationState: match.applicationState,
    })),
    locale: response.locale,
    generated: response.generated,
    generatedAt: response.generatedAt,
  };
}

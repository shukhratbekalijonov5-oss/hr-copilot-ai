"""Request/response schemas — the wire contract with the NestJS backend.

Naming follows the backend's camelCase so payloads map straight onto the
TypeScript interfaces in ``backend/src/ai/ai-service.client.ts``.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# --- Document processing ---------------------------------------------------


class ProcessDocumentRequest(CamelModel):
    """Metadata accompanying the uploaded file on a multipart request.

    ``organizationId`` is authoritative: it comes from the backend, which
    derived it from the authenticated user's JWT. The AI service never accepts
    a tenant identity from an end user.
    """

    documentId: str = Field(min_length=1, max_length=64)
    organizationId: str = Field(min_length=1, max_length=64)
    candidateId: str | None = Field(default=None, max_length=64)
    fileName: str = Field(min_length=1, max_length=255)
    documentType: str = Field(default="RESUME", max_length=40)


class StageResult(CamelModel):
    """What one pipeline stage actually did. Reported, never assumed."""

    stage: Literal["parsing", "chunking", "embedding", "indexing"]
    durationMs: int
    detail: str


class ProcessDocumentResponse(CamelModel):
    documentId: str
    pageCount: int
    chunksCreated: int
    vectorsIndexed: int
    sectionsDetected: list[str]
    embeddingModel: str
    embeddingDimension: int
    durationMs: int
    stages: list[StageResult]


# --- Web (URL) evidence sources ---------------------------------------------
#
# The mirror image of ProcessDocumentRequest, with one deliberate difference:
# there is no file and no URL to fetch. The BACKEND performs every outbound
# request (SSRF policy, redirect revalidation, size and time caps, robots,
# optional headless rendering) and sends already-normalized text. This service
# never opens a socket to a candidate-supplied destination, and the shape of
# this contract is what makes that structurally true rather than a convention.


class WebSectionInput(CamelModel):
    """One normalized section of a fetched page."""

    name: str | None = Field(default=None, max_length=80)
    heading: str | None = Field(default=None, max_length=300)
    text: str = Field(min_length=1, max_length=20_000)
    """The exact page this text came from — may be a subpage of the link."""
    url: str | None = Field(default=None, max_length=2048)



class IndexCandidateWebSourceRequest(CamelModel):
    """CANDIDATE-scoped: one personal professional link.

    Carries a candidateAccountId and NO organizationId — a personal link chunk
    cannot satisfy a tenant filter because the key does not exist on it.
    """

    candidateAccountId: str = Field(min_length=1, max_length=64)
    sourceId: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2048)
    detectedType: str | None = Field(default=None, max_length=40)
    sections: list[WebSectionInput] = Field(min_length=1, max_length=200)


class IndexWebSourceResponse(CamelModel):
    sourceId: str
    chunksCreated: int
    vectorsIndexed: int
    durationMs: int



# --- Source authorization ----------------------------------------------------

#: The backend's list of source ids a request may retrieve — the files and link
#: snapshots that CURRENTLY exist for the candidate in question.
#:
#: This is the AI service's half of a rule the backend owns: when a candidate
#: deletes a file or a professional link, that evidence stops being usable
#: everywhere, IMMEDIATELY, whether or not its vectors have physically been
#: evicted yet. Eviction is a queued, retrying, best-effort operation; this
#: filter is not. It is derived from database rows the deletion already removed,
#: so a chunk left behind by a failed or delayed cleanup simply cannot be
#: returned.
#:
#: ``None`` means "no source restriction". That is correct only where the caller
#: has no candidate to scope by — the organization-wide AI Search answer, whose
#: results the backend filters against surviving sources on the way back —
#: and it is never a shortcut for "the backend did not bother".
AllowedSourceIds = list[str] | None

#: Bounded so a malformed or hostile request cannot turn one search into a
#: filter with tens of thousands of terms. A candidate has at most 3 files and
#: 3 links per application; a few hundred covers every real case with room to
#: spare.
MAX_ALLOWED_SOURCE_IDS = 500


# --- Search ----------------------------------------------------------------


class SearchRequest(CamelModel):
    """Search over CURRENT candidate evidence.

    ``candidateAccountIds`` is the AUTHORIZED retrieval universe, resolved by
    the backend from the caller's own vacancies' applicant relationships. An
    empty list means "nothing is retrievable" and returns zero hits — it is
    the authorization result, not a validation error.
    """

    candidateAccountIds: list[str] = Field(max_length=2000)
    query: str = Field(min_length=1, max_length=1000)
    documentId: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=10, ge=1, le=50)
    rerank: bool = True
    #: See AllowedSourceIds.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


SOURCE_TYPES = ("FILE", "URL")
# Which KIND of evidence a passage came from. The AI layer is source-agnostic
# after normalization, but provenance has to survive into the citation: a
# recruiter must be able to tell a resume page from a portfolio page.
EvidenceSourceType = Literal["FILE", "URL"]


class EvidenceHit(CamelModel):
    """One retrieved passage, with the provenance needed to cite it.

    ``chunkId`` is the stable identifier a generated citation must reference;
    grounding validation rejects any citation naming an id that was not in the
    retrieved context.

    ``documentId`` is the SOURCE key, whatever the source kind: a personal
    Document id for a file, a CandidateLink id for a link. One key space keeps
    deletion and per-source filtering a single code path.

    ``retrievalScore`` measures how well this passage matches the *query*.
    It is not a candidate score, a hiring score, or a probability of success,
    and must never be presented as one.
    """

    chunkId: str
    candidateAccountId: str | None
    documentId: str
    fileName: str | None
    section: str | None
    pageNumber: int | None
    chunkIndex: int
    text: str
    retrievalScore: float
    rerankScore: float | None = None
    # Defaulted, not required: chunks indexed before URL evidence existed carry
    # no source metadata and are files. Nothing needs a reindex.
    sourceType: EvidenceSourceType = "FILE"
    sourceTitle: str | None = None
    sourceUrl: str | None = None


class SearchResponse(CamelModel):
    query: str
    hits: list[EvidenceHit]
    totalCandidatesConsidered: int
    reranked: bool
    durationMs: int


# --- Generation (RAG) ------------------------------------------------------

SUPPORTED_LOCALES = ("en", "ko", "ru", "uz")
Locale = Literal["en", "ko", "ru", "uz"]

# Describes the quality of the ANSWER and its evidence. Never a statement about
# the candidate, and never a hiring decision label.
AnswerStatus = Literal["GROUNDED", "INSUFFICIENT_EVIDENCE", "NEEDS_HUMAN_REVIEW"]


class Citation(CamelModel):
    """A verified pointer back to the exact passage that supports a claim.

    Every field is copied from the retrieved chunk, never from model output,
    so a citation cannot carry a fabricated page number, file name or URL. That
    matters more for links than for files: a model that invented
    "portfolio.example.com/kubernetes-project" would be handing a recruiter a
    URL that looks checkable and is not.
    """

    chunkId: str
    documentId: str
    fileName: str | None = None
    pageNumber: int | None = None
    section: str | None = None
    text: str
    sourceType: EvidenceSourceType = "FILE"
    sourceTitle: str | None = None
    sourceUrl: str | None = None


class VacancyContextRequirement(CamelModel):
    text: str = Field(min_length=1, max_length=2000)
    required: bool = True


class VacancyContext(CamelModel):
    """The SELECTED vacancy's grounding context for generation.

    Candidate-visible fields only (title + requirement texts) — the backend
    never sends recruiter-private notes. Presence of this block is what makes
    a summary/answer vacancy-contextual instead of generic.
    """

    vacancyId: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    requirements: list[VacancyContextRequirement] = Field(
        default_factory=list, max_length=100
    )


class RagRequest(CamelModel):
    #: The authorized retrieval universe — see SearchRequest.
    candidateAccountIds: list[str] = Field(max_length=2000)
    query: str = Field(min_length=1, max_length=2000)
    vacancyId: str | None = Field(default=None, max_length=64)
    vacancy: VacancyContext | None = None
    locale: Locale = "en"
    limit: int = Field(default=8, ge=1, le=20)
    #: See AllowedSourceIds.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


class RagResponse(CamelModel):
    answer: str
    status: AnswerStatus
    citations: list[Citation]
    locale: Locale
    """Ids the model cited that were not in the retrieved context; always empty
    in a well-behaved response, surfaced for observability."""
    rejectedCitations: list[str] = []
    evidenceConsidered: int = 0
    durationMs: int = 0
    model: str | None = None


class CandidateSummaryRequest(CamelModel):
    candidateAccountId: str = Field(min_length=1, max_length=64)
    vacancy: VacancyContext | None = None
    locale: Locale = "en"
    limit: int = Field(default=12, ge=1, le=30)
    #: See AllowedSourceIds.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


class CandidateSummaryResponse(CamelModel):
    summary: str
    status: AnswerStatus
    citations: list[Citation]
    locale: Locale
    rejectedCitations: list[str] = []
    durationMs: int = 0
    model: str | None = None


# --- Requirement mapping ---------------------------------------------------

MappingStatus = Literal["EVIDENCE_FOUND", "NO_EVIDENCE_FOUND", "NEEDS_HUMAN_REVIEW"]


class RequirementInput(CamelModel):
    requirementId: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=2000)
    type: str | None = None
    required: bool = True


class EvidenceMapRequest(CamelModel):
    candidateAccountId: str = Field(min_length=1, max_length=64)
    vacancyId: str = Field(min_length=1, max_length=64)
    requirements: list[RequirementInput] = Field(min_length=1, max_length=100)
    locale: Locale = "en"
    #: See AllowedSourceIds.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


class RequirementMapping(CamelModel):
    requirementId: str
    requirementText: str
    status: MappingStatus
    evidence: list[Citation]
    """Requirement terms found verbatim in the evidence. Explains the status to
    a human; not a score."""
    matchedTerms: list[str] = []
    missingTerms: list[str] = []
    reason: str = ""


class EvidenceMapResponse(CamelModel):
    candidateAccountId: str
    vacancyId: str
    requirements: list[RequirementMapping]
    durationMs: int = 0


# --- Interview questions ---------------------------------------------------

QuestionKind = Literal["evidence_probe", "missing_requirement_probe"]


class InterviewQuestion(CamelModel):
    question: str
    """Why this question was generated — for the interviewer, not a judgement."""
    reason: str
    kind: QuestionKind
    requirementId: str | None = None
    citations: list[Citation] = []


class InterviewQuestionsRequest(CamelModel):
    candidateAccountId: str = Field(min_length=1, max_length=64)
    vacancyId: str = Field(min_length=1, max_length=64)
    requirements: list[RequirementInput] = Field(min_length=1, max_length=30)
    locale: Locale = "en"
    #: See AllowedSourceIds.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


class InterviewQuestionsResponse(CamelModel):
    candidateAccountId: str
    vacancyId: str
    questions: list[InterviewQuestion]
    locale: Locale
    durationMs: int = 0
    model: str | None = None


# --- Rerank ----------------------------------------------------------------


class RerankRequest(CamelModel):
    query: str = Field(min_length=1, max_length=1000)
    hits: list[EvidenceHit]
    limit: int = Field(default=10, ge=1, le=50)


class RerankResponse(CamelModel):
    query: str
    hits: list[EvidenceHit]
    durationMs: int


# --- Deletion (idempotency / document removal) -----------------------------


class CollectionInfo(CamelModel):
    """Reports what collections exist, for migration tooling."""

    activeCollection: str
    embeddingModel: str
    embeddingDimension: int
    collections: list[str]


class DeleteDocumentRequest(CamelModel):
    organizationId: str = Field(min_length=1, max_length=64)
    documentId: str = Field(min_length=1, max_length=64)


class DeleteDocumentResponse(CamelModel):
    documentId: str
    deleted: bool


# --- Health ----------------------------------------------------------------


class HealthCheck(CamelModel):
    status: Literal["up", "down"]
    error: str | None = None


class LivenessResponse(CamelModel):
    status: Literal["ok"]
    uptimeSeconds: int


class ReadinessResponse(CamelModel):
    status: Literal["ok", "error"]
    checks: dict[str, HealthCheck]


class ErrorResponse(CamelModel):
    code: str
    message: str


# --- Candidate Job Match (candidate-side, NOT org-scoped) --------------------
#
# These contracts carry a candidateAccountId, never an organizationId as the
# scoping key. The backend derives candidateAccountId from the authenticated
# user's own CandidateAccount; the AI service treats it as authoritative.


class ProcessCandidateResumeResponse(CamelModel):
    documentId: str
    pageCount: int
    chunksCreated: int
    vectorsIndexed: int
    durationMs: int


class DeleteCandidateResumeRequest(CamelModel):
    candidateAccountId: str = Field(min_length=1, max_length=64)
    documentId: str = Field(min_length=1, max_length=64)


class VacancyRequirementInput(CamelModel):
    text: str = Field(min_length=1, max_length=2000)
    required: bool = True


class VacancyIndexRequest(CamelModel):
    """Candidate-visible vacancy fields ONLY.

    The backend must never send recruiter-private notes or internal metadata;
    everything in this payload may be surfaced to job seekers.
    """

    vacancyId: str = Field(min_length=1, max_length=64)
    organizationId: str = Field(min_length=1, max_length=64)
    status: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=20000)
    location: str | None = Field(default=None, max_length=200)
    employmentType: str | None = Field(default=None, max_length=100)
    requirements: list[VacancyRequirementInput] = Field(default_factory=list)


class VacancyIndexResponse(CamelModel):
    vacancyId: str
    chunksIndexed: int
    durationMs: int


# --- External job catalogue (candidate-facing search) -----------------------


class ExternalJobInput(CamelModel):
    """One canonical external job, as PUBLIC facts only.

    There is deliberately no provider, no source count and no trust field:
    the semantic index must not be able to prefer a job for where it was
    found. Everything here is something an employer published.
    """

    externalJobId: str = Field(min_length=1, max_length=64)
    status: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=300)
    companyName: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=20000)
    countryCode: str | None = Field(default=None, max_length=2)
    region: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=200)
    workMode: str | None = Field(default=None, max_length=20)
    employmentType: str | None = Field(default=None, max_length=30)
    seniorityLevel: str | None = Field(default=None, max_length=30)


class ExternalJobIndexRequest(CamelModel):
    jobs: list[ExternalJobInput] = Field(default_factory=list, max_length=500)


class ExternalJobIndexResponse(CamelModel):
    indexed: int
    durationMs: int


class ExternalJobDeleteRequest(CamelModel):
    externalJobIds: list[str] = Field(default_factory=list, max_length=1000)


class ExternalJobDeleteResponse(CamelModel):
    deleted: int


class ExternalJobSearchRequest(CamelModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=100, ge=1, le=500)
    #: Optional pre-filter. An optimisation only — the backend revalidates
    #: every returned id against PostgreSQL, which is what actually decides
    #: whether a job may be shown.
    statuses: list[str] = Field(default_factory=list, max_length=10)


class ExternalJobSearchHit(CamelModel):
    externalJobId: str
    #: Raw cosine similarity. This service does not decide what is relevant
    #: enough to show; the backend applies its own floor and ceiling.
    similarity: float


class ExternalJobSearchResponse(CamelModel):
    hits: list[ExternalJobSearchHit]
    durationMs: int


class VacancyDeleteRequest(CamelModel):
    vacancyId: str = Field(min_length=1, max_length=64)


class VacancyDeleteResponse(CamelModel):
    vacancyId: str
    deleted: bool


class ProfileExperienceInput(CamelModel):
    title: str = Field(min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ProfileEducationInput(CamelModel):
    institution: str = Field(min_length=1, max_length=200)
    degree: str | None = Field(default=None, max_length=200)
    field: str | None = Field(default=None, max_length=200)


class CandidateProfileInput(CamelModel):
    """Canonical CandidateAccount profile fields used for grounding."""

    headline: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    location: str | None = Field(default=None, max_length=200)
    skills: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    experience: list[ProfileExperienceInput] = Field(default_factory=list)
    education: list[ProfileEducationInput] = Field(default_factory=list)


#: Hard ceiling on one ranking run. Far above any realistic open-vacancy count,
#: and present so a malformed request cannot ask for unbounded work. Exceeding
#: it is logged loudly rather than silently truncating (see job_match).
MAX_ELIGIBLE_VACANCIES = 5000


class JobMatchRequest(CamelModel):
    candidateAccountId: str = Field(min_length=1, max_length=64)
    profile: CandidateProfileInput = Field(default_factory=CandidateProfileInput)
    locale: Locale = "en"

    #: The vacancies this candidate is ELIGIBLE to see, decided by the backend
    #: from the database. Every one of them is scored and ranked.
    #:
    #: This replaced a top-K vector search as the universe. The index drifts —
    #: a cascade-deleted vacancy leaves its points behind — so it can accelerate
    #: retrieval but must never decide what exists. `None` falls back to the
    #: indexed OPEN set, which is for standalone/diagnostic use only.
    eligibleVacancyIds: list[str] | None = Field(
        default=None, max_length=MAX_ELIGIBLE_VACANCIES
    )

    #: Which slice of the RANKED list to write explanation prose for. Ranking
    #: covers everything; generation is the expensive part, so it is spent on
    #: the page the caller will actually show.
    #:
    #: Note these do NOT truncate the response. Every eligible vacancy comes
    #: back ranked either way — the application owns pagination, and the model
    #: never decides how many jobs exist.
    explainOffset: int = Field(default=0, ge=0)
    explainLimit: int = Field(default=20, ge=0, le=50)
    #: See AllowedSourceIds. The personal collection is keyed by account, which
    #: stops another account's evidence being read but not this account's own
    #: DELETED evidence; that is what this does.
    allowedSourceIds: list[str] | None = Field(
        default=None, max_length=MAX_ALLOWED_SOURCE_IDS
    )


MatchLabel = Literal["STRONG", "PARTIAL", "WEAK"]


class RequirementCheck(CamelModel):
    """One vacancy requirement, classified against the candidate's evidence."""

    text: str
    required: bool
    reason: str


class MatchEvidence(CamelModel):
    """Provenance of a supporting passage.

    Any of the candidate's own sources: a resume page, a profile field, or a
    professional link they added. A skill demonstrated only on a portfolio is
    as real as one listed on a CV, and the job seeker is told which it was.
    """

    fileName: str | None = None
    pageNumber: int | None = None
    section: str | None = None
    text: str
    sourceType: EvidenceSourceType = "FILE"
    sourceUrl: str | None = None


class RequirementInsightEvidence(CamelModel):
    """Provenance for ONE requirement's supporting passages.

    Unlike `MatchEvidence` (match-level), this keeps `documentId` so the
    caller can count DISTINCT sources — the anti-keyword-stuffing rule is
    "independent sources", and `documentId == "profile"` marks the pseudo-hit
    built from the profile form rather than an uploaded file or link.
    """

    documentId: str
    fileName: str | None = None
    pageNumber: int | None = None
    section: str | None = None
    text: str
    sourceType: EvidenceSourceType = "FILE"
    sourceUrl: str | None = None


class RequirementInsight(CamelModel):
    """One requirement's full classification, for the advanced match contract.

    A PARALLEL view of the same classification that fills the three
    supported/unsupported/unclear arrays — those arrays are a stored wire
    contract that is also SENT BACK on the explanation path (where extra
    fields would be rejected), so they must not grow. This model carries the
    per-requirement depth the backend's requirement matrix needs: matched and
    missing terms, distinct evidence sources, and the exact passages.

    Statuses are the three mapping statuses (EVIDENCE_FOUND /
    NEEDS_HUMAN_REVIEW / NO_EVIDENCE_FOUND). "No evidence found" is a
    statement about the CURRENT documents, never about the person.
    """

    text: str
    required: bool
    status: MappingStatus
    reason: str
    matchedTerms: list[str] = Field(default_factory=list)
    missingTerms: list[str] = Field(default_factory=list)
    #: Distinct non-profile sources (files/links) among the supporting
    #: passages. Twenty repetitions inside one skills list stay ONE source.
    distinctEvidenceSources: int = Field(default=0, ge=0)
    evidence: list[RequirementInsightEvidence] = Field(default_factory=list)


class JobMatch(CamelModel):
    vacancyId: str
    organizationId: str
    title: str
    #: The categorical label, DERIVED from `score` so the two cannot disagree.
    match: MatchLabel
    #: 0-100, and its only job is to ORDER the list. Not a probability of being
    #: hired, not a percentage of the role the person can do, and it must never
    #: be presented as either.
    score: int = Field(default=0, ge=0, le=100)
    #: 1-based position in the full ranked list. Stable for one ranking run,
    #: which is what lets the caller paginate without results shuffling.
    rank: int = Field(default=0, ge=0)
    #: Per-signal breakdown (semantic / required / preferred / skills /
    #: roleFamily), each 0-1. Surfaced for diagnostics and for explaining WHY a
    #: job ranked where it did.
    signals: dict[str, float] = Field(default_factory=dict)
    #: Technologies the posting names that the candidate has evidence for.
    matchedSkills: list[str] = Field(default_factory=list)
    #: Technologies the posting names that the evidence does not show.
    missingSkills: list[str] = Field(default_factory=list)
    explanation: str | None = None
    supportedRequirements: list[RequirementCheck]
    unsupportedRequirements: list[RequirementCheck]
    unclearRequirements: list[RequirementCheck]
    evidence: list[MatchEvidence]
    #: Per-requirement depth for the advanced match contract. Additive: absent
    #: on older responses, and never sent back to this service.
    requirementInsights: list[RequirementInsight] = Field(default_factory=list)


class MatchExplanationItem(CamelModel):
    """The already-computed facts about ONE match, for prose generation.

    Deliberately the facts and not the documents: explaining a match needs the
    label, the requirement outcomes and the skill overlap, all of which the
    ranking already produced. Re-sending resumes would make this the expensive
    stage it was designed to avoid.
    """

    vacancyId: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=300)
    match: MatchLabel = "PARTIAL"
    matchedSkills: list[str] = Field(default_factory=list, max_length=60)
    missingSkills: list[str] = Field(default_factory=list, max_length=60)
    supportedRequirements: list[RequirementCheck] = Field(
        default_factory=list, max_length=40
    )
    unsupportedRequirements: list[RequirementCheck] = Field(
        default_factory=list, max_length=40
    )
    unclearRequirements: list[RequirementCheck] = Field(
        default_factory=list, max_length=40
    )


class MatchExplanationsRequest(CamelModel):
    """Prose for ONE PAGE of an existing ranking.

    Exists so paging to results 21-40 does not re-rank the whole catalogue just
    to write four sentences. The ranking is already stored by the backend; this
    only adds words to it, and cannot change the order or the count.
    """

    items: list[MatchExplanationItem] = Field(min_length=1, max_length=50)
    locale: Locale = "en"


class MatchExplanationsResponse(CamelModel):
    #: vacancyId -> prose. Missing keys mean generation produced nothing for
    #: that match, which is not an error — the card renders without prose.
    explanations: dict[str, str] = Field(default_factory=dict)
    generated: bool = False
    durationMs: int = 0


class JobMatchResponse(CamelModel):
    #: EVERY eligible vacancy, ranked strongest to weakest. Not a page.
    matches: list[JobMatch]
    locale: Locale
    #: How many vacancies were actually fetched and scored.
    vacanciesConsidered: int
    #: How many the caller declared eligible. A gap between this and
    #: `vacanciesConsidered` means the index is behind the database.
    eligibleConsidered: int = 0
    generated: bool
    #: What the ranking knew about the candidate: normalized skills, inferred
    #: role families, and which sources contributed how many chunks. Returned so
    #: a report can state honestly which evidence was used rather than assuming.
    capability: dict = Field(default_factory=dict)
    durationMs: int


# --- External "why this match" (Task 4C.6) ---------------------------------


class WhyMatchCandidateContext(CamelModel):
    """The candidate's CURRENT professional profile, already minimized.

    The backend decides what may travel: it sends normalized professional
    facts and nothing else. There is deliberately no field here for an email
    address, phone number, postal address, account id, document id, session
    or token — a fact with nowhere to sit cannot be leaked by accident.

    Every field is optional because "not stated" is a real, common answer and
    must reach the model as silence rather than as an invented value.
    """

    headline: str | None = None
    summary: str | None = None
    locationLabel: str | None = None
    skills: list[str] = Field(default_factory=list, max_length=100)
    languages: list[str] = Field(default_factory=list, max_length=20)
    #: Free-text professional history lines, already flattened by the backend.
    experience: list[str] = Field(default_factory=list, max_length=20)
    education: list[str] = Field(default_factory=list, max_length=20)
    #: What the candidate says they WANT — desired titles, work modes, etc.
    preferences: list[str] = Field(default_factory=list, max_length=20)
    #: Short excerpts from the candidate's CURRENT evidence (resume, links).
    #: Current-only by construction: the backend reads live rows, never a
    #: snapshot, and a deleted source contributes nothing (Rule N1).
    evidenceExcerpts: list[str] = Field(default_factory=list, max_length=12)


class WhyMatchJobContext(CamelModel):
    """Canonical stored facts for ONE external job. Untrusted content."""

    title: str
    company: str | None = None
    #: The job's CURRENT lifecycle state (ACTIVE/STALE/CLOSED/...). Passed so
    #: the model can respect it; never softened or relabelled.
    status: str
    locationLabel: str | None = None
    workMode: str | None = None
    employmentType: str | None = None
    seniorityLevel: str | None = None
    salaryLabel: str | None = None
    skills: list[str] = Field(default_factory=list, max_length=60)
    languages: list[str] = Field(default_factory=list, max_length=20)
    benefits: list[str] = Field(default_factory=list, max_length=30)
    description: str | None = None
    requirementsText: str | None = None


class WhyMatchDeterministicFacts(CamelModel):
    """What the deterministic pipeline ALREADY decided. Supplied, not derived.

    The model reports these; it never recomputes them. `score` and `band`
    travel as opaque labels precisely so the prose cannot disagree with the
    number the ranking committed to.
    """

    score: int | None = None
    band: str | None = None
    matchedSkills: list[str] = Field(default_factory=list, max_length=60)
    missingSkills: list[str] = Field(default_factory=list, max_length=60)
    #: Human-readable alignment notes ("Location: matches your Seoul
    #: preference"), produced by the shared matchers.
    alignmentNotes: list[str] = Field(default_factory=list, max_length=20)


class ExternalWhyMatchRequest(CamelModel):
    jobId: str
    locale: Locale = "en"
    candidate: WhyMatchCandidateContext
    job: WhyMatchJobContext
    facts: WhyMatchDeterministicFacts = Field(
        default_factory=WhyMatchDeterministicFacts
    )


class WhyMatchItem(CamelModel):
    title: str
    explanation: str


class ExternalWhyMatchResponse(CamelModel):
    jobId: str
    locale: Locale
    summary: str
    #: 2-4 in practice; bounded on generation, never padded.
    strengths: list[WhyMatchItem] = Field(default_factory=list)
    #: 0-2. Fewer is correct when the facts show no real gap.
    gaps: list[WhyMatchItem] = Field(default_factory=list)
    model: str = ""
    durationMs: int = 0


class ExternalCoverLetterRequest(CamelModel):
    """Cover-letter generation for ONE external job.

    Deliberately the SAME context shapes as why-match: every premium feature
    grounds in the candidate's current profile, the canonical job, and the
    deterministic facts — one meaning, three consumers.
    """

    jobId: str
    locale: Locale = "en"
    candidate: WhyMatchCandidateContext
    job: WhyMatchJobContext
    facts: WhyMatchDeterministicFacts = Field(
        default_factory=WhyMatchDeterministicFacts
    )


class ExternalCoverLetterResponse(CamelModel):
    jobId: str
    locale: Locale
    subject: str
    #: Plain professional text, ~250-450 words; bounded, never padded.
    content: str
    model: str = ""
    durationMs: int = 0


class ExternalInterviewPrepRequest(CamelModel):
    """Interview preparation for ONE external job. Same context shapes."""

    jobId: str
    locale: Locale = "en"
    candidate: WhyMatchCandidateContext
    job: WhyMatchJobContext
    facts: WhyMatchDeterministicFacts = Field(
        default_factory=WhyMatchDeterministicFacts
    )


class InterviewPrepQuestionModel(CamelModel):
    question: str
    whyAsked: str
    preparation: str


class InterviewFocusAreaModel(CamelModel):
    title: str
    guidance: str


class ExternalInterviewPrepResponse(CamelModel):
    jobId: str
    locale: Locale
    #: 5-8 asked for; bounded at 8, honest fewer allowed, never padded.
    questions: list[InterviewPrepQuestionModel] = Field(default_factory=list)
    #: 2-4 asked for; bounded at 4, honest fewer allowed.
    focusAreas: list[InterviewFocusAreaModel] = Field(default_factory=list)
    model: str = ""
    durationMs: int = 0


class BreakdownDimensionInput(CamelModel):
    """One ALREADY-CLASSIFIED dimension, decided by the backend.

    `status` arrives as an opaque decided label; the AI service never
    recomputes or filters it, and the response schema has no status field a
    model could answer through.
    """

    key: str
    label: str
    status: str
    matched: list[str] = Field(default_factory=list, max_length=12)
    missing: list[str] = Field(default_factory=list, max_length=12)
    #: The deterministic ground for the status, in plain English.
    reason: str = ""


class ExternalMatchBreakdownRequest(CamelModel):
    """Breakdown prose for ONE external job. Same context shapes as every
    premium feature, plus the backend's decided dimension table."""

    jobId: str
    locale: Locale = "en"
    candidate: WhyMatchCandidateContext
    job: WhyMatchJobContext
    facts: WhyMatchDeterministicFacts = Field(
        default_factory=WhyMatchDeterministicFacts
    )
    dimensions: list[BreakdownDimensionInput] = Field(
        default_factory=list, max_length=9
    )


class BreakdownExplanation(CamelModel):
    key: str
    explanation: str


class ExternalMatchBreakdownResponse(CamelModel):
    jobId: str
    locale: Locale
    #: 60-120 words asked for; non-empty enforced by the backend.
    summary: str
    #: One entry per supplied dimension the model actually explained; the
    #: backend falls back to the deterministic reason for any missing key.
    explanations: list[BreakdownExplanation] = Field(default_factory=list)
    model: str = ""
    durationMs: int = 0

"""Internal API — consumed only by the NestJS backend, never by a browser.

Every route requires the shared internal service token. ``organizationId``
arrives from the backend, which derived it from the authenticated user's JWT;
the AI service treats it as authoritative and filters every vector operation by
it.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.dependencies import (
    get_candidate_store,
    get_cross_encoder,
    get_current_settings,
    get_embedder,
    get_generator,
    get_progress_reporter,
    get_store,
    get_vacancy_store,
)
from app.api.security import require_internal_token
from app.common.errors import FileTooLargeError, UnsupportedFileTypeError
from app.common import metrics
from app.common.logging import get_logger
from app.mapping import generate_interview_questions, map_requirements
from app.models.schemas import (
    CandidateSummaryRequest,
    DeleteCandidateResumeRequest,
    IndexCandidateWebSourceRequest,
    IndexWebSourceResponse,
    JobMatchRequest,
    JobMatchResponse,
    MatchExplanationsRequest,
    MatchExplanationsResponse,
    ProcessCandidateResumeResponse,
    VacancyDeleteRequest,
    VacancyDeleteResponse,
    VacancyIndexRequest,
    VacancyIndexResponse,
    CollectionInfo,
    CandidateSummaryResponse,
    DeleteDocumentRequest,
    EvidenceMapRequest,
    EvidenceMapResponse,
    InterviewQuestionsRequest,
    InterviewQuestionsResponse,
    RagRequest,
    RagResponse,
    DeleteDocumentResponse,
    ProcessDocumentResponse,
    RerankRequest,
    RerankResponse,
    SearchRequest,
    SearchResponse,
)
from app.candidate import index_vacancy, match_jobs, process_candidate_resume
from app.candidate.job_match import explain_matches
from app.retrieval import (
    answer_question,
    index_candidate_web_source,
    process_document,
    rerank_hits,
    search_evidence,
    summarise_candidate,
)

logger = get_logger(__name__)

router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("/documents/process", response_model=ProcessDocumentResponse)
async def process_document_endpoint(
    file: UploadFile = File(...),
    documentId: str = Form(...),
    organizationId: str = Form(...),
    candidateId: str | None = Form(default=None),
    fileName: str | None = Form(default=None),
    documentType: str = Form(default="RESUME"),
    # Reindex jobs target a new collection version while the active one keeps
    # serving. Omitted for normal uploads.
    targetCollection: str | None = Form(default=None),
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_store),
    progress=Depends(get_progress_reporter),
) -> ProcessDocumentResponse:
    """Parses, chunks, embeds and indexes one document.

    The file is streamed from the backend rather than fetched from a URL: that
    keeps documents private (no public or signed URL is ever minted for the AI
    service) and works identically for local-disk and R2 storage.

    Re-running this for the same documentId is safe — see QdrantStore.
    """
    data = await file.read()
    if len(data) > settings.max_file_size_bytes:
        raise FileTooLargeError(
            f"File exceeds the {settings.max_file_size_bytes} byte limit"
        )

    resolved_name = fileName or file.filename or "document"

    if targetCollection and targetCollection != store.collection:
        # Only collections under the configured base name may be targeted, so
        # this cannot be used to write into arbitrary Qdrant collections.
        if not targetCollection.startswith(f"{settings.qdrant_collection}_v"):
            raise UnsupportedFileTypeError(
                f"targetCollection must start with {settings.qdrant_collection}_v"
            )
        from app.vectorstore import QdrantStore

        store = QdrantStore(
            settings.qdrant_url,
            targetCollection,
            api_key=settings.qdrant_api_key,
            timeout=settings.qdrant_timeout_seconds,
        )

    return process_document(
        data=data,
        file_name=resolved_name,
        document_id=documentId,
        organization_id=organizationId,
        candidate_id=candidateId or None,
        document_type=documentType,
        settings=settings,
        embedder=embedder,
        store=store,
        progress=progress,
    )


@router.post("/search", response_model=SearchResponse)
async def search_endpoint(
    payload: SearchRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
) -> SearchResponse:
    """Semantic search over CURRENT candidate evidence.

    Scoped to the authorized candidate accounts the backend resolved — an
    empty universe returns zero hits without touching the store.
    """
    reranker = get_cross_encoder() if (payload.rerank and settings.reranker_enabled) else None

    return search_evidence(
        candidate_account_ids=payload.candidateAccountIds,
        query=payload.query,
        limit=payload.limit,
        document_id=payload.documentId,
        use_rerank=payload.rerank,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        allowed_source_ids=payload.allowedSourceIds,
    )


@router.post("/rerank", response_model=RerankResponse)
async def rerank_endpoint(payload: RerankRequest) -> RerankResponse:
    """Reorders supplied passages by query relevance using the cross-encoder.

    Provenance on each hit is preserved exactly; only ordering and rerankScore
    change.
    """
    started = time.perf_counter()
    ordered, _ = rerank_hits(
        query=payload.query,
        hits=list(payload.hits),
        limit=payload.limit,
        reranker=get_cross_encoder(),
    )
    return RerankResponse(
        query=payload.query,
        hits=ordered,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


@router.post("/documents/delete", response_model=DeleteDocumentResponse)
async def delete_document_endpoint(
    payload: DeleteDocumentRequest,
    store=Depends(get_store),
) -> DeleteDocumentResponse:
    """Removes every vector for one document within one organization."""
    store.delete_document(payload.organizationId, payload.documentId)
    logger.info(
        "Document vectors deleted",
        extra={
            "documentId": payload.documentId,
            "organizationId": payload.organizationId,
            "stage": "delete",
        },
    )
    return DeleteDocumentResponse(documentId=payload.documentId, deleted=True)


@router.get("/metrics")
async def metrics_endpoint() -> dict:
    """Counters and timings for the AI pipeline.

    JSON rather than Prometheus text: this is local development and the
    project has no metrics infrastructure yet. Carries no tenant, candidate or
    document data — only names, counts and durations.
    """
    return metrics.snapshot()


@router.get("/collections", response_model=CollectionInfo)
async def collections_endpoint(
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_store),
) -> CollectionInfo:
    """Reports the active collection and what else exists.

    Used by the reindex workflow to confirm a new version was built before the
    old one is retired.
    """
    return CollectionInfo(
        activeCollection=settings.active_collection,
        embeddingModel=embedder.model_name,
        embeddingDimension=embedder.dimension,
        collections=sorted(store.list_collections()),
    )


# --- Grounded generation (RAG) ---------------------------------------------


@router.post("/rag", response_model=RagResponse)
async def rag_endpoint(
    payload: RagRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
    generator=Depends(get_generator),
) -> RagResponse:
    """Answers a question grounded in CURRENT candidate evidence.

    With no retrieved evidence the LLM is never called and the response is
    INSUFFICIENT_EVIDENCE — an ungrounded answer is worse than no answer.
    """
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return answer_question(
        candidate_account_ids=payload.candidateAccountIds,
        query=payload.query,
        locale=payload.locale,
        limit=payload.limit,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        generator=generator,
        vacancy=payload.vacancy,
        allowed_source_ids=payload.allowedSourceIds,
    )


@router.post("/candidates/summary", response_model=CandidateSummaryResponse)
async def candidate_summary_endpoint(
    payload: CandidateSummaryRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
    generator=Depends(get_generator),
) -> CandidateSummaryResponse:
    """Summarises what a candidate's CURRENT documents state. No quality judgement."""
    return summarise_candidate(
        candidate_account_id=payload.candidateAccountId,
        locale=payload.locale,
        limit=payload.limit,
        vacancy=payload.vacancy,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=None,
        generator=generator,
        allowed_source_ids=payload.allowedSourceIds,
    )


# --- JD evidence mapping ---------------------------------------------------


@router.post("/evidence-map", response_model=EvidenceMapResponse)
async def evidence_map_endpoint(
    payload: EvidenceMapRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
) -> EvidenceMapResponse:
    """Maps each job requirement to the candidate's evidence.

    Retrieval + classification only — no LLM, so this works whether or not
    generation is configured. Returns EVIDENCE_FOUND / NO_EVIDENCE_FOUND /
    NEEDS_HUMAN_REVIEW per requirement, never a fit percentage.
    """
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return map_requirements(
        candidate_account_id=payload.candidateAccountId,
        vacancy_id=payload.vacancyId,
        requirements=payload.requirements,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        allowed_source_ids=payload.allowedSourceIds,
    )


@router.post("/interview-questions", response_model=InterviewQuestionsResponse)
async def interview_questions_endpoint(
    payload: InterviewQuestionsRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
    generator=Depends(get_generator),
) -> InterviewQuestionsResponse:
    """Interview prompts drawn from present and missing evidence."""
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return generate_interview_questions(
        candidate_account_id=payload.candidateAccountId,
        vacancy_id=payload.vacancyId,
        requirements=payload.requirements,
        locale=payload.locale,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        generator=generator,
        allowed_source_ids=payload.allowedSourceIds,
    )


# --- Candidate-side: personal resumes, vacancy index, job match --------------
#
# Same internal token, but a DIFFERENT scoping key: these routes take a
# candidateAccountId (derived by the backend from the authenticated user's own
# CandidateAccount) and touch only the candidate-side collections. No route
# below can read org-scoped resume chunks, and no route above can read
# personal ones — the stores are physically separate.


@router.post(
    "/candidate/documents/process", response_model=ProcessCandidateResumeResponse
)
async def process_candidate_resume_endpoint(
    file: UploadFile = File(...),
    documentId: str = Form(...),
    candidateAccountId: str = Form(...),
    fileName: str | None = Form(default=None),
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
) -> ProcessCandidateResumeResponse:
    """Indexes one PERSONAL resume into the candidate-scoped collection."""
    data = await file.read()
    if len(data) > settings.max_file_size_bytes:
        raise FileTooLargeError(
            f"File exceeds the {settings.max_file_size_bytes} byte limit"
        )
    return process_candidate_resume(
        data=data,
        file_name=fileName or file.filename or "resume",
        document_id=documentId,
        candidate_account_id=candidateAccountId,
        settings=settings,
        embedder=embedder,
        store=store,
    )


@router.post(
    "/candidate/web-sources/index", response_model=IndexWebSourceResponse
)
async def index_candidate_web_source_endpoint(
    payload: IndexCandidateWebSourceRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_candidate_store),
) -> IndexWebSourceResponse:
    """Indexes one PERSONAL professional link into the candidate collection.

    Beside the account's own resumes, in the same physically separate
    collection, so the candidate's Job Match retrieves their files and links
    together. Carries no organizationId: a personal link chunk cannot satisfy a
    tenant filter because the key does not exist on it.
    """
    return index_candidate_web_source(
        payload, settings=settings, embedder=embedder, store=store
    )


@router.post("/candidate/documents/delete", response_model=DeleteDocumentResponse)
async def delete_candidate_resume_endpoint(
    payload: DeleteCandidateResumeRequest,
    store=Depends(get_candidate_store),
) -> DeleteDocumentResponse:
    """Removes a personal resume's vectors (owner-scoped, idempotent)."""
    store.delete_document(payload.candidateAccountId, payload.documentId)
    logger.info(
        "Personal resume vectors deleted",
        extra={
            "documentId": payload.documentId,
            "candidateAccountId": payload.candidateAccountId,
            "stage": "candidate_delete",
        },
    )
    return DeleteDocumentResponse(documentId=payload.documentId, deleted=True)


@router.post("/vacancies/index", response_model=VacancyIndexResponse)
async def index_vacancy_endpoint(
    payload: VacancyIndexRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_vacancy_store),
) -> VacancyIndexResponse:
    """Indexes one vacancy's candidate-visible content. Idempotent."""
    return index_vacancy(
        payload, settings=settings, embedder=embedder, store=store
    )


@router.post("/vacancies/delete", response_model=VacancyDeleteResponse)
async def delete_vacancy_endpoint(
    payload: VacancyDeleteRequest,
    store=Depends(get_vacancy_store),
) -> VacancyDeleteResponse:
    """Removes a vacancy from the candidate-discoverable index. Idempotent."""
    store.delete_vacancy(payload.vacancyId)
    logger.info(
        "Vacancy index removed",
        extra={"vacancyId": payload.vacancyId, "stage": "vacancy_delete"},
    )
    return VacancyDeleteResponse(vacancyId=payload.vacancyId, deleted=True)


@router.post(
    "/candidate/match-explanations", response_model=MatchExplanationsResponse
)
async def match_explanations_endpoint(
    payload: MatchExplanationsRequest,
    generator=Depends(get_generator),
) -> MatchExplanationsResponse:
    """Prose for ONE PAGE of a ranking the backend already holds.

    Touches no vector store and re-ranks nothing: the caller sends the facts its
    ranking produced, and gets sentences back. This is what makes paging to
    results 21-40 cheap.
    """
    started = time.perf_counter()
    explanations, generated = explain_matches(
        items=payload.items, locale=payload.locale, generator=generator
    )
    return MatchExplanationsResponse(
        explanations=explanations,
        generated=generated,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


@router.post("/candidate/job-matches", response_model=JobMatchResponse)
async def job_matches_endpoint(
    payload: JobMatchRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    resume_store=Depends(get_candidate_store),
    vacancy_store=Depends(get_vacancy_store),
    generator=Depends(get_generator),
) -> JobMatchResponse:
    """Candidate → vacancy matching over the candidate's OWN data only.

    Deterministic labels from requirement-evidence coverage; one batched
    generation call for the explanations. Never touches org-scoped chunks.
    """
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return match_jobs(
        request=payload,
        settings=settings,
        embedder=embedder,
        resume_store=resume_store,
        vacancy_store=vacancy_store,
        reranker=reranker,
        generator=generator,
    )

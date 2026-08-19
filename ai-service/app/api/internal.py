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
    get_cross_encoder,
    get_current_settings,
    get_embedder,
    get_generator,
    get_progress_reporter,
    get_store,
)
from app.api.security import require_internal_token
from app.common.errors import FileTooLargeError, UnsupportedFileTypeError
from app.common import metrics
from app.common.logging import get_logger
from app.mapping import generate_interview_questions, map_requirements
from app.models.schemas import (
    CandidateSummaryRequest,
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
from app.retrieval import (
    answer_question,
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
    store=Depends(get_store),
) -> SearchResponse:
    """Semantic evidence search, always scoped to one organization."""
    reranker = get_cross_encoder() if (payload.rerank and settings.reranker_enabled) else None

    return search_evidence(
        organization_id=payload.organizationId,
        query=payload.query,
        limit=payload.limit,
        candidate_id=payload.candidateId,
        document_id=payload.documentId,
        use_rerank=payload.rerank,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
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
    store=Depends(get_store),
    generator=Depends(get_generator),
) -> RagResponse:
    """Answers a question using only this candidate's indexed evidence.

    With no retrieved evidence the LLM is never called and the response is
    INSUFFICIENT_EVIDENCE — an ungrounded answer is worse than no answer.
    """
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return answer_question(
        organization_id=payload.organizationId,
        query=payload.query,
        candidate_id=payload.candidateId,
        locale=payload.locale,
        limit=payload.limit,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        generator=generator,
    )


@router.post("/candidates/summary", response_model=CandidateSummaryResponse)
async def candidate_summary_endpoint(
    payload: CandidateSummaryRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_store),
    generator=Depends(get_generator),
) -> CandidateSummaryResponse:
    """Summarises what a candidate's own documents state. No quality judgement."""
    return summarise_candidate(
        organization_id=payload.organizationId,
        candidate_id=payload.candidateId,
        locale=payload.locale,
        limit=payload.limit,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=None,
        generator=generator,
    )


# --- JD evidence mapping ---------------------------------------------------


@router.post("/evidence-map", response_model=EvidenceMapResponse)
async def evidence_map_endpoint(
    payload: EvidenceMapRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_store),
) -> EvidenceMapResponse:
    """Maps each job requirement to the candidate's evidence.

    Retrieval + classification only — no LLM, so this works whether or not
    generation is configured. Returns EVIDENCE_FOUND / NO_EVIDENCE_FOUND /
    NEEDS_HUMAN_REVIEW per requirement, never a fit percentage.
    """
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return map_requirements(
        organization_id=payload.organizationId,
        candidate_id=payload.candidateId,
        vacancy_id=payload.vacancyId,
        requirements=payload.requirements,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
    )


@router.post("/interview-questions", response_model=InterviewQuestionsResponse)
async def interview_questions_endpoint(
    payload: InterviewQuestionsRequest,
    settings=Depends(get_current_settings),
    embedder=Depends(get_embedder),
    store=Depends(get_store),
    generator=Depends(get_generator),
) -> InterviewQuestionsResponse:
    """Interview prompts drawn from present and missing evidence."""
    reranker = get_cross_encoder() if settings.reranker_enabled else None
    return generate_interview_questions(
        organization_id=payload.organizationId,
        candidate_id=payload.candidateId,
        vacancy_id=payload.vacancyId,
        requirements=payload.requirements,
        locale=payload.locale,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        generator=generator,
    )

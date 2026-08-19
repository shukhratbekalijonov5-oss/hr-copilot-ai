"""Document indexing pipeline: bytes -> parsed -> chunks -> vectors -> Qdrant.

Each stage is timed and reported. Nothing is inferred: ``chunksCreated`` and
``vectorsIndexed`` are counted from the work that actually happened, so the
backend can only mark a document COMPLETED when indexing genuinely succeeded.
"""

from __future__ import annotations

import time

from app.chunking import chunk_sections
from app.common.errors import EmptyDocumentError
from app.common import metrics
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.models.schemas import ProcessDocumentResponse, StageResult
from app.common.progress import (
    STAGE_CHUNKING,
    STAGE_EMBEDDING,
    STAGE_INDEXING,
    STAGE_PARSING,
    NullProgressReporter,
    ProgressReporter,
)
from app.parsers import parse_document, split_into_sections
from app.vectorstore import QdrantStore

logger = get_logger(__name__)


def process_document(
    *,
    data: bytes,
    file_name: str,
    document_id: str,
    organization_id: str,
    candidate_id: str | None,
    document_type: str = "RESUME",
    settings: Settings,
    embedder: EmbeddingModel,
    store: QdrantStore,
    progress: ProgressReporter | None = None,
) -> ProcessDocumentResponse:
    started = time.perf_counter()
    stages: list[StageResult] = []
    reporter = progress or NullProgressReporter()

    def report(stage: str, percent: int) -> None:
        reporter.report(
            document_id=document_id,
            organization_id=organization_id,
            stage=stage,
            progress=percent,
        )

    def stage(name: str, began: float, detail: str) -> None:
        stages.append(
            StageResult(
                stage=name,
                durationMs=int((time.perf_counter() - began) * 1000),
                detail=detail,
            )
        )

    log_context = {
        "documentId": document_id,
        "organizationId": organization_id,
        "candidateId": candidate_id,
        "fileName": file_name,
    }

    # --- parse ------------------------------------------------------------
    report(STAGE_PARSING, 10)
    began = time.perf_counter()
    parsed = parse_document(data, file_name)
    sections = split_into_sections(parsed.pages)
    detected = sorted({s.name for s in sections if s.name})
    stage("parsing", began, f"{parsed.page_count} page(s), {len(sections)} section(s)")
    logger.info(
        "Document parsed",
        extra={**log_context, "stage": "parsing",
               "pageCount": parsed.page_count, "sectionCount": len(sections)},
    )

    # --- chunk ------------------------------------------------------------
    report(STAGE_CHUNKING, 40)
    began = time.perf_counter()
    chunks = chunk_sections(
        sections,
        organization_id=organization_id,
        document_id=document_id,
        candidate_id=candidate_id,
        file_name=file_name,
        document_type=document_type,
        target_chars=settings.chunk_target_chars,
        overlap_chars=settings.chunk_overlap_chars,
        min_split_chars=settings.chunk_min_split_chars,
    )
    stage("chunking", began, f"{len(chunks)} chunk(s)")

    if not chunks:
        # Parsed to something, but nothing indexable came out of it.
        raise EmptyDocumentError("Document produced no indexable text")

    logger.info(
        "Document chunked",
        extra={**log_context, "stage": "chunking", "chunkCount": len(chunks)},
    )

    # --- embed ------------------------------------------------------------
    report(STAGE_EMBEDDING, 60)
    began = time.perf_counter()
    vectors = embedder.encode_passages([chunk.text for chunk in chunks])
    stage("embedding", began, f"{len(vectors)} vector(s), dim {embedder.dimension}")
    logger.info(
        "Chunks embedded",
        extra={**log_context, "stage": "embedding",
               "vectorCount": len(vectors), "dimension": embedder.dimension},
    )

    # --- index ------------------------------------------------------------
    report(STAGE_INDEXING, 85)
    began = time.perf_counter()
    store.ensure_collection(embedder.dimension)
    indexed = store.upsert_chunks(chunks, vectors)
    stage("indexing", began, f"{indexed} point(s) upserted")
    logger.info(
        "Chunks indexed",
        extra={**log_context, "stage": "indexing", "vectorCount": indexed},
    )

    metrics.increment(metrics.INDEXING_DOCUMENTS)
    return ProcessDocumentResponse(
        documentId=document_id,
        pageCount=parsed.page_count,
        chunksCreated=len(chunks),
        vectorsIndexed=indexed,
        sectionsDetected=detected,
        embeddingModel=embedder.model_name,
        embeddingDimension=embedder.dimension,
        durationMs=int((time.perf_counter() - started) * 1000),
        stages=stages,
    )

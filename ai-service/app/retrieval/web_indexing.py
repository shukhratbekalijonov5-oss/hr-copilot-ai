"""Indexing normalized web evidence — the URL half of the ingestion pipeline.

Structurally the same as ``indexing.process_document``, minus parsing: the
backend already did the fetching and the extraction, so a web source arrives as
sections of text and goes straight to chunk → embed → index.

That "minus parsing" is the whole point of the source-agnostic design. There is
no parallel retrieval stack for URLs: these chunks land in the SAME collections
as file chunks, with the same payload shape and the same idempotency scheme, so
every downstream feature — search, RAG, summaries, evidence mapping, interview
questions, job match — reads both without knowing the difference.

Two functions, because the two collections are physically separate and that
separation is the privacy boundary:

  * ``index_application_web_source``  → tenant collection, keyed by
    organizationId + candidateId. What a recruiter can retrieve.
  * ``index_candidate_web_source``    → candidate collection, keyed by
    candidateAccountId, with NO organizationId anywhere. What the job seeker's
    own Job Match can retrieve.

Nothing here decides who may call it. Authorization is the backend's, always
(see app/api/security.py for the service-to-service boundary).
"""

from __future__ import annotations

import time

from app.candidate.store import CandidateResumeStore, candidate_point_id
from app.chunking import WebSection, chunk_web_sections
from app.common.errors import EmptyDocumentError
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.models.schemas import (
    IndexCandidateWebSourceRequest,
    IndexWebSourceRequest,
    IndexWebSourceResponse,
    WebSectionInput,
)
from app.vectorstore import QdrantStore

logger = get_logger(__name__)


def index_application_web_source(
    payload: IndexWebSourceRequest,
    *,
    settings: Settings,
    embedder: EmbeddingModel,
    store: QdrantStore,
) -> IndexWebSourceResponse:
    """Indexes one application's link snapshot into the tenant collection."""
    started = time.perf_counter()

    chunks = chunk_web_sections(
        _to_sections(payload.sections),
        organization_id=payload.organizationId,
        candidate_id=payload.candidateId,
        source_id=payload.sourceId,
        source_title=payload.title,
        source_url=payload.url,
        target_chars=settings.chunk_target_chars,
        overlap_chars=settings.chunk_overlap_chars,
        min_split_chars=settings.chunk_min_split_chars,
        max_chunks=settings.web_source_max_chunks,
    )
    if not chunks:
        raise EmptyDocumentError("Web source produced no indexable text")

    vectors = embedder.encode_passages([chunk.text for chunk in chunks])
    store.ensure_collection(embedder.dimension)
    # Replace semantics, exactly as for documents: the source id is the key, so
    # a queue retry replaces this source's vectors instead of duplicating them.
    indexed = store.upsert_chunks(chunks, vectors)

    logger.info(
        "Application web source indexed",
        extra={
            "stage": "web_indexing",
            "organizationId": payload.organizationId,
            "candidateId": payload.candidateId,
            "applicationId": payload.applicationId,
            "sourceId": payload.sourceId,
            "chunkCount": len(chunks),
            "vectorCount": indexed,
            # The extracted text is never logged: it is a person's private
            # evidence, and an operational log is the wrong place for it.
        },
    )
    return IndexWebSourceResponse(
        sourceId=payload.sourceId,
        chunksCreated=len(chunks),
        vectorsIndexed=indexed,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


def index_candidate_web_source(
    payload: IndexCandidateWebSourceRequest,
    *,
    settings: Settings,
    embedder: EmbeddingModel,
    store: CandidateResumeStore,
) -> IndexWebSourceResponse:
    """Indexes one PERSONAL link into the candidate-scoped collection.

    Sits beside the account's personal resumes in the same collection, which is
    what makes Job Match retrieve files and links together: a skill shown only
    on a portfolio is found by the same query that finds one listed on a CV.
    """
    started = time.perf_counter()

    chunks = chunk_web_sections(
        _to_sections(payload.sections),
        # The Chunk dataclass is org-shaped; the org fields are deliberately
        # blanked and never make it into the candidate payload below.
        organization_id="",
        candidate_id=None,
        source_id=payload.sourceId,
        source_title=payload.title,
        source_url=payload.url,
        target_chars=settings.chunk_target_chars,
        overlap_chars=settings.chunk_overlap_chars,
        min_split_chars=settings.chunk_min_split_chars,
        max_chunks=settings.web_source_max_chunks,
    )
    if not chunks:
        raise EmptyDocumentError("Web source produced no indexable text")

    vectors = embedder.encode_passages([chunk.text for chunk in chunks])
    payloads = [
        {
            "chunkId": candidate_point_id(payload.sourceId, chunk.chunk_index),
            "candidateAccountId": payload.candidateAccountId,
            # Same key space as personal documents, so one eviction path serves
            # both kinds of personal source.
            "documentId": payload.sourceId,
            "documentType": "URL",
            "section": chunk.section,
            "pageNumber": None,
            "chunkIndex": chunk.chunk_index,
            "text": chunk.text,
            "fileName": payload.title,
            "sourceType": "URL",
            "sourceId": payload.sourceId,
            "sourceTitle": payload.title,
            "sourceUrl": chunk.source_url,
        }
        for chunk in chunks
    ]

    store.ensure_collection(embedder.dimension)
    indexed = store.upsert_document(
        candidate_account_id=payload.candidateAccountId,
        document_id=payload.sourceId,
        payloads=payloads,
        vectors=vectors,
    )
    logger.info(
        "Personal web source indexed",
        extra={
            "stage": "candidate_web_indexing",
            "candidateAccountId": payload.candidateAccountId,
            "sourceId": payload.sourceId,
            "chunkCount": len(chunks),
            "vectorCount": indexed,
        },
    )
    return IndexWebSourceResponse(
        sourceId=payload.sourceId,
        chunksCreated=len(chunks),
        vectorsIndexed=indexed,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


def _to_sections(sections: list[WebSectionInput]) -> list[WebSection]:
    return [
        WebSection(
            name=section.name,
            heading=section.heading,
            text=section.text,
            url=section.url,
        )
        for section in sections
    ]

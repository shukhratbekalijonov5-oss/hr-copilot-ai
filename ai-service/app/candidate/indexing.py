"""Candidate-side indexing: personal resumes and vacancies.

Reuses the org pipeline's parsing/chunking/embedding stages but writes into
the candidate-side collections with candidate-side payloads. Nothing here
carries an ``organizationId`` for resumes — a personal resume chunk cannot
satisfy a tenant filter because the key simply does not exist on it.
"""

from __future__ import annotations

import time

from app.candidate.store import (
    CandidateResumeStore,
    VacancyStore,
    candidate_point_id,
    vacancy_point_id,
)
from app.chunking import chunk_sections
from app.common.errors import EmptyDocumentError
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.models.schemas import (
    ProcessCandidateResumeResponse,
    VacancyIndexRequest,
    VacancyIndexResponse,
)
from app.parsers import parse_document, split_into_sections
from app.parsers.sections import Section

logger = get_logger(__name__)


def process_candidate_resume(
    *,
    data: bytes,
    file_name: str,
    document_id: str,
    candidate_account_id: str,
    settings: Settings,
    embedder: EmbeddingModel,
    store: CandidateResumeStore,
) -> ProcessCandidateResumeResponse:
    """Parses, chunks, embeds and indexes one PERSONAL resume.

    Same stages as the org pipeline, minus progress callbacks (there is no
    recruiter processing UI for personal documents; the backend tracks the
    Document row's status directly). Idempotent per documentId.
    """
    started = time.perf_counter()

    parsed = parse_document(data, file_name)
    sections = split_into_sections(parsed.pages)
    chunks = chunk_sections(
        sections,
        # The Chunk dataclass is org-shaped; the org fields are deliberately
        # blanked and never make it into the candidate payload below.
        organization_id="",
        document_id=document_id,
        candidate_id=None,
        file_name=file_name,
        document_type="RESUME",
        target_chars=settings.chunk_target_chars,
        overlap_chars=settings.chunk_overlap_chars,
        min_split_chars=settings.chunk_min_split_chars,
    )
    if not chunks:
        raise EmptyDocumentError("Document produced no indexable text")

    vectors = embedder.encode_passages([c.text for c in chunks])
    payloads = [
        {
            "chunkId": candidate_point_id(document_id, c.chunk_index),
            "candidateAccountId": candidate_account_id,
            "documentId": document_id,
            "documentType": "RESUME",
            "section": c.section,
            "pageNumber": c.page_number,
            "chunkIndex": c.chunk_index,
            "text": c.text,
            "fileName": c.file_name,
        }
        for c in chunks
    ]

    store.ensure_collection(embedder.dimension)
    indexed = store.upsert_document(
        candidate_account_id=candidate_account_id,
        document_id=document_id,
        payloads=payloads,
        vectors=vectors,
    )
    logger.info(
        "Personal resume indexed",
        extra={
            "stage": "candidate_indexing",
            "candidateAccountId": candidate_account_id,
            "documentId": document_id,
            "vectorCount": indexed,
        },
    )
    return ProcessCandidateResumeResponse(
        documentId=document_id,
        pageCount=parsed.page_count,
        chunksCreated=len(chunks),
        vectorsIndexed=indexed,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


def index_vacancy(
    payload: VacancyIndexRequest,
    *,
    settings: Settings,
    embedder: EmbeddingModel,
    store: VacancyStore,
) -> VacancyIndexResponse:
    """Indexes one vacancy's CANDIDATE-VISIBLE content.

    The backend sends only public job-ad fields — recruiter notes and internal
    metadata never reach this function. Requirements are stored structurally
    on every point (they are small) so the match pipeline can classify them
    without a second backend round-trip. Idempotent per vacancyId.
    """
    started = time.perf_counter()

    sections: list[Section] = []
    if payload.title:
        sections.append(Section(name="title", page_number=1, text=payload.title))
    if payload.description:
        sections.append(
            Section(name="description", page_number=1, text=payload.description)
        )
    if payload.requirements:
        sections.append(
            Section(
                name="requirements",
                page_number=1,
                text="\n".join(r.text for r in payload.requirements),
            )
        )
    context_bits = [
        bit for bit in (payload.location, payload.employmentType) if bit
    ]
    if context_bits:
        sections.append(
            Section(name="details", page_number=1, text=" · ".join(context_bits))
        )

    chunks = chunk_sections(
        sections,
        organization_id="",
        document_id=payload.vacancyId,
        candidate_id=None,
        file_name=None,
        document_type="VACANCY",
        target_chars=settings.chunk_target_chars,
        overlap_chars=settings.chunk_overlap_chars,
        min_split_chars=settings.chunk_min_split_chars,
    )
    if not chunks:
        # An empty vacancy is un-indexable; remove any stale points instead.
        store.delete_vacancy(payload.vacancyId)
        return VacancyIndexResponse(
            vacancyId=payload.vacancyId,
            chunksIndexed=0,
            durationMs=int((time.perf_counter() - started) * 1000),
        )

    requirements = [
        {"text": r.text, "required": r.required} for r in payload.requirements
    ]
    vectors = embedder.encode_passages([c.text for c in chunks])
    payloads = [
        {
            "chunkId": vacancy_point_id(payload.vacancyId, c.chunk_index),
            "vacancyId": payload.vacancyId,
            "organizationId": payload.organizationId,
            "status": payload.status,
            "title": payload.title,
            "location": payload.location,
            "employmentType": payload.employmentType,
            "section": c.section,
            "chunkIndex": c.chunk_index,
            "text": c.text,
            "requirements": requirements,
        }
        for c in chunks
    ]

    store.ensure_collection(embedder.dimension)
    indexed = store.upsert_vacancy(
        vacancy_id=payload.vacancyId, payloads=payloads, vectors=vectors
    )
    logger.info(
        "Vacancy indexed",
        extra={
            "stage": "vacancy_indexing",
            "vacancyId": payload.vacancyId,
            "status": payload.status,
            "vectorCount": indexed,
        },
    )
    return VacancyIndexResponse(
        vacancyId=payload.vacancyId,
        chunksIndexed=indexed,
        durationMs=int((time.perf_counter() - started) * 1000),
    )

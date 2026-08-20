"""Grounded answering: retrieval -> reranking -> generation -> validation.

The order matters. Retrieval happens first and decides whether generation runs
at all: with no evidence there is nothing to ground an answer in, so the LLM is
never called and the caller gets INSUFFICIENT_EVIDENCE. Sending an empty
context and hoping the model declines is not a control.
"""

from __future__ import annotations

import time

from app.common import metrics
from app.common.logging import get_logger
from app.config import Settings
from app.generation import (
    GenerationClient,
    GenerationDisabledError,
    reconcile_answer_markers,
    scrub_context,
    validate_citations,
)
from app.models.schemas import (
    CandidateSummaryResponse,
    EvidenceHit,
    RagResponse,
)
from app.retrieval.search import search_evidence

logger = get_logger(__name__)

_NO_EVIDENCE_MESSAGE = {
    "en": "No evidence was found in this candidate's documents to answer that.",
    "ko": "이 지원자의 문서에서 해당 질문에 답할 근거를 찾지 못했습니다.",
    "ru": "В документах этого кандидата не найдено данных для ответа на этот вопрос.",
    "uz": "Bu nomzodning hujjatlarida bu savolga javob beradigan dalil topilmadi.",
}


def answer_question(  # noqa: PLR0913 - explicit dependencies, injected by the API layer
    *,
    organization_id: str,
    query: str,
    candidate_id: str | None,
    locale: str,
    limit: int,
    settings: Settings,
    embedder,
    store,
    reranker,
    generator: GenerationClient,
) -> RagResponse:
    started = time.perf_counter()
    metrics.increment(metrics.RAG_REQUESTS)

    retrieval = search_evidence(
        organization_id=organization_id,
        query=query,
        limit=limit,
        candidate_id=candidate_id,
        document_id=None,
        use_rerank=True,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
    )
    context = scrub_context(
        retrieval.hits, organization_id=organization_id, candidate_id=candidate_id
    )

    if not context:
        metrics.increment(metrics.RAG_INSUFFICIENT_EVIDENCE)
        metrics.observe_ms(metrics.RAG_DURATION, (time.perf_counter() - started) * 1000)
        # No LLM call: there is nothing to be grounded in.
        logger.info(
            "RAG returned no evidence; generation skipped",
            extra={
                "organizationId": organization_id,
                "candidateId": candidate_id,
                "stage": "rag",
                "status": "INSUFFICIENT_EVIDENCE",
            },
        )
        return RagResponse(
            answer=_NO_EVIDENCE_MESSAGE.get(locale, _NO_EVIDENCE_MESSAGE["en"]),
            status="INSUFFICIENT_EVIDENCE",
            citations=[],
            locale=locale,
            evidenceConsidered=0,
            durationMs=_elapsed(started),
        )

    metrics.increment(metrics.LLM_REQUESTS)
    try:
        with metrics.timed(metrics.LLM_DURATION):
            generated = generator.generate_grounded_answer(
                question=query, evidence=context, locale=locale
            )
    except Exception:
        metrics.increment(metrics.LLM_ERRORS)
        metrics.increment(metrics.RAG_FAILURES)
        raise

    outcome = validate_citations(
        generated.cited_chunk_ids,
        context,
        organization_id=organization_id,
        candidate_id=candidate_id,
    )
    status = _resolve_status(generated.status, outcome.citations)
    if outcome.rejected_chunk_ids:
        metrics.increment(metrics.CITATIONS_REJECTED, len(outcome.rejected_chunk_ids))
    metrics.observe_ms(metrics.RAG_DURATION, (time.perf_counter() - started) * 1000)

    logger.info(
        "RAG answer generated",
        extra={
            "organizationId": organization_id,
            "candidateId": candidate_id,
            "stage": "rag",
            "status": status,
            "evidenceConsidered": len(context),
            "citationsAccepted": len(outcome.citations),
            "citationsRejected": len(outcome.rejected_chunk_ids),
            "durationMs": _elapsed(started),
        },
    )

    return RagResponse(
        # Prose and citation list must agree: markers for accepted citations
        # are canonicalized to [<chunkId>], everything else is stripped.
        answer=reconcile_answer_markers(generated.answer, context, outcome.citations),
        status=status,
        citations=outcome.citations,
        locale=locale,
        rejectedCitations=outcome.rejected_chunk_ids,
        evidenceConsidered=len(context),
        durationMs=_elapsed(started),
        model=generated.model,
    )


def summarise_candidate(
    *,
    organization_id: str,
    candidate_id: str,
    locale: str,
    limit: int,
    settings: Settings,
    embedder,
    store,
    reranker,
    generator: GenerationClient,
) -> CandidateSummaryResponse:
    started = time.perf_counter()

    # A broad query: the goal is coverage of the candidate's own documents, not
    # relevance to a specific question.
    retrieval = search_evidence(
        organization_id=organization_id,
        query="professional experience, skills, projects, education, certifications, languages",
        limit=limit,
        candidate_id=candidate_id,
        document_id=None,
        use_rerank=False,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=None,
    )
    context = scrub_context(
        retrieval.hits, organization_id=organization_id, candidate_id=candidate_id
    )

    if not context:
        return CandidateSummaryResponse(
            summary=_NO_EVIDENCE_MESSAGE.get(locale, _NO_EVIDENCE_MESSAGE["en"]),
            status="INSUFFICIENT_EVIDENCE",
            citations=[],
            locale=locale,
            durationMs=_elapsed(started),
        )

    generated = generator.generate_candidate_summary(evidence=context, locale=locale)
    outcome = validate_citations(
        generated.cited_chunk_ids,
        context,
        organization_id=organization_id,
        candidate_id=candidate_id,
    )

    return CandidateSummaryResponse(
        summary=reconcile_answer_markers(
            generated.answer, context, outcome.citations
        ),
        status=_resolve_status(generated.status, outcome.citations),
        citations=outcome.citations,
        locale=locale,
        rejectedCitations=outcome.rejected_chunk_ids,
        durationMs=_elapsed(started),
        model=generated.model,
    )


def _resolve_status(model_status: str, citations: list) -> str:
    """Reconciles what the model claimed with what actually validated.

    A model may report GROUNDED while every citation it gave was invented. In
    that case the answer is not verifiable and must not be presented as
    grounded — it is downgraded for a human to check.
    """
    if model_status == "INSUFFICIENT_EVIDENCE":
        return "INSUFFICIENT_EVIDENCE"
    if not citations:
        return "NEEDS_HUMAN_REVIEW"
    if model_status == "NEEDS_HUMAN_REVIEW":
        return "NEEDS_HUMAN_REVIEW"
    return "GROUNDED"


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)

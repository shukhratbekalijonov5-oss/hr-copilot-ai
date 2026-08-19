"""Semantic evidence search: query -> Qdrant -> optional cross-encoder rerank.

Provenance (document, file name, section, page, chunk index) is carried through
untouched, including across reranking, so every returned passage can still be
cited back to its source.
"""

from __future__ import annotations

import time

from app.common import metrics
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.models.schemas import EvidenceHit, SearchResponse
from app.vectorstore import QdrantStore

logger = get_logger(__name__)


def search_evidence(
    *,
    organization_id: str,
    query: str,
    limit: int,
    candidate_id: str | None,
    document_id: str | None,
    use_rerank: bool,
    settings: Settings,
    embedder: EmbeddingModel,
    store: QdrantStore,
    reranker=None,
) -> SearchResponse:
    started = time.perf_counter()

    rerank_active = bool(use_rerank and settings.reranker_enabled and reranker)
    # Over-fetch only when a second stage will actually re-order the results.
    pool = max(limit, settings.reranker_candidate_pool) if rerank_active else limit

    with metrics.timed(metrics.RETRIEVAL_DURATION):
        query_vector = embedder.encode_query(query)
        raw_hits = store.search(
            organization_id=organization_id,
            query_vector=query_vector,
            limit=pool,
            candidate_id=candidate_id,
            document_id=document_id,
        )

    hits = [_to_evidence(hit.payload, hit.score) for hit in raw_hits]
    considered = len(hits)
    reranked = False

    if rerank_active and hits:
        try:
            with metrics.timed(metrics.RERANKER_DURATION):
                scores = reranker.score(query, [hit.text for hit in hits])
            for hit, score in zip(hits, scores):
                hit.rerankScore = score
            hits.sort(key=lambda h: h.rerankScore or 0.0, reverse=True)
            reranked = True
        except Exception as exc:
            # A reranker failure degrades ranking quality; it must not turn a
            # working search into an error. Vector order is still meaningful.
            logger.warning(
                "Reranking failed; returning vector-search order",
                extra={"organizationId": organization_id, "errorType": type(exc).__name__},
            )
            hits.sort(key=lambda h: h.retrievalScore, reverse=True)
    else:
        hits.sort(key=lambda h: h.retrievalScore, reverse=True)

    hits = hits[:limit]

    logger.info(
        "Evidence search completed",
        extra={
            "organizationId": organization_id,
            "candidateId": candidate_id,
            "stage": "search",
            "considered": considered,
            "returned": len(hits),
            "reranked": reranked,
            "durationMs": int((time.perf_counter() - started) * 1000),
            # The query itself is not logged: it is user input and may quote
            # personal details from a resume.
        },
    )

    return SearchResponse(
        query=query,
        hits=hits,
        totalCandidatesConsidered=considered,
        reranked=reranked,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


def rerank_hits(
    *, query: str, hits: list[EvidenceHit], limit: int, reranker
) -> tuple[list[EvidenceHit], int]:
    started = time.perf_counter()
    if not hits:
        return [], 0

    scores = reranker.score(query, [hit.text for hit in hits])
    for hit, score in zip(hits, scores):
        hit.rerankScore = score
    ordered = sorted(hits, key=lambda h: h.rerankScore or 0.0, reverse=True)[:limit]
    return ordered, int((time.perf_counter() - started) * 1000)


def _to_evidence(payload: dict, score: float) -> EvidenceHit:
    return EvidenceHit(
        chunkId=payload.get("chunkId", ""),
        candidateId=payload.get("candidateId"),
        documentId=payload.get("documentId", ""),
        fileName=payload.get("fileName"),
        section=payload.get("section"),
        pageNumber=payload.get("pageNumber"),
        chunkIndex=int(payload.get("chunkIndex", 0)),
        text=payload.get("text", ""),
        retrievalScore=score,
    )

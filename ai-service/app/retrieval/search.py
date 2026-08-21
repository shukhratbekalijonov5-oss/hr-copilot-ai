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
    allowed_source_ids: list[str] | None = None,
) -> SearchResponse:
    """Retrieve passages for one organization.

    ``allowed_source_ids`` is the surviving-source filter every candidate-scoped
    caller passes (see ``AllowedSourceIds``): it is applied in the vector query
    itself, so deleted evidence cannot occupy a slot in the returned set, let
    alone reach generation.
    """
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
            allowed_source_ids=allowed_source_ids,
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

    hits = cap_per_source(hits, limit, settings.retrieval_max_per_source)

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


def cap_per_source(
    hits: list[EvidenceHit], limit: int, max_per_source: int
) -> list[EvidenceHit]:
    """Keeps one source from monopolising the results, WITHOUT losing any.

    A candidate may submit a 40-page portfolio site and a one-page resume. Pure
    relevance ordering then hands back ten chunks of the portfolio and none of
    the CV, and a summary built on that reads as if the resume did not exist.

    So this is a re-ORDER, not a filter: at most ``max_per_source`` passages per
    source are taken in their existing (relevance) order, then the leftovers
    backfill the remaining slots. The result is never shorter than the plain
    truncation would have been, and its first entries are still the strongest —
    they are just drawn from more than one source when more than one has
    something to say.

    Source type is deliberately NOT part of this: a URL is not favoured for
    being new, and a file is not favoured for being familiar.
    """
    if max_per_source <= 0 or len(hits) <= limit:
        return hits[:limit]

    kept: list[EvidenceHit] = []
    overflow: list[EvidenceHit] = []
    seen: dict[str, int] = {}

    for hit in hits:
        key = hit.documentId or hit.chunkId
        count = seen.get(key, 0)
        if count < max_per_source:
            seen[key] = count + 1
            kept.append(hit)
        else:
            overflow.append(hit)

    if len(kept) < limit:
        kept.extend(overflow[: limit - len(kept)])
    return kept[:limit]


def _to_evidence(payload: dict, score: float) -> EvidenceHit:
    # Every source field is read with a default: chunks indexed before URL
    # evidence existed carry none, and they are files.
    file_name = payload.get("fileName")
    return EvidenceHit(
        chunkId=payload.get("chunkId", ""),
        candidateId=payload.get("candidateId"),
        documentId=payload.get("documentId", ""),
        fileName=file_name,
        section=payload.get("section"),
        pageNumber=payload.get("pageNumber"),
        chunkIndex=int(payload.get("chunkIndex", 0)),
        text=payload.get("text", ""),
        retrievalScore=score,
        sourceType=payload.get("sourceType") or "FILE",
        sourceTitle=payload.get("sourceTitle") or file_name,
        sourceUrl=payload.get("sourceUrl"),
    )

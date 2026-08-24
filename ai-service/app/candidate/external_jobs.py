"""Semantic indexing and retrieval for the EXTERNAL job catalogue.

    canonical ExternalJob facts  →  one deterministic text  →  one vector
    query text                   →  one vector             →  nearest jobs

## What this is allowed to know

Only facts the backend already stores about a job, all of them public: the
title, the company, where it is, how it is worked, and its description. That
list is the whole contract, and two things are deliberately outside it:

  * **Nothing is inferred.** No model is asked "what skills does this need?"
    or "what seniority is this?". Those fields are either stated by the
    employer and stored, or they are unknown — and an unknown that a model
    filled in would be indistinguishable, downstream, from something an
    employer actually said.

  * **Nothing about PROVENANCE.** The provider name, its trust class and the
    number of sources a job has never enter the indexed text. A job is not a
    better answer to a query because the company happens to use Greenhouse, or
    because this product observed it twice; letting either near the embedding
    would put a thumb on the ranking scale in a way nobody could see.

## Why one vector per job rather than chunks

Resumes are chunked because a person's evidence is long and heterogeneous and
the useful unit is a passage. A job ad is one thing, and the unit a candidate
is shown is the job — so chunking would only mean grouping the results back
together afterwards, and would let a posting with a long description occupy
several slots of a top-K that a shorter, better-matching job then loses.
"""

from __future__ import annotations

import time

from app.candidate.store import ExternalJobStore
from app.common.logging import get_logger
from app.embeddings import EmbeddingModel
from app.models.schemas import (
    ExternalJobDeleteRequest,
    ExternalJobDeleteResponse,
    ExternalJobIndexRequest,
    ExternalJobIndexResponse,
    ExternalJobInput,
    ExternalJobSearchRequest,
    ExternalJobSearchResponse,
    ExternalJobSearchHit,
)

logger = get_logger(__name__)

#: How much of a description reaches the embedding.
#:
#: The model truncates at 256 tokens regardless, so a longer text is not more
#: information — it is the same vector computed more slowly. Keeping the cap
#: explicit here means the text that WOULD be embedded matches the text that
#: IS, which matters when someone later wonders why two similar jobs scored
#: differently.
_MAX_DESCRIPTION_CHARS = 1_200


def build_index_text(job: ExternalJobInput) -> str:
    """The one deterministic text that represents a job.

    Ordered most-defining first, because the model truncates and the title is
    the part that must survive. Written as plain phrases rather than
    ``key: value`` pairs: the embedding space was trained on prose, and label
    tokens dilute a short text without adding meaning.

    Korean stays Korean. There is no transliteration step and no translation
    step — the model is multilingual (``paraphrase-multilingual-MiniLM-L12-v2``,
    50+ languages in one shared space), so a Korean title is embedded as
    Korean and remains findable by a Korean query.
    """
    parts: list[str] = [job.title]
    if job.companyName:
        parts.append(f"at {job.companyName}")

    place = " ".join(
        bit for bit in (job.city, job.region, job.countryCode) if bit
    )
    if place:
        parts.append(place)

    # Stated facts only. A null here means the employer said nothing, and the
    # text simply omits it rather than guessing a default.
    for value in (job.workMode, job.employmentType, job.seniorityLevel):
        if value:
            parts.append(value.replace("_", " ").lower())

    if job.description:
        parts.append(job.description[:_MAX_DESCRIPTION_CHARS])

    return "\n".join(parts)


def index_external_jobs(
    payload: ExternalJobIndexRequest,
    *,
    embedder: EmbeddingModel,
    store: ExternalJobStore,
) -> ExternalJobIndexResponse:
    """Embeds and upserts a batch of jobs. Idempotent per job id.

    A batch rather than one job per call: the catalogue arrives in provider
    sweeps of several hundred, and one HTTP round trip and one encode call per
    job would make a resync cost more than the sweep that produced it.
    """
    started = time.perf_counter()

    jobs = [job for job in payload.jobs if job.title.strip()]
    if not jobs:
        return ExternalJobIndexResponse(
            indexed=0, durationMs=int((time.perf_counter() - started) * 1000)
        )

    store.ensure_collection(embedder.dimension)
    texts = [build_index_text(job) for job in jobs]
    vectors = embedder.encode_passages(texts)

    payloads = [
        {
            "externalJobId": job.externalJobId,
            # Read back only as a cheap pre-filter. The backend revalidates
            # every id against PostgreSQL regardless, so a payload that has
            # gone stale costs recall, never correctness.
            "status": job.status,
            "countryCode": job.countryCode or "",
            "title": job.title,
        }
        for job in jobs
    ]
    indexed = store.upsert_jobs(payloads=payloads, vectors=vectors)

    logger.info(
        "External jobs indexed",
        extra={
            "stage": "external_job_index",
            "jobCount": len(jobs),
            "vectorCount": indexed,
            "collection": store.collection,
        },
    )
    return ExternalJobIndexResponse(
        indexed=indexed, durationMs=int((time.perf_counter() - started) * 1000)
    )


def delete_external_jobs(
    payload: ExternalJobDeleteRequest, *, store: ExternalJobStore
) -> ExternalJobDeleteResponse:
    return ExternalJobDeleteResponse(deleted=store.delete_jobs(payload.externalJobIds))


def search_external_jobs(
    payload: ExternalJobSearchRequest,
    *,
    embedder: EmbeddingModel,
    store: ExternalJobStore,
) -> ExternalJobSearchResponse:
    """Nearest jobs to a query, as CANDIDATES for the backend to revalidate.

    `encode_query` is used for symmetry with the rest of the service; on this
    model it is the same computation as `encode_passages` (both normalize to
    unit length for cosine), so query and job land in one comparable space.

    Scores come back untouched. They are cosine similarity and nothing more —
    the backend decides what similarity is worth proposing and how far a
    semantic-only hit may climb, because those are ranking decisions and this
    service does not make ranking decisions.
    """
    started = time.perf_counter()
    query = payload.query.strip()
    if not query:
        return ExternalJobSearchResponse(
            hits=[], durationMs=int((time.perf_counter() - started) * 1000)
        )

    vector = embedder.encode_query(query)
    hits = store.search(
        query_vector=vector,
        limit=payload.limit,
        statuses=payload.statuses or None,
    )

    return ExternalJobSearchResponse(
        hits=[
            ExternalJobSearchHit(
                externalJobId=str(hit.payload.get("externalJobId", "")),
                similarity=hit.score,
            )
            for hit in hits
            if hit.payload.get("externalJobId")
        ],
        durationMs=int((time.perf_counter() - started) * 1000),
    )

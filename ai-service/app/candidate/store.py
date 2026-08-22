"""Candidate-side vector stores: personal resumes and the vacancy index.

DELIBERATELY separate classes and separate physical collections from the
org-scoped ``QdrantStore``:

  * ``CandidateResumeStore`` holds a job seeker's PERSONAL resume chunks. Its
    every read requires ``candidate_account_id`` — there is no code path that
    queries it by organization, so recruiter search cannot reach personal
    resumes even in principle. The mirror also holds: this store carries no
    ``organizationId`` payload at all, so nothing indexed here can ever
    satisfy a tenant filter.

  * ``VacancyStore`` holds candidate-discoverable vacancy content. Reads are
    hard-filtered to OPEN vacancies; recruiter-private notes are never sent to
    this store in the first place (the backend indexes only public fields).

Both reuse the same idempotency scheme as the org store: deterministic point
ids + delete-then-upsert, so a queue retry replaces vectors instead of
accumulating duplicates.
"""

from __future__ import annotations

import uuid
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.common.errors import VectorStoreUnavailableError
from app.common.logging import get_logger
from app.vectorstore.qdrant_store import (
    SearchHit,
    _is_missing_collection,
    _match,
    _match_any,
)

#: Vacancy ids per scroll filter. Keeps one request's filter bounded however
#: many vacancies an organization has open.
_SCROLL_ID_BATCH = 256
#: Points per scroll page.
_SCROLL_PAGE = 512

logger = get_logger(__name__)

# Distinct namespaces so ids can never collide with the org collection's.
_CANDIDATE_POINT_NAMESPACE = uuid.UUID("b4c9d7e2-1a35-4f68-8c02-9d64e7a1f503")
_VACANCY_POINT_NAMESPACE = uuid.UUID("3e8a17c6-52d4-4b09-9f71-08b52c6d94ae")


def candidate_point_id(document_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_CANDIDATE_POINT_NAMESPACE, f"{document_id}:{chunk_index}"))


def vacancy_point_id(vacancy_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_VACANCY_POINT_NAMESPACE, f"{vacancy_id}:{chunk_index}"))


class _BaseStore:
    def __init__(
        self,
        url: str,
        collection: str,
        *,
        api_key: str = "",
        timeout: float = 30.0,
    ) -> None:
        self._collection = collection
        try:
            self._client = QdrantClient(
                url=url, api_key=api_key or None, timeout=timeout
            )
        except Exception as exc:
            raise VectorStoreUnavailableError(
                f"Qdrant client init failed: {exc}"
            ) from exc

    @property
    def collection(self) -> str:
        return self._collection

    def _ensure(self, dimension: int, index_fields: tuple[str, ...]) -> None:
        try:
            if self._client.collection_exists(self._collection):
                existing = self._client.get_collection(
                    self._collection
                ).config.params.vectors.size
                if existing != dimension:
                    raise VectorStoreUnavailableError(
                        f"Collection '{self._collection}' has vector size "
                        f"{existing}, but the embedding model produces {dimension}."
                    )
                return
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=qmodels.VectorParams(
                    size=dimension, distance=qmodels.Distance.COSINE
                ),
            )
            for field in index_fields:
                self._client.create_payload_index(
                    collection_name=self._collection,
                    field_name=field,
                    field_schema=qmodels.PayloadSchemaType.KEYWORD,
                )
            logger.info(
                "Qdrant collection created",
                extra={"collection": self._collection, "dimension": dimension},
            )
        except VectorStoreUnavailableError:
            raise
        except Exception as exc:
            raise VectorStoreUnavailableError(
                f"Could not ensure collection '{self._collection}': {exc}"
            ) from exc

    def _delete_where(self, must: list[Any]) -> None:
        try:
            self._client.delete(
                collection_name=self._collection,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(must=must)
                ),
                wait=True,
            )
        except Exception as exc:
            if _is_missing_collection(exc):
                return
            raise VectorStoreUnavailableError(f"Could not delete points: {exc}") from exc

    def _upsert(self, points: list[qmodels.PointStruct]) -> int:
        try:
            self._client.upsert(
                collection_name=self._collection, points=points, wait=True
            )
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Could not index chunks: {exc}") from exc
        return len(points)

    def _query(
        self, query_vector: list[float], must: list[Any], limit: int
    ) -> list[SearchHit]:
        try:
            response = self._client.query_points(
                collection_name=self._collection,
                query=query_vector,
                query_filter=qmodels.Filter(must=must),
                limit=limit,
                with_payload=True,
            )
        except Exception as exc:
            if _is_missing_collection(exc):
                return []
            raise VectorStoreUnavailableError(f"Qdrant search failed: {exc}") from exc
        return [
            SearchHit(score=float(p.score), payload=dict(p.payload or {}))
            for p in response.points
        ]

    def count_all(self) -> int:
        try:
            return int(self._client.count(self._collection, exact=True).count)
        except Exception as exc:
            if _is_missing_collection(exc):
                return 0
            raise VectorStoreUnavailableError(f"Qdrant count failed: {exc}") from exc


class CandidateResumeStore(_BaseStore):
    """Personal resume chunks, keyed by candidateAccountId."""

    _INDEX_FIELDS = ("candidateAccountId", "documentId")

    def ensure_collection(self, dimension: int) -> None:
        self._ensure(dimension, self._INDEX_FIELDS)

    def delete_document(self, candidate_account_id: str, document_id: str) -> None:
        if not candidate_account_id:
            raise ValueError("candidate_account_id is required")
        self._delete_where(
            [
                _match("candidateAccountId", candidate_account_id),
                _match("documentId", document_id),
            ]
        )

    def upsert_document(
        self,
        *,
        candidate_account_id: str,
        document_id: str,
        payloads: list[dict[str, Any]],
        vectors: list[list[float]],
    ) -> int:
        if len(payloads) != len(vectors):
            raise ValueError("payload/vector count mismatch")
        # Replace semantics: a re-upload or retry never accumulates points.
        self.delete_document(candidate_account_id, document_id)
        points = [
            qmodels.PointStruct(
                id=candidate_point_id(document_id, payload["chunkIndex"]),
                vector=vector,
                payload=payload,
            )
            for payload, vector in zip(payloads, vectors)
        ]
        return self._upsert(points) if points else 0

    def search(
        self,
        *,
        candidate_account_ids: list[str],
        query_vector: list[float],
        limit: int,
        document_id: str | None = None,
        allowed_source_ids: list[str] | None = None,
    ) -> list[SearchHit]:
        """The ONLY read path — and it requires the owning candidate accounts.

        Mirrors QdrantStore.search's mandatory-tenant invariant: there is no
        way to query personal resumes without saying whose they are. The list
        is the AUTHORIZED universe the backend resolved — one account for a
        candidate-scoped surface, the caller's own applicants for a search —
        and an empty list means "nothing is retrievable", not "everything".

        The account filter stops one candidate reading another's evidence. It
        does NOT stop a candidate's own DELETED evidence coming back, because
        a deleted source's chunks still carry their owner's account id until
        the eviction lands. ``allowed_source_ids`` is what closes that: an
        empty list means "no evidence currently exists" and returns nothing,
        which is the whole point and not an edge case to skip.
        """
        if len(candidate_account_ids) == 0:
            return []
        if allowed_source_ids is not None and len(allowed_source_ids) == 0:
            return []

        must = [_match_any("candidateAccountId", list(candidate_account_ids))]
        if document_id:
            must.append(_match("documentId", document_id))
        if allowed_source_ids:
            must.append(_match_any("documentId", allowed_source_ids))
        return self._query(query_vector, must, limit)

    def list_chunks(
        self,
        candidate_account_id: str,
        limit: int = 12,
        allowed_source_ids: list[str] | None = None,
        with_vectors: bool = False,
    ) -> list[dict[str, Any]]:
        """First chunks of the candidate's own documents (for representation).

        Same authorization as ``search``: this text becomes the candidate's
        search representation, so a deleted portfolio leaking in here would
        steer every vacancy match with evidence that no longer exists.
        """
        if not candidate_account_id:
            raise ValueError("candidate_account_id is required")
        if allowed_source_ids is not None and len(allowed_source_ids) == 0:
            return []

        must = [_match("candidateAccountId", candidate_account_id)]
        if allowed_source_ids:
            must.append(_match_any("documentId", allowed_source_ids))
        try:
            points, _ = self._client.scroll(
                collection_name=self._collection,
                scroll_filter=qmodels.Filter(must=must),
                limit=limit,
                with_payload=True,
                with_vectors=with_vectors,
            )
        except Exception as exc:
            if _is_missing_collection(exc):
                return []
            raise VectorStoreUnavailableError(f"Qdrant scroll failed: {exc}") from exc
        if not with_vectors:
            return [dict(p.payload or {}) for p in points]
        # Vectors come back alongside the payload so a caller ranking hundreds
        # of vacancies can score every requirement against the candidate's
        # evidence IN PROCESS, instead of issuing one Qdrant search per
        # requirement. With ~50 chunks that is a rounding error of memory and
        # the difference between seconds and minutes.
        return [{**dict(p.payload or {}), "_vector": p.vector} for p in points]

    def count_for_account(self, candidate_account_id: str) -> int:
        try:
            result = self._client.count(
                collection_name=self._collection,
                count_filter=qmodels.Filter(
                    must=[_match("candidateAccountId", candidate_account_id)]
                ),
                exact=True,
            )
            return int(result.count)
        except Exception as exc:
            if _is_missing_collection(exc):
                return 0
            raise VectorStoreUnavailableError(f"Qdrant count failed: {exc}") from exc


class VacancyStore(_BaseStore):
    """Candidate-discoverable vacancy content.

    Reads are hard-filtered to OPEN vacancies — a closed or draft vacancy that
    somehow still has stale points is unreachable through search, and the
    backend re-verifies every returned vacancy against the database anyway.
    """

    _INDEX_FIELDS = ("vacancyId", "organizationId", "status")

    def ensure_collection(self, dimension: int) -> None:
        self._ensure(dimension, self._INDEX_FIELDS)

    def delete_vacancy(self, vacancy_id: str) -> None:
        if not vacancy_id:
            raise ValueError("vacancy_id is required")
        self._delete_where([_match("vacancyId", vacancy_id)])

    def upsert_vacancy(
        self,
        *,
        vacancy_id: str,
        payloads: list[dict[str, Any]],
        vectors: list[list[float]],
    ) -> int:
        if len(payloads) != len(vectors):
            raise ValueError("payload/vector count mismatch")
        self.delete_vacancy(vacancy_id)
        points = [
            qmodels.PointStruct(
                id=vacancy_point_id(vacancy_id, payload["chunkIndex"]),
                vector=vector,
                payload=payload,
            )
            for payload, vector in zip(payloads, vectors)
        ]
        return self._upsert(points) if points else 0

    def search_open(
        self, *, query_vector: list[float], limit: int
    ) -> list[SearchHit]:
        """Vector search across OPEN vacancies only."""
        return self._query(query_vector, [_match("status", "OPEN")], limit)

    def fetch_vacancies(
        self, vacancy_ids: list[str], *, with_vectors: bool = True
    ) -> list[dict]:
        """Every indexed chunk of the NAMED vacancies, with their vectors.

        A scroll, not a search, and that difference is the point. A top-K
        search answers "which vacancies look closest?" and silently decides the
        universe; this answers "give me exactly these", so the caller — the
        backend, which owns eligibility — decides what is in scope and every
        one of them gets scored.

        Vectors come back too, so similarity for all of them is computed once
        in-process instead of issuing one query per candidate probe.

        An id with no points is simply absent from the result: the index lags
        behind the database (a cascade-deleted vacancy leaves points behind,
        and a newly created one is indexed asynchronously), and neither case is
        an error here. The caller reconciles.
        """
        if not vacancy_ids:
            return []

        collected: list[dict] = []
        # Chunked so a large eligible set cannot build one enormous filter.
        for start in range(0, len(vacancy_ids), _SCROLL_ID_BATCH):
            batch = vacancy_ids[start : start + _SCROLL_ID_BATCH]
            offset = None
            while True:
                try:
                    points, offset = self._client.scroll(
                        collection_name=self._collection,
                        scroll_filter=qmodels.Filter(
                            must=[
                                _match_any("vacancyId", batch),
                                _match("status", "OPEN"),
                            ]
                        ),
                        limit=_SCROLL_PAGE,
                        offset=offset,
                        with_payload=True,
                        with_vectors=with_vectors,
                    )
                except Exception as exc:
                    if _is_missing_collection(exc):
                        return collected
                    raise VectorStoreUnavailableError(
                        f"Qdrant scroll failed: {exc}"
                    ) from exc

                for point in points:
                    entry = dict(point.payload or {})
                    if with_vectors:
                        entry["_vector"] = point.vector
                    collected.append(entry)

                if offset is None:
                    break
        return collected

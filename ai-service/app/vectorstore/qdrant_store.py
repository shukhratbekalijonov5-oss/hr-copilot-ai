"""Qdrant vector store.

Two invariants are enforced here rather than left to callers:

  1. **Tenant filtering is not optional.** Every search goes through
     ``search()``, which always builds an ``organizationId`` match condition.
     There is no code path that queries the collection without it — a caller
     cannot forget to pass a tenant, because the argument is required.

  2. **Indexing is idempotent.** Point IDs are derived deterministically from
     (documentId, chunkIndex), and a re-index deletes every existing point for
     the document first. A BullMQ retry therefore replaces the document's
     vectors rather than accumulating duplicates.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.common.errors import VectorStoreUnavailableError
from app.common.logging import get_logger

logger = get_logger(__name__)

# Stable namespace so a given (documentId, chunkIndex) always maps to the same
# point ID across processes and restarts.
_POINT_NAMESPACE = uuid.UUID("6f1d2a54-8b3e-4c77-9a10-2f5c8e0d4b91")


def build_point_id(document_id: str, chunk_index: int) -> str:
    """Deterministic point ID — the basis of idempotent re-indexing."""
    return str(uuid.uuid5(_POINT_NAMESPACE, f"{document_id}:{chunk_index}"))


@dataclass
class SearchHit:
    score: float
    payload: dict[str, Any]


class QdrantStore:
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
                url=url,
                api_key=api_key or None,
                timeout=timeout,
            )
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Qdrant client init failed: {exc}") from exc

    @property
    def collection(self) -> str:
        return self._collection

    # --- lifecycle --------------------------------------------------------

    def ping(self) -> None:
        try:
            self._client.get_collections()
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Qdrant unreachable: {exc}") from exc

    def ensure_collection(self, dimension: int) -> bool:
        """Creates the collection if absent. Safe to call on every startup.

        Returns True when the collection was created by this call.

        The dimension comes from the loaded embedding model. If a collection
        already exists with a different width, that is raised rather than
        silently tolerated — mixing widths corrupts retrieval.
        """
        try:
            if self._client.collection_exists(self._collection):
                info = self._client.get_collection(self._collection)
                existing = info.config.params.vectors.size
                if existing != dimension:
                    raise VectorStoreUnavailableError(
                        f"Collection '{self._collection}' has vector size {existing}, "
                        f"but the embedding model produces {dimension}. "
                        "Recreate the collection or restore the previous model."
                    )
                return False

            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=qmodels.VectorParams(
                    size=dimension, distance=qmodels.Distance.COSINE
                ),
            )
            # Payload indexes make the mandatory tenant filter cheap.
            for field in ("organizationId", "candidateId", "documentId"):
                self._client.create_payload_index(
                    collection_name=self._collection,
                    field_name=field,
                    field_schema=qmodels.PayloadSchemaType.KEYWORD,
                )
            logger.info(
                "Qdrant collection created",
                extra={"collection": self._collection, "dimension": dimension},
            )
            return True
        except VectorStoreUnavailableError:
            raise
        except Exception as exc:
            raise VectorStoreUnavailableError(
                f"Could not ensure collection '{self._collection}': {exc}"
            ) from exc

    # --- writes -----------------------------------------------------------

    def delete_document(self, organization_id: str, document_id: str) -> None:
        """Removes every point for one document within one organization."""
        try:
            self._client.delete(
                collection_name=self._collection,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[
                            _match("organizationId", organization_id),
                            _match("documentId", document_id),
                        ]
                    )
                ),
                wait=True,
            )
        except Exception as exc:
            raise VectorStoreUnavailableError(
                f"Could not delete points for document: {exc}"
            ) from exc

    def upsert_chunks(self, chunks, vectors: list[list[float]]) -> int:
        """Replaces the document's points with the supplied chunks.

        Caller must pass all chunks for a single document; ``delete_document``
        runs first so a retry cannot leave stale vectors behind.
        """
        if not chunks:
            return 0
        if len(chunks) != len(vectors):
            raise ValueError("chunk/vector count mismatch")

        organization_id = chunks[0].organization_id
        document_id = chunks[0].document_id

        points = [
            qmodels.PointStruct(
                id=build_point_id(chunk.document_id, chunk.chunk_index),
                vector=vector,
                payload=build_payload(chunk),
            )
            for chunk, vector in zip(chunks, vectors)
        ]

        try:
            # Delete-then-upsert: deterministic IDs alone would overwrite the
            # first N points, but a shorter re-parse would strand the tail.
            self.delete_document(organization_id, document_id)
            self._client.upsert(
                collection_name=self._collection, points=points, wait=True
            )
        except VectorStoreUnavailableError:
            raise
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Could not index chunks: {exc}") from exc

        return len(points)

    # --- reads ------------------------------------------------------------

    def search(
        self,
        *,
        organization_id: str,
        query_vector: list[float],
        limit: int,
        candidate_id: str | None = None,
        document_id: str | None = None,
    ) -> list[SearchHit]:
        """Vector search, always constrained to one organization.

        ``organization_id`` is keyword-only and required: there is deliberately
        no way to call this without a tenant filter.
        """
        if not organization_id:
            raise ValueError("organization_id is required for every search")

        must: list[Any] = [_match("organizationId", organization_id)]
        if candidate_id:
            must.append(_match("candidateId", candidate_id))
        if document_id:
            must.append(_match("documentId", document_id))

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
                # Nothing has been indexed yet. That is "no evidence found",
                # not a service failure — a fresh deployment must not 503.
                logger.info(
                    "Search ran before any document was indexed",
                    extra={"collection": self._collection},
                )
                return []
            raise VectorStoreUnavailableError(f"Qdrant search failed: {exc}") from exc

        return [
            SearchHit(score=float(point.score), payload=dict(point.payload or {}))
            for point in response.points
        ]

    def list_collections(self) -> list[str]:
        """Names of every collection, so a migration can see old and new."""
        try:
            return [c.name for c in self._client.get_collections().collections]
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Qdrant list failed: {exc}") from exc

    def count_all(self) -> int:
        """Total points in this collection. Used to verify a reindex."""
        try:
            return int(self._client.count(self._collection, exact=True).count)
        except Exception as exc:
            if _is_missing_collection(exc):
                return 0
            raise VectorStoreUnavailableError(f"Qdrant count failed: {exc}") from exc

    def count_document_points(self, organization_id: str, document_id: str) -> int:
        """Test/diagnostic helper: how many points a document holds."""
        try:
            result = self._client.count(
                collection_name=self._collection,
                count_filter=qmodels.Filter(
                    must=[
                        _match("organizationId", organization_id),
                        _match("documentId", document_id),
                    ]
                ),
                exact=True,
            )
            return int(result.count)
        except Exception as exc:
            raise VectorStoreUnavailableError(f"Qdrant count failed: {exc}") from exc


def build_payload(chunk) -> dict[str, Any]:
    """Payload stored alongside each vector.

    Carries exactly what a citation needs plus the tenant key. It deliberately
    does NOT contain signed URLs, storage keys or credentials — a leak of the
    vector store must not become a leak of the documents themselves.
    """
    return {
        # Stable, deterministic identity for this chunk. Citations reference
        # it, and grounding validation checks claimed ids against it.
        "chunkId": build_point_id(chunk.document_id, chunk.chunk_index),
        "organizationId": chunk.organization_id,
        "candidateId": chunk.candidate_id,
        "documentId": chunk.document_id,
        "section": chunk.section,
        "pageNumber": chunk.page_number,
        "chunkIndex": chunk.chunk_index,
        "text": chunk.text,
        "fileName": chunk.file_name,
        "documentType": chunk.document_type,
    }


def _is_missing_collection(exc: Exception) -> bool:
    text = str(exc).lower()
    return "doesn't exist" in text or "not found" in text or "does not exist" in text


def _match(field: str, value: str):
    return qmodels.FieldCondition(key=field, match=qmodels.MatchValue(value=value))

"""Versioned collections and the reindex path (§41)."""

from __future__ import annotations

import uuid

import pytest

from app.config import Settings


class TestCollectionVersioning:
    def test_active_collection_carries_the_version(self):
        settings = Settings(qdrant_collection="resume_chunks", qdrant_collection_version=1)
        assert settings.active_collection == "resume_chunks_v1"

    def test_bumping_the_version_changes_the_active_name(self):
        settings = Settings(qdrant_collection="resume_chunks", qdrant_collection_version=2)
        assert settings.active_collection == "resume_chunks_v2"

    def test_old_version_name_is_still_derivable(self):
        """A migration must be able to read the collection it is replacing."""
        settings = Settings(qdrant_collection="resume_chunks", qdrant_collection_version=2)
        assert settings.collection_for_version(1) == "resume_chunks_v1"

    def test_version_must_be_positive(self):
        with pytest.raises(Exception):
            Settings(qdrant_collection_version=0)


@pytest.mark.integration
@pytest.mark.slow
class TestReindexIntoANewCollection:
    """A model change must not rewrite the live index in place."""

    def test_new_version_is_built_without_touching_the_old(self, qdrant_available, embedder):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        from app.config import get_settings
        from app.retrieval import process_document
        from app.vectorstore import QdrantStore
        from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_pdf

        settings = get_settings()
        base = f"reindex_test_{uuid.uuid4().hex[:8]}"
        org = f"org-{uuid.uuid4()}"
        doc = f"doc-{uuid.uuid4()}"

        v1 = QdrantStore(settings.qdrant_url, f"{base}_v1")
        v2 = QdrantStore(settings.qdrant_url, f"{base}_v2")

        try:
            process_document(
                data=build_pdf(JIWOO_HAN_TEXT), file_name="cv.pdf", document_id=doc,
                organization_id=org, candidate_id="c1", settings=settings,
                embedder=embedder, store=v1,
            )
            original = v1.count_document_points(org, doc)
            assert original > 0

            # Reindex into the new version.
            process_document(
                data=build_pdf(JIWOO_HAN_TEXT), file_name="cv.pdf", document_id=doc,
                organization_id=org, candidate_id="c1", settings=settings,
                embedder=embedder, store=v2,
            )

            # Old collection is untouched and still serving.
            assert v1.count_document_points(org, doc) == original
            assert v2.count_document_points(org, doc) == original

            names = v1.list_collections()
            assert f"{base}_v1" in names
            assert f"{base}_v2" in names
        finally:
            # Delete the COLLECTIONS, not just the points. Deleting only the
            # document left `reindex_test_*` collection shells behind on every
            # run; a few hundred of those and Qdrant's per-collection startup
            # overhead OOMs the container (found 2026-08-24: 146 of them).
            for store in (v1, v2):
                try:
                    store._client.delete_collection(store.collection)
                except Exception:
                    pass

    def test_a_dimension_mismatch_is_refused(self, qdrant_available, embedder):
        """Mixing vector widths in one collection corrupts retrieval."""
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        from app.common.errors import VectorStoreUnavailableError
        from app.config import get_settings
        from app.vectorstore import QdrantStore

        name = f"dim_test_{uuid.uuid4().hex[:8]}"
        store = QdrantStore(get_settings().qdrant_url, name)
        try:
            store.ensure_collection(embedder.dimension)

            with pytest.raises(VectorStoreUnavailableError, match="vector size"):
                store.ensure_collection(embedder.dimension + 128)
        finally:
            try:
                store._client.delete_collection(store.collection)
            except Exception:
                pass

    def test_ensure_collection_is_idempotent(self, qdrant_available, embedder):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        from app.config import get_settings
        from app.vectorstore import QdrantStore

        store = QdrantStore(get_settings().qdrant_url, f"idem_{uuid.uuid4().hex[:8]}")

        try:
            assert store.ensure_collection(embedder.dimension) is True
            assert store.ensure_collection(embedder.dimension) is False
        finally:
            try:
                store._client.delete_collection(store.collection)
            except Exception:
                pass

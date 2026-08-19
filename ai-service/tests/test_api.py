"""HTTP-level behaviour of the internal API and health probes."""

from __future__ import annotations

import uuid

import pytest

from tests.fixtures.resumes import (
    JIWOO_HAN_TEXT,
    build_corrupt_pdf,
    build_empty_pdf,
    build_pdf,
)


class TestHealth:
    def test_live_returns_200_without_touching_dependencies(self, client):
        response = client.get("/health/live")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["uptimeSeconds"] >= 0

    def test_ready_reports_each_dependency(self, client):
        response = client.get("/health/ready")
        body = response.json()

        assert set(body["checks"]) == {"qdrant", "embeddingModel"}
        assert response.status_code in (200, 503)

    def test_ready_is_503_when_a_dependency_is_down(self, client, monkeypatch):
        """Readiness must never report ready while a dependency is broken."""
        from app.api import health as health_module

        class BrokenStore:
            def ping(self):
                raise RuntimeError("connection refused")

        monkeypatch.setattr(health_module, "get_store", lambda: BrokenStore())

        response = client.get("/health/ready")

        assert response.status_code == 503
        assert response.json()["status"] == "error"
        assert response.json()["checks"]["qdrant"]["status"] == "down"

    def test_ready_does_not_leak_a_connection_string(self, client, monkeypatch):
        from app.api import health as health_module

        class BrokenStore:
            def ping(self):
                raise RuntimeError("failed connecting to http://user:pw@qdrant.internal:6333")

        monkeypatch.setattr(health_module, "get_store", lambda: BrokenStore())

        body = client.get("/health/ready").text
        assert "pw@" not in body


class TestErrorHandling:
    def test_unsupported_file_type_returns_400_with_a_code(self, client, auth_headers):
        response = client.post(
            "/internal/documents/process",
            headers=auth_headers,
            files={"file": ("notes.txt", b"just text", "text/plain")},
            data={"documentId": "d1", "organizationId": "org-a"},
        )

        assert response.status_code == 400
        assert response.json()["code"] == "unsupported_file_type"

    def test_empty_pdf_returns_422(self, client, auth_headers):
        response = client.post(
            "/internal/documents/process",
            headers=auth_headers,
            files={"file": ("scan.pdf", build_empty_pdf(), "application/pdf")},
            data={"documentId": "d1", "organizationId": "org-a"},
        )

        assert response.status_code == 422
        assert response.json()["code"] == "empty_document"

    def test_corrupt_pdf_returns_422(self, client, auth_headers):
        response = client.post(
            "/internal/documents/process",
            headers=auth_headers,
            files={"file": ("broken.pdf", build_corrupt_pdf(), "application/pdf")},
            data={"documentId": "d1", "organizationId": "org-a"},
        )

        assert response.status_code == 422
        assert response.json()["code"] in ("corrupt_document", "empty_document")

    def test_errors_never_return_a_python_traceback(self, client, auth_headers):
        """A traceback can quote document text and reveals internals."""
        response = client.post(
            "/internal/documents/process",
            headers=auth_headers,
            files={"file": ("broken.pdf", build_corrupt_pdf(), "application/pdf")},
            data={"documentId": "d1", "organizationId": "org-a"},
        )
        body = response.text

        assert "Traceback" not in body
        assert ".py" not in body
        assert set(response.json()) == {"code", "message"}

    def test_missing_required_field_is_a_clean_422(self, client, auth_headers):
        response = client.post(
            "/internal/search", headers=auth_headers, json={"query": "kubernetes"}
        )

        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"

    def test_search_rejects_an_empty_organization_id(self, client, auth_headers):
        response = client.post(
            "/internal/search",
            headers=auth_headers,
            json={"organizationId": "", "query": "kubernetes"},
        )
        assert response.status_code == 422


class TestRerankEndpoint:
    def test_empty_hit_list_is_handled(self, client, auth_headers):
        response = client.post(
            "/internal/rerank",
            headers=auth_headers,
            json={"query": "kubernetes", "hits": []},
        )

        assert response.status_code == 200
        assert response.json()["hits"] == []


@pytest.mark.integration
@pytest.mark.slow
class TestProcessAndSearchOverHttp:
    """The full internal API path, exercised as the backend will call it."""

    def test_process_then_search_end_to_end(
        self, client, auth_headers, qdrant_available, embedder
    ):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        org = f"org-{uuid.uuid4()}"
        doc = f"doc-{uuid.uuid4()}"

        process = client.post(
            "/internal/documents/process",
            headers=auth_headers,
            files={"file": ("jiwoo-han.pdf", build_pdf(JIWOO_HAN_TEXT), "application/pdf")},
            data={
                "documentId": doc,
                "organizationId": org,
                "candidateId": "cand-jiwoo",
                "fileName": "jiwoo-han.pdf",
            },
        )
        assert process.status_code == 200, process.text
        body = process.json()
        assert body["vectorsIndexed"] > 0
        assert body["embeddingDimension"] == 384

        search = client.post(
            "/internal/search",
            headers=auth_headers,
            json={
                "organizationId": org,
                "query": "production Kubernetes experience",
                "limit": 5,
                "rerank": False,
            },
        )
        assert search.status_code == 200
        hits = search.json()["hits"]
        assert hits
        assert any("kubernetes" in hit["text"].lower() for hit in hits)

        # Another organization must retrieve nothing.
        other = client.post(
            "/internal/search",
            headers=auth_headers,
            json={
                "organizationId": f"org-{uuid.uuid4()}",
                "query": "production Kubernetes experience",
                "rerank": False,
            },
        )
        assert other.json()["hits"] == []

        deleted = client.post(
            "/internal/documents/delete",
            headers=auth_headers,
            json={"organizationId": org, "documentId": doc},
        )
        assert deleted.status_code == 200


@pytest.mark.integration
class TestFreshDeployment:
    """Search before anything is indexed must be 'no results', not an error."""

    def test_search_on_a_missing_collection_returns_no_hits(
        self, qdrant_available, embedder
    ):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        from app.config import get_settings
        from app.retrieval import search_evidence
        from app.vectorstore import QdrantStore

        settings = get_settings()
        store = QdrantStore(settings.qdrant_url, f"never_created_{uuid.uuid4().hex}")

        response = search_evidence(
            organization_id="org-a",
            query="production Kubernetes experience",
            limit=5,
            candidate_id=None,
            document_id=None,
            use_rerank=False,
            settings=settings,
            embedder=embedder,
            store=store,
            reranker=None,
        )

        assert response.hits == []

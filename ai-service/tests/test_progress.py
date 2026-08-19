"""Progress reporting to the backend.

Progress must be observed, not guessed — and a callback failure must never
fail a document that processed correctly.
"""

from __future__ import annotations

import pytest

from app.common.progress import (
    STAGE_CHUNKING,
    STAGE_EMBEDDING,
    STAGE_INDEXING,
    STAGE_PARSING,
    NullProgressReporter,
    ProgressReporter,
)


class RecordingReporter(ProgressReporter):
    """Captures reports instead of sending them."""

    def __init__(self) -> None:
        super().__init__("http://backend/progress", "token", enabled=True)
        self.calls: list[dict] = []

    def report(self, *, document_id, organization_id, stage, progress):
        self.calls.append(
            {
                "documentId": document_id,
                "organizationId": organization_id,
                "stage": stage,
                "progress": progress,
            }
        )


class TestReporterConfiguration:
    def test_disabled_without_a_callback_url(self):
        assert not ProgressReporter("", "token").enabled

    def test_disabled_without_a_token(self):
        assert not ProgressReporter("http://backend/progress", "").enabled

    def test_enabled_when_both_are_present(self):
        assert ProgressReporter("http://backend/progress", "token").enabled

    def test_null_reporter_is_never_enabled(self):
        assert not NullProgressReporter().enabled

    def test_null_reporter_is_a_no_op(self):
        NullProgressReporter().report(
            document_id="d1", organization_id="o1", stage=STAGE_PARSING, progress=10
        )


class TestFailureIsolation:
    def test_a_failing_callback_does_not_raise(self, monkeypatch):
        """A dropped progress update must not fail the document."""
        import app.common.progress as progress_module

        def boom(*args, **kwargs):
            raise ConnectionError("backend unreachable")

        monkeypatch.setattr(progress_module.httpx, "post", boom)

        reporter = ProgressReporter("http://backend/progress", "token")
        reporter.report(
            document_id="d1", organization_id="o1", stage=STAGE_PARSING, progress=10
        )

    def test_a_rejected_callback_does_not_raise(self, monkeypatch):
        import app.common.progress as progress_module

        class Response:
            status_code = 401

        monkeypatch.setattr(progress_module.httpx, "post", lambda *a, **k: Response())

        ProgressReporter("http://backend/progress", "token").report(
            document_id="d1", organization_id="o1", stage=STAGE_PARSING, progress=10
        )


class TestTokenHandling:
    def test_the_token_is_sent_as_the_internal_header(self, monkeypatch):
        import app.common.progress as progress_module

        captured = {}

        class Response:
            status_code = 204

        def capture(url, json=None, headers=None, timeout=None):
            captured["headers"] = headers
            captured["json"] = json
            return Response()

        monkeypatch.setattr(progress_module.httpx, "post", capture)

        ProgressReporter("http://backend/progress", "the-secret").report(
            document_id="d1", organization_id="o1", stage=STAGE_INDEXING, progress=85
        )

        assert captured["headers"]["X-Internal-Service-Token"] == "the-secret"
        assert captured["json"]["stage"] == STAGE_INDEXING

    def test_the_token_is_never_logged(self, monkeypatch, caplog):
        import app.common.progress as progress_module

        monkeypatch.setattr(
            progress_module.httpx,
            "post",
            lambda *a, **k: (_ for _ in ()).throw(ConnectionError("down")),
        )

        with caplog.at_level("WARNING"):
            ProgressReporter("http://backend/progress", "super-secret-token").report(
                document_id="d1", organization_id="o1", stage=STAGE_PARSING, progress=10
            )

        assert "super-secret-token" not in caplog.text


@pytest.mark.integration
@pytest.mark.slow
class TestStagesAreReportedInOrder:
    def test_pipeline_reports_every_stage_as_it_completes(
        self, store, embedder, qdrant_available
    ):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        import uuid

        from app.config import get_settings
        from app.retrieval import process_document
        from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_pdf

        reporter = RecordingReporter()
        doc_id = f"doc-{uuid.uuid4()}"

        try:
            process_document(
                data=build_pdf(JIWOO_HAN_TEXT),
                file_name="cv.pdf",
                document_id=doc_id,
                organization_id="org-progress",
                candidate_id="cand-1",
                settings=get_settings(),
                embedder=embedder,
                store=store,
                progress=reporter,
            )
        finally:
            store.delete_document("org-progress", doc_id)

        assert [c["stage"] for c in reporter.calls] == [
            STAGE_PARSING,
            STAGE_CHUNKING,
            STAGE_EMBEDDING,
            STAGE_INDEXING,
        ]
        # Progress must increase monotonically.
        assert [c["progress"] for c in reporter.calls] == [10, 40, 60, 85]
        assert all(c["documentId"] == doc_id for c in reporter.calls)

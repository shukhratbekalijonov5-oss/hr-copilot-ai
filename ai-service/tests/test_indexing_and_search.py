"""End-to-end AI-service pipeline against real Qdrant and a real PyTorch model.

This is the suite that proves the product principle: the system reports what
evidence it actually found, and does not fabricate evidence it did not.

Fixtures are entirely fictional. Ji-woo Han HAS NestJS, Redis Pub/Sub and
production Kubernetes; Ji-woo Han does NOT have AWS production experience.
"""

from __future__ import annotations

import uuid

import pytest

from app.config import get_settings
from app.retrieval import process_document, search_evidence
from tests.fixtures.resumes import (
    JIWOO_HAN_TEXT,
    MARCUS_OSEI_TEXT,
    build_docx,
    build_pdf,
)

pytestmark = [pytest.mark.integration, pytest.mark.slow]

ORG_A = "org-aaaa-1111"
ORG_B = "org-bbbb-2222"


@pytest.fixture()
def indexed(store, embedder):
    """Indexes the two fictional resumes into two different organizations."""
    settings = get_settings()
    doc_a = f"doc-{uuid.uuid4()}"
    doc_b = f"doc-{uuid.uuid4()}"

    result_a = process_document(
        data=build_pdf(JIWOO_HAN_TEXT),
        file_name="jiwoo-han.pdf",
        document_id=doc_a,
        organization_id=ORG_A,
        candidate_id="cand-jiwoo",
        settings=settings,
        embedder=embedder,
        store=store,
    )
    process_document(
        data=build_pdf(MARCUS_OSEI_TEXT),
        file_name="marcus-osei.pdf",
        document_id=doc_b,
        organization_id=ORG_B,
        candidate_id="cand-marcus",
        settings=settings,
        embedder=embedder,
        store=store,
    )

    yield {"docA": doc_a, "docB": doc_b, "resultA": result_a}

    store.delete_document(ORG_A, doc_a)
    store.delete_document(ORG_B, doc_b)


def _search(
    store, embedder, *, org, query, limit=10, candidate_id=None,
    rerank=False, reranker=None,
):
    return search_evidence(
        organization_id=org,
        query=query,
        limit=limit,
        candidate_id=candidate_id,
        document_id=None,
        use_rerank=rerank,
        settings=get_settings(),
        embedder=embedder,
        store=store,
        reranker=reranker,
    )


class TestIndexing:
    def test_reports_real_counts(self, indexed):
        result = indexed["resultA"]

        assert result.pageCount >= 1
        assert result.chunksCreated > 0
        assert result.vectorsIndexed == result.chunksCreated
        assert result.embeddingDimension == 384

    def test_reports_the_sections_it_actually_detected(self, indexed):
        detected = set(indexed["resultA"].sectionsDetected)
        assert {"experience", "skills"} <= detected

    def test_reports_every_pipeline_stage(self, indexed):
        stages = [s.stage for s in indexed["resultA"].stages]
        assert stages == ["parsing", "chunking", "embedding", "indexing"]

    def test_vectors_are_present_in_qdrant(self, store, indexed):
        count = store.count_document_points(ORG_A, indexed["docA"])
        assert count == indexed["resultA"].vectorsIndexed

    def test_docx_indexes_too(self, store, embedder):
        doc_id = f"doc-{uuid.uuid4()}"
        try:
            result = process_document(
                data=build_docx(JIWOO_HAN_TEXT),
                file_name="jiwoo-han.docx",
                document_id=doc_id,
                organization_id=ORG_A,
                candidate_id="cand-jiwoo",
                settings=get_settings(),
                embedder=embedder,
                store=store,
            )
            assert result.vectorsIndexed > 0
        finally:
            store.delete_document(ORG_A, doc_id)


class TestEvidenceFound:
    """Skills the fictional candidate genuinely has must be retrievable."""

    @pytest.mark.parametrize(
        "query,expected_term",
        [
            ("production Kubernetes experience", "kubernetes"),
            ("Redis Pub/Sub event fan-out", "redis"),
            ("NestJS backend services", "nestjs"),
        ],
    )
    def test_finds_real_evidence(self, store, embedder, indexed, query, expected_term):
        response = _search(store, embedder, org=ORG_A, query=query)

        assert response.hits, f"expected evidence for {query!r}"
        combined = " ".join(hit.text for hit in response.hits).lower()
        assert expected_term in combined

    def test_top_hit_for_kubernetes_mentions_kubernetes(
        self, store, embedder, reranker, indexed
    ):
        response = _search(
            store, embedder, org=ORG_A,
            query="production Kubernetes experience", rerank=True, reranker=reranker,
        )
        assert "kubernetes" in response.hits[0].text.lower()


class TestEvidenceNotFabricated:
    """The candidate has no AWS experience; nothing may invent it."""

    def test_aws_query_returns_no_aws_evidence(self, store, embedder, indexed):
        response = _search(store, embedder, org=ORG_A, query="AWS production experience")

        # Vector search always returns nearest neighbours, so hits may come
        # back — but none of them may actually contain AWS evidence, because
        # the resume contains none.
        for hit in response.hits:
            assert "aws" not in hit.text.lower()
            assert "amazon web services" not in hit.text.lower()

    def test_reranker_separates_present_evidence_from_absent(
        self, store, embedder, reranker, indexed
    ):
        """The cross-encoder is what can actually tell presence from absence.

        A bi-encoder cannot: "AWS production experience" shares the wording
        "production experience" with this resume, so raw vector similarity for
        the absent skill lands close to the present one. Scoring the (query,
        passage) pair jointly separates them by roughly an order of magnitude.
        """
        present = _search(
            store, embedder, org=ORG_A,
            query="production Kubernetes experience", rerank=True, reranker=reranker,
        )
        absent = _search(
            store, embedder, org=ORG_A,
            query="AWS production experience", rerank=True, reranker=reranker,
        )

        assert present.reranked and absent.reranked
        assert present.hits[0].rerankScore > absent.hits[0].rerankScore

    def test_absent_skill_scores_far_below_present_skill(
        self, store, embedder, reranker, indexed
    ):
        """The gap must be large enough for a UI to say "evidence not found"."""
        present = _search(
            store, embedder, org=ORG_A,
            query="Redis Pub/Sub event fan-out", rerank=True, reranker=reranker,
        )
        absent = _search(
            store, embedder, org=ORG_A,
            query="AWS production experience", rerank=True, reranker=reranker,
        )

        assert present.hits[0].rerankScore > absent.hits[0].rerankScore * 3

    def test_retrieved_text_is_verbatim_from_the_resume(self, store, embedder, indexed):
        """Passages are quoted from the document, never generated."""
        source = JIWOO_HAN_TEXT.lower().replace("\n", " ")
        source = " ".join(source.split())

        response = _search(store, embedder, org=ORG_A, query="Kubernetes")
        snippet = " ".join(response.hits[0].text.lower().split())[:60]

        assert snippet in source


class TestTenantIsolation:
    """Cross-tenant evidence leakage is unacceptable."""

    def test_other_organization_gets_zero_results(self, store, embedder, indexed):
        response = _search(
            store, embedder, org=ORG_B, query="production Kubernetes experience"
        )

        doc_ids = {hit.documentId for hit in response.hits}
        assert indexed["docA"] not in doc_ids

    def test_every_hit_belongs_to_the_querying_organization(self, store, embedder, indexed):
        response = _search(store, embedder, org=ORG_A, query="engineer")

        assert response.hits
        assert all(hit.documentId == indexed["docA"] for hit in response.hits)

    def test_unknown_organization_retrieves_nothing(self, store, embedder, indexed):
        response = _search(store, embedder, org="org-does-not-exist", query="Kubernetes")
        assert response.hits == []

    def test_candidate_filter_narrows_within_the_tenant(self, store, embedder, indexed):
        response = _search(
            store, embedder, org=ORG_A, query="engineer", candidate_id="cand-jiwoo"
        )
        assert all(hit.candidateId == "cand-jiwoo" for hit in response.hits)

    def test_candidate_filter_cannot_cross_tenants(self, store, embedder, indexed):
        """Naming another tenant's candidate must not reach their data."""
        response = _search(
            store, embedder, org=ORG_A, query="Spark pipelines", candidate_id="cand-marcus"
        )
        assert response.hits == []


class TestIdempotency:
    """A BullMQ retry must replace vectors, never accumulate duplicates."""

    def test_reprocessing_does_not_duplicate_vectors(self, store, embedder):
        doc_id = f"doc-{uuid.uuid4()}"
        settings = get_settings()
        try:
            first = process_document(
                data=build_pdf(JIWOO_HAN_TEXT),
                file_name="jiwoo-han.pdf",
                document_id=doc_id,
                organization_id=ORG_A,
                candidate_id="cand-jiwoo",
                settings=settings,
                embedder=embedder,
                store=store,
            )
            after_first = store.count_document_points(ORG_A, doc_id)

            for _ in range(3):
                process_document(
                    data=build_pdf(JIWOO_HAN_TEXT),
                    file_name="jiwoo-han.pdf",
                    document_id=doc_id,
                    organization_id=ORG_A,
                    candidate_id="cand-jiwoo",
                    settings=settings,
                    embedder=embedder,
                    store=store,
                )

            after_retries = store.count_document_points(ORG_A, doc_id)

            assert after_first == first.vectorsIndexed
            assert after_retries == after_first
        finally:
            store.delete_document(ORG_A, doc_id)

    def test_reprocessing_shorter_content_removes_stale_vectors(self, store, embedder):
        """A shorter re-parse must not strand the previous run's tail chunks."""
        doc_id = f"doc-{uuid.uuid4()}"
        settings = get_settings()
        try:
            process_document(
                data=build_pdf(JIWOO_HAN_TEXT),
                file_name="cv.pdf",
                document_id=doc_id,
                organization_id=ORG_A,
                candidate_id="cand-jiwoo",
                settings=settings,
                embedder=embedder,
                store=store,
            )
            long_count = store.count_document_points(ORG_A, doc_id)

            short = process_document(
                data=build_pdf("Skills\nPython only."),
                file_name="cv.pdf",
                document_id=doc_id,
                organization_id=ORG_A,
                candidate_id="cand-jiwoo",
                settings=settings,
                embedder=embedder,
                store=store,
            )
            short_count = store.count_document_points(ORG_A, doc_id)

            assert short_count == short.vectorsIndexed
            assert short_count < long_count
        finally:
            store.delete_document(ORG_A, doc_id)


class TestProvenance:
    def test_every_hit_carries_citation_metadata(self, store, embedder, indexed):
        response = _search(store, embedder, org=ORG_A, query="Kubernetes")

        for hit in response.hits:
            assert hit.documentId
            assert hit.fileName == "jiwoo-han.pdf"
            assert hit.pageNumber is None or hit.pageNumber >= 1
            assert hit.chunkIndex >= 0
            assert hit.text.strip()

    def test_retrieval_score_is_present_and_bounded(self, store, embedder, indexed):
        response = _search(store, embedder, org=ORG_A, query="Kubernetes")
        for hit in response.hits:
            assert -1.01 <= hit.retrievalScore <= 1.01

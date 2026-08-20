"""Candidate-side collections against real Qdrant + the real embedder.

Proves the isolation properties with actual vectors, in BOTH directions:

  * personal resume chunks are invisible to org-scoped recruiter search;
  * org-scoped resume chunks are invisible to candidate-side search;
  * candidate A can never retrieve candidate B's chunks;
  * re-indexing is idempotent; deletes are owner-scoped;
  * the vacancy index only ever serves OPEN vacancies.
"""

from __future__ import annotations

import uuid

import pytest

from app.candidate.indexing import index_vacancy, process_candidate_resume
from app.candidate.store import CandidateResumeStore, VacancyStore
from app.config import get_settings
from app.models.schemas import VacancyIndexRequest, VacancyRequirementInput
from app.retrieval import process_document, search_evidence
from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_pdf

pytestmark = [pytest.mark.integration, pytest.mark.slow]

ACCT_A = "acct-aaaa-1111"
ACCT_B = "acct-bbbb-2222"
ORG_X = "org-isolation-x"

# A term that exists nowhere else in any fixture or dev corpus.
MARKER = "Quixotic-Framework-XZ9"
PERSONAL_TEXT = f"""Jane Doe
Experience

Built internal services with the {MARKER} platform and Docker.
Maintained PostgreSQL databases for analytics workloads.
"""


@pytest.fixture()
def candidate_store(qdrant_available):
    if not qdrant_available:
        pytest.skip("Qdrant is not running")
    settings = get_settings()
    store = CandidateResumeStore(
        settings.qdrant_url,
        f"test_candidate_chunks_{uuid.uuid4().hex[:8]}",
        api_key=settings.qdrant_api_key,
    )
    yield store
    store._client.delete_collection(store.collection)


@pytest.fixture()
def vacancy_store(qdrant_available):
    if not qdrant_available:
        pytest.skip("Qdrant is not running")
    settings = get_settings()
    store = VacancyStore(
        settings.qdrant_url,
        f"test_vacancy_chunks_{uuid.uuid4().hex[:8]}",
        api_key=settings.qdrant_api_key,
    )
    yield store
    store._client.delete_collection(store.collection)


class TestPersonalResumeIsolation:
    def test_personal_chunks_never_reachable_through_org_search(
        self, candidate_store, store, embedder
    ):
        """The critical direction: recruiter search cannot see personal resumes."""
        settings = get_settings()
        doc_id = f"personal-{uuid.uuid4()}"
        result = process_candidate_resume(
            data=build_pdf(PERSONAL_TEXT),
            file_name="jane.pdf",
            document_id=doc_id,
            candidate_account_id=ACCT_A,
            settings=settings,
            embedder=embedder,
            store=candidate_store,
        )
        assert result.vectorsIndexed > 0

        # The org-scoped store (a DIFFERENT collection) has no trace of it —
        # under any organization id, including a hostile guess.
        for org in (ORG_X, ACCT_A):
            response = search_evidence(
                organization_id=org,
                query=MARKER,
                limit=10,
                candidate_id=None,
                document_id=None,
                use_rerank=False,
                settings=settings,
                embedder=embedder,
                store=store,
                reranker=None,
            )
            marker_hits = [h for h in response.hits if MARKER in h.text]
            assert marker_hits == [], f"personal chunk leaked into org search ({org})"

    def test_org_chunks_never_reachable_through_candidate_search(
        self, candidate_store, store, embedder
    ):
        """And the mirror: candidate matching cannot read org tenant data."""
        settings = get_settings()
        doc_id = f"org-{uuid.uuid4()}"
        process_document(
            data=build_pdf(JIWOO_HAN_TEXT),
            file_name="jiwoo.pdf",
            document_id=doc_id,
            organization_id=ORG_X,
            candidate_id="cand-1",
            settings=settings,
            embedder=embedder,
            store=store,
        )

        hits = candidate_store.search(
            candidate_account_id=ACCT_A,
            query_vector=embedder.encode_query("Kubernetes production"),
            limit=10,
        )
        assert all(
            h.payload.get("candidateAccountId") == ACCT_A for h in hits
        )
        assert hits == [], "org chunk leaked into candidate search"
        store.delete_document(ORG_X, doc_id)

    def test_candidate_a_cannot_see_candidate_b(self, candidate_store, embedder):
        settings = get_settings()
        process_candidate_resume(
            data=build_pdf(PERSONAL_TEXT),
            file_name="jane.pdf",
            document_id=f"doc-{uuid.uuid4()}",
            candidate_account_id=ACCT_B,
            settings=settings,
            embedder=embedder,
            store=candidate_store,
        )

        hits = candidate_store.search(
            candidate_account_id=ACCT_A,
            query_vector=embedder.encode_query(MARKER),
            limit=10,
        )
        assert hits == [], "candidate A retrieved candidate B's chunks"

        own = candidate_store.search(
            candidate_account_id=ACCT_B,
            query_vector=embedder.encode_query(MARKER),
            limit=10,
        )
        assert own and all(
            h.payload["candidateAccountId"] == ACCT_B for h in own
        )

    def test_search_without_account_id_is_impossible(self, candidate_store):
        with pytest.raises(ValueError):
            candidate_store.search(
                candidate_account_id="", query_vector=[0.0] * 384, limit=5
            )

    def test_reindex_is_idempotent_and_replace_updates(
        self, candidate_store, embedder
    ):
        settings = get_settings()
        doc_id = f"doc-{uuid.uuid4()}"
        first = process_candidate_resume(
            data=build_pdf(PERSONAL_TEXT),
            file_name="jane.pdf",
            document_id=doc_id,
            candidate_account_id=ACCT_A,
            settings=settings,
            embedder=embedder,
            store=candidate_store,
        )
        again = process_candidate_resume(
            data=build_pdf(PERSONAL_TEXT),
            file_name="jane.pdf",
            document_id=doc_id,
            candidate_account_id=ACCT_A,
            settings=settings,
            embedder=embedder,
            store=candidate_store,
        )
        assert candidate_store.count_for_account(ACCT_A) == first.vectorsIndexed
        assert again.vectorsIndexed == first.vectorsIndexed

        # Deleting the owner's document empties the account's index.
        candidate_store.delete_document(ACCT_A, doc_id)
        assert candidate_store.count_for_account(ACCT_A) == 0


class TestVacancyIndex:
    def _payload(self, vacancy_id: str, status: str = "OPEN") -> VacancyIndexRequest:
        return VacancyIndexRequest(
            vacancyId=vacancy_id,
            organizationId=ORG_X,
            status=status,
            title="Platform Reliability Engineer",
            description="Operate Kubernetes clusters and CI/CD pipelines.",
            location="Remote",
            employmentType="Full-time",
            requirements=[
                VacancyRequirementInput(text="Kubernetes", required=True),
                VacancyRequirementInput(text="Docker", required=False),
            ],
        )

    def test_open_vacancy_is_retrievable_and_reindex_is_idempotent(
        self, vacancy_store, embedder
    ):
        settings = get_settings()
        vac_id = f"vac-{uuid.uuid4()}"
        first = index_vacancy(
            self._payload(vac_id), settings=settings, embedder=embedder,
            store=vacancy_store,
        )
        index_vacancy(
            self._payload(vac_id), settings=settings, embedder=embedder,
            store=vacancy_store,
        )
        assert vacancy_store.count_all() == first.chunksIndexed

        hits = vacancy_store.search_open(
            query_vector=embedder.encode_query("Kubernetes platform operations"),
            limit=10,
        )
        assert hits and hits[0].payload["vacancyId"] == vac_id
        # Structured requirements ride along for the match stage.
        assert any(h.payload.get("requirements") for h in hits)

    def test_closed_vacancy_is_never_served(self, vacancy_store, embedder):
        settings = get_settings()
        vac_id = f"vac-{uuid.uuid4()}"
        index_vacancy(
            self._payload(vac_id, status="CLOSED"),
            settings=settings, embedder=embedder, store=vacancy_store,
        )

        hits = vacancy_store.search_open(
            query_vector=embedder.encode_query("Kubernetes platform operations"),
            limit=10,
        )
        assert all(h.payload["vacancyId"] != vac_id for h in hits)

    def test_delete_removes_and_is_idempotent(self, vacancy_store, embedder):
        settings = get_settings()
        vac_id = f"vac-{uuid.uuid4()}"
        index_vacancy(
            self._payload(vac_id), settings=settings, embedder=embedder,
            store=vacancy_store,
        )
        vacancy_store.delete_vacancy(vac_id)
        vacancy_store.delete_vacancy(vac_id)  # second call must not raise
        assert vacancy_store.count_all() == 0

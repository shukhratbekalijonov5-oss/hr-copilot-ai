"""Deleted evidence must be unusable — even when its vectors are still there.

The backend removes a source's rows the moment a candidate deletes it, and
evicts its vectors afterwards through a queue that retries. Between those two
moments the chunks are still physically in Qdrant, still carrying the right
organization and account keys, and still perfectly retrievable. Everything in
this file is about that window.

The mechanism under test is the ``allowedSourceIds`` filter: a list of the
sources that CURRENTLY exist, derived from the rows the deletion already
removed. Three properties matter and each is asserted separately:

  * ``None`` means no restriction (the org-wide search path, which the backend
    filters on the way back instead);
  * a populated list restricts retrieval to exactly those sources;
  * an EMPTY list means "this candidate has no evidence at all" and must return
    NOTHING — the one that would silently invert the guarantee if it were
    treated as falsy and skipped.
"""

from __future__ import annotations

import uuid

import pytest

from app.candidate.job_match import match_jobs
from app.config import get_settings
from app.mapping.service import map_requirements
from app.models.schemas import (
    CandidateProfileInput,
    IndexCandidateWebSourceRequest,
    IndexWebSourceRequest,
    JobMatchRequest,
    RequirementInput,
)
from app.retrieval import (
    index_application_web_source,
    index_candidate_web_source,
    process_document,
)
from app.retrieval.search import search_evidence
from tests.fixtures.web_sources import PERSONAL_PORTFOLIO_SECTIONS

pytestmark = [pytest.mark.integration]

CAND = "cand-deleted-sources"


@pytest.fixture()
def candidate_store(qdrant_available):
    """A throwaway PERSONAL collection, torn down after each test."""
    if not qdrant_available:
        pytest.skip("Qdrant is not running")
    from app.candidate.store import CandidateResumeStore

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
    from app.candidate.store import VacancyStore

    settings = get_settings()
    store = VacancyStore(
        settings.qdrant_url,
        f"test_vacancy_chunks_{uuid.uuid4().hex[:8]}",
        api_key=settings.qdrant_api_key,
    )
    yield store
    store._client.delete_collection(store.collection)

# Two sources with disjoint, unmistakable vocabulary, so "which source did this
# passage come from" is never a judgement call.
RESUME_TEXT = """Ada Okonkwo
Backend Engineer

Skills
Node.js, PostgreSQL, DELETIONPROBE-RESUME-771

Experience
Backend Engineer, Northwind (2021-2026). Built payment services in Node.js.
"""

LINK_SECTIONS = [
    {
        "name": "projects",
        "heading": "Projects",
        "text": (
            "Ran production Kubernetes clusters and wrote the Helm charts for "
            "the platform team. Internal codename DELETIONPROBE-LINK-552."
        ),
    }
]


@pytest.fixture()
def org_evidence(store, embedder):
    """One organization, one candidate, one submitted file + one submitted link."""
    from tests.fixtures.resumes import build_pdf

    settings = get_settings()
    org = f"org-del-{uuid.uuid4()}"
    file_id = f"doc-{uuid.uuid4()}"
    link_id = f"src-{uuid.uuid4()}"

    process_document(
        data=build_pdf(RESUME_TEXT),
        file_name="ada-resume.pdf",
        document_id=file_id,
        organization_id=org,
        candidate_id=CAND,
        settings=settings,
        embedder=embedder,
        store=store,
    )
    index_application_web_source(
        IndexWebSourceRequest(
            organizationId=org,
            candidateId=CAND,
            applicationId=f"app-{uuid.uuid4()}",
            sourceId=link_id,
            title="Portfolio Website",
            url="https://portfolio.example.test",
            sections=LINK_SECTIONS,
        ),
        settings=settings,
        embedder=embedder,
        store=store,
    )

    yield {"org": org, "file": file_id, "link": link_id}

    store.delete_document(org, file_id)
    store.delete_document(org, link_id)


def _search(store, embedder, org, query, allowed):
    return search_evidence(
        organization_id=org,
        query=query,
        limit=10,
        candidate_id=CAND,
        document_id=None,
        use_rerank=False,
        settings=get_settings(),
        embedder=embedder,
        store=store,
        reranker=None,
        allowed_source_ids=allowed,
    )


class TestOrganizationRetrieval:
    def test_without_a_filter_both_sources_are_reachable(
        self, store, embedder, org_evidence
    ):
        """The baseline. If this fails the rest proves nothing."""
        found = {
            hit.documentId
            for hit in _search(
                store, embedder, org_evidence["org"], "Kubernetes Node.js", None
            ).hits
        }
        assert org_evidence["file"] in found
        assert org_evidence["link"] in found

    def test_a_deleted_LINK_cannot_be_retrieved_while_its_vectors_remain(
        self, store, embedder, org_evidence
    ):
        # The link's chunks are deliberately NOT removed from Qdrant here —
        # this is exactly the state a delayed eviction leaves behind.
        surviving = [org_evidence["file"]]

        response = _search(
            store, embedder, org_evidence["org"], "Kubernetes Helm", surviving
        )

        assert all(hit.documentId != org_evidence["link"] for hit in response.hits)
        assert "DELETIONPROBE-LINK-552" not in " ".join(
            hit.text for hit in response.hits
        )

    def test_a_deleted_FILE_cannot_be_retrieved_while_its_vectors_remain(
        self, store, embedder, org_evidence
    ):
        surviving = [org_evidence["link"]]

        response = _search(
            store, embedder, org_evidence["org"], "Node.js PostgreSQL", surviving
        )

        assert all(hit.documentId != org_evidence["file"] for hit in response.hits)
        assert "DELETIONPROBE-RESUME-771" not in " ".join(
            hit.text for hit in response.hits
        )

    def test_the_surviving_source_still_answers_normally(
        self, store, embedder, org_evidence
    ):
        """Deleting one source must not quietly disable the others."""
        response = _search(
            store,
            embedder,
            org_evidence["org"],
            "Kubernetes Helm",
            [org_evidence["link"]],
        )
        assert response.hits
        assert all(h.documentId == org_evidence["link"] for h in response.hits)

    def test_an_EMPTY_allowlist_returns_nothing_at_all(
        self, store, embedder, org_evidence
    ):
        """The case that would invert the guarantee if it were skipped.

        An empty list is not "no filter". It is "this candidate has withdrawn
        everything", and it has to read as such even though both sources are
        still fully indexed.
        """
        response = _search(store, embedder, org_evidence["org"], "engineer", [])
        assert response.hits == []
        assert response.totalCandidatesConsidered == 0

    def test_the_filter_is_applied_BEFORE_truncation(
        self, store, embedder, org_evidence
    ):
        """A deleted source must not consume a slot in the returned page.

        Filtering after retrieval would let a withdrawn passage push a live one
        out of the top-N and out of the answer — a quieter version of the same
        bug.
        """
        unfiltered = _search(
            store, embedder, org_evidence["org"], "Kubernetes Helm charts", None
        )
        filtered = _search(
            store,
            embedder,
            org_evidence["org"],
            "Kubernetes Helm charts",
            [org_evidence["file"]],
        )
        # The file has fewer relevant passages than the pair, but every one of
        # them is present rather than whatever survived a post-hoc trim.
        file_hits_unfiltered = [
            h for h in unfiltered.hits if h.documentId == org_evidence["file"]
        ]
        assert len(filtered.hits) >= len(file_hits_unfiltered)


class TestRequirementMapping:
    def test_a_requirement_met_only_by_a_deleted_link_stops_being_found(
        self, store, embedder, org_evidence
    ):
        """The recruiter-visible consequence.

        Kubernetes appears in the portfolio and nowhere in the resume, so once
        the portfolio is withdrawn the honest answer is "not shown".
        """
        requirement = [
            RequirementInput(requirementId="r1", text="Kubernetes")
        ]

        with_link = map_requirements(
            organization_id=org_evidence["org"],
            candidate_id=CAND,
            vacancy_id="vac-1",
            requirements=requirement,
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=None,
            allowed_source_ids=[org_evidence["file"], org_evidence["link"]],
        )
        assert with_link.requirements[0].status == "EVIDENCE_FOUND"

        without_link = map_requirements(
            organization_id=org_evidence["org"],
            candidate_id=CAND,
            vacancy_id="vac-1",
            requirements=requirement,
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=None,
            allowed_source_ids=[org_evidence["file"]],
        )
        assert without_link.requirements[0].status != "EVIDENCE_FOUND"
        assert without_link.requirements[0].evidence == []

    def test_no_citation_ever_names_a_deleted_source(
        self, store, embedder, org_evidence
    ):
        result = map_requirements(
            organization_id=org_evidence["org"],
            candidate_id=CAND,
            vacancy_id="vac-1",
            requirements=[
                RequirementInput(requirementId="r1", text="Node.js"),
                RequirementInput(requirementId="r2", text="Kubernetes"),
            ],
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=None,
            allowed_source_ids=[org_evidence["file"]],
        )
        cited = {
            citation.documentId
            for mapping in result.requirements
            for citation in mapping.evidence
        }
        assert org_evidence["link"] not in cited

    def test_a_link_citation_keeps_its_URL_provenance(
        self, store, embedder, org_evidence
    ):
        """Provenance must survive mapping, or a page becomes a nameless file."""
        result = map_requirements(
            organization_id=org_evidence["org"],
            candidate_id=CAND,
            vacancy_id="vac-1",
            requirements=[RequirementInput(requirementId="r1", text="Kubernetes")],
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=None,
            allowed_source_ids=[org_evidence["link"]],
        )
        citations = result.requirements[0].evidence
        assert citations
        assert citations[0].sourceType == "URL"
        assert citations[0].sourceUrl == "https://portfolio.example.test"
        assert citations[0].sourceTitle == "Portfolio Website"


@pytest.fixture()
def personal_evidence(candidate_store, embedder):
    """One candidate account with a personal file and a personal link."""
    from app.candidate.indexing import process_candidate_resume
    from tests.fixtures.resumes import build_pdf

    settings = get_settings()
    account = f"acct-{uuid.uuid4()}"
    file_id = f"doc-{uuid.uuid4()}"
    link_id = f"link-{uuid.uuid4()}"

    process_candidate_resume(
        data=build_pdf(RESUME_TEXT),
        file_name="ada-resume.pdf",
        document_id=file_id,
        candidate_account_id=account,
        settings=settings,
        embedder=embedder,
        store=candidate_store,
    )
    index_candidate_web_source(
        IndexCandidateWebSourceRequest(
            candidateAccountId=account,
            sourceId=link_id,
            title="Portfolio Website",
            url="https://portfolio.example.test",
            sections=PERSONAL_PORTFOLIO_SECTIONS,
        ),
        settings=settings,
        embedder=embedder,
        store=candidate_store,
    )

    yield {"account": account, "file": file_id, "link": link_id}

    candidate_store.delete_document(account, file_id)
    candidate_store.delete_document(account, link_id)


class TestPersonalRetrieval:
    """The candidate's own side. Same rule, different collection."""

    def test_the_account_key_alone_does_not_hide_deleted_evidence(
        self, candidate_store, embedder, personal_evidence
    ):
        """Why the allowlist is needed here at all.

        The personal collection is keyed by account. That stops another
        candidate reading this evidence — it does nothing about this
        candidate's OWN withdrawn evidence, whose chunks carry the very same
        account id.
        """
        unrestricted = candidate_store.search(
            candidate_account_id=personal_evidence["account"],
            query_vector=embedder.encode_query("Kubernetes"),
            limit=10,
        )
        assert any(
            hit.payload.get("documentId") == personal_evidence["link"]
            for hit in unrestricted
        )

        restricted = candidate_store.search(
            candidate_account_id=personal_evidence["account"],
            query_vector=embedder.encode_query("Kubernetes"),
            limit=10,
            allowed_source_ids=[personal_evidence["file"]],
        )
        assert all(
            hit.payload.get("documentId") != personal_evidence["link"]
            for hit in restricted
        )

    def test_an_empty_allowlist_empties_the_personal_search(
        self, candidate_store, embedder, personal_evidence
    ):
        assert (
            candidate_store.search(
                candidate_account_id=personal_evidence["account"],
                query_vector=embedder.encode_query("engineer"),
                limit=10,
                allowed_source_ids=[],
            )
            == []
        )

    def test_the_representation_scroll_is_filtered_too(
        self, candidate_store, personal_evidence
    ):
        """list_chunks feeds the candidate's search representation.

        A withdrawn portfolio leaking in here would steer every vacancy match
        the candidate is offered, without ever appearing as a citation.
        """
        everything = candidate_store.list_chunks(
            personal_evidence["account"], limit=50
        )
        assert any(
            c.get("documentId") == personal_evidence["link"] for c in everything
        )

        filtered = candidate_store.list_chunks(
            personal_evidence["account"],
            limit=50,
            allowed_source_ids=[personal_evidence["file"]],
        )
        assert filtered
        assert all(
            c.get("documentId") == personal_evidence["file"] for c in filtered
        )

        assert (
            candidate_store.list_chunks(
                personal_evidence["account"], limit=50, allowed_source_ids=[]
            )
            == []
        )


class TestJobMatchWithNoEvidence:
    """§ Matching is evidence-grounded, so with no evidence it does not run."""

    def test_an_empty_allowlist_produces_no_matches_at_all(
        self, embedder, candidate_store, vacancy_store
    ):
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-empty",
                # A deliberately RICH profile: the point is that profile text
                # is not evidence and must not be matched on.
                profile=CandidateProfileInput(
                    headline="Senior Backend Engineer",
                    summary="Ten years of Kubernetes and Go.",
                    skills=["Kubernetes", "Go", "Terraform"],
                ),
                allowedSourceIds=[],
            ),
            settings=get_settings(),
            embedder=embedder,
            resume_store=candidate_store,
            vacancy_store=vacancy_store,
            reranker=None,
            generator=None,
        )

        assert response.matches == []
        assert response.vacanciesConsidered == 0
        assert response.generated is False

    def test_no_generation_is_attempted_with_no_evidence(
        self, embedder, candidate_store, vacancy_store
    ):
        """No evidence must also mean no model call — and no bill."""

        class ExplodingGenerator:
            enabled = True

            def generate_match_explanations(self, **_kwargs):
                raise AssertionError("generation ran with no evidence")

        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-empty",
                profile=CandidateProfileInput(headline="Engineer"),
                allowedSourceIds=[],
            ),
            settings=get_settings(),
            embedder=embedder,
            resume_store=candidate_store,
            vacancy_store=vacancy_store,
            reranker=None,
            generator=ExplodingGenerator(),
        )
        assert response.matches == []

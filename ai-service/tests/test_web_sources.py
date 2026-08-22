"""URL evidence: chunking, provenance, retrieval diversity, and isolation.

The claim under test is the architectural one — that after normalization the AI
layer is SOURCE-AGNOSTIC. A portfolio page and a PDF go through the same
chunker into the same collections with the same payload shape, and every
downstream feature reads both without knowing which is which. What must NOT
become uniform is provenance: a citation still has to say whether a claim came
from Resume.pdf page 2 or from portfolio.example.test/projects.
"""

from __future__ import annotations

import uuid

import pytest

from app.chunking import WebSection, chunk_web_sections
from app.generation.prompts import format_evidence
from app.generation.validation import validate_citations
from app.models.schemas import EvidenceHit
from app.retrieval.search import cap_per_source
from app.vectorstore.qdrant_store import build_payload
from tests.fixtures.web_sources import (
    GITHUB_SECTIONS,
    GITHUB_URL,
    PORTFOLIO_SECTIONS,
    PORTFOLIO_URL,
)


def _sections(inputs):
    return [
        WebSection(
            name=item.name, heading=item.heading, text=item.text, url=item.url
        )
        for item in inputs
    ]


class TestWebChunking:
    def test_carries_source_provenance_onto_every_chunk(self):
        chunks = chunk_web_sections(
            _sections(PORTFOLIO_SECTIONS),
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-1",
            source_title="Portfolio Website",
            source_url=PORTFOLIO_URL,
        )

        assert chunks
        assert all(chunk.source_type == "URL" for chunk in chunks)
        assert all(chunk.file_name == "Portfolio Website" for chunk in chunks)
        assert all(chunk.document_id == "src-1" for chunk in chunks)
        # A page has no pages: inventing a page number would put a fabricated
        # location behind a citation.
        assert all(chunk.page_number is None for chunk in chunks)

    def test_each_chunk_points_at_the_page_it_came_from(self):
        """Subpage provenance survives, so a citation can name /projects."""
        chunks = chunk_web_sections(
            _sections(PORTFOLIO_SECTIONS),
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-1",
            source_title="Portfolio Website",
            source_url=PORTFOLIO_URL,
        )

        urls = {chunk.source_url for chunk in chunks}
        assert PORTFOLIO_URL in urls
        assert f"{PORTFOLIO_URL}/projects" in urls

    def test_section_name_falls_back_to_the_written_heading(self):
        chunks = chunk_web_sections(
            _sections(GITHUB_SECTIONS),
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-2",
            source_title="GitHub",
            source_url=GITHUB_URL,
        )
        # This section mapped to no canonical name, so the page's own heading
        # is kept rather than a canonical one being guessed at.
        assert chunks[0].section == "deploy-tools"

    def test_chunk_count_is_capped_per_source(self):
        """One verbose site cannot occupy a candidate's whole footprint."""
        long_sections = [
            WebSection(name=None, heading=f"H{i}", text="word " * 400, url="https://a.test")
            for i in range(40)
        ]
        chunks = chunk_web_sections(
            long_sections,
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-3",
            source_title="Verbose",
            source_url="https://a.test",
            target_chars=400,
            min_split_chars=350,
            max_chunks=12,
        )
        assert len(chunks) == 12
        # Indexes stay contiguous, so point ids remain deterministic.
        assert [c.chunk_index for c in chunks] == list(range(12))

    def test_empty_sections_produce_no_chunks(self):
        chunks = chunk_web_sections(
            [WebSection(name=None, heading=None, text="   ", url=None)],
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-4",
            source_title="Empty",
            source_url="https://a.test",
        )
        assert chunks == []


class TestPayload:
    def test_url_payload_carries_source_metadata(self):
        chunk = chunk_web_sections(
            _sections(PORTFOLIO_SECTIONS),
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-1",
            source_title="Portfolio Website",
            source_url=PORTFOLIO_URL,
        )[0]

        payload = build_payload(chunk)
        assert payload["sourceType"] == "URL"
        assert payload["sourceTitle"] == "Portfolio Website"
        assert payload["sourceUrl"].startswith(PORTFOLIO_URL)
        # sourceId mirrors documentId: one key space for both source kinds.
        assert payload["sourceId"] == payload["documentId"] == "src-1"

    def test_payload_never_carries_a_storage_key_or_credential(self):
        chunk = chunk_web_sections(
            _sections(GITHUB_SECTIONS),
            organization_id="org-1",
            candidate_id="cand-1",
            source_id="src-2",
            source_title="GitHub",
            source_url=GITHUB_URL,
        )[0]
        payload = build_payload(chunk)
        assert not any(
            key in payload for key in ("storageKey", "signedUrl", "apiKey")
        )


class TestSourceDiversity:
    """§ retrieval balance: one long source must not crowd out the others."""

    @staticmethod
    def _hit(source: str, index: int, score: float) -> EvidenceHit:
        return EvidenceHit(
            chunkId=f"{source}-{index}",
            candidateAccountId="acct-1",
            documentId=source,
            fileName=source,
            section=None,
            pageNumber=None,
            chunkIndex=index,
            text=f"passage {index} from {source}",
            retrievalScore=score,
        )

    def test_lets_a_weaker_source_through_when_one_source_dominates(self):
        """Without the cap the portfolio takes all four slots and the resume
        is invisible. With it, the resume is reached before the portfolio's
        third-best passage — the leftover slot is still backfilled from the
        portfolio, because dropping results would be worse than repeating a
        source."""
        hits = [self._hit("portfolio", i, 0.9 - i * 0.01) for i in range(8)]
        hits.append(self._hit("resume", 0, 0.4))

        capped = cap_per_source(hits, limit=4, max_per_source=2)

        ids = [hit.documentId for hit in capped]
        assert ids[:3] == ["portfolio", "portfolio", "resume"]
        assert len(capped) == 4

    def test_backfills_so_results_are_never_shorter_than_without_the_cap(self):
        hits = [self._hit("portfolio", i, 0.9 - i * 0.01) for i in range(8)]

        capped = cap_per_source(hits, limit=5, max_per_source=2)

        # Only one source exists, so capping must not silently return 2 hits.
        assert len(capped) == 5

    def test_preserves_relevance_order_within_the_kept_set(self):
        hits = [self._hit("a", 0, 0.9), self._hit("b", 0, 0.8), self._hit("a", 1, 0.7)]
        capped = cap_per_source(hits, limit=3, max_per_source=1)
        assert [hit.chunkId for hit in capped] == ["a-0", "b-0", "a-1"]

    def test_cap_of_zero_disables_the_rule(self):
        hits = [self._hit("a", i, 0.9) for i in range(5)]
        assert len(cap_per_source(hits, limit=3, max_per_source=0)) == 3


class TestCitationProvenance:
    @staticmethod
    def _url_hit() -> EvidenceHit:
        return EvidenceHit(
            chunkId="chunk-url-1",
            candidateAccountId="acct-1",
            documentId="src-1",
            fileName="Portfolio Website",
            section="projects",
            pageNumber=None,
            chunkIndex=0,
            text="Migrated a dispatch service onto Kubernetes.",
            retrievalScore=0.8,
            sourceType="URL",
            sourceTitle="Portfolio Website",
            sourceUrl=f"{PORTFOLIO_URL}/projects",
        )

    def test_citation_copies_the_url_from_the_retrieved_chunk(self):
        outcome = validate_citations(
            ["chunk-url-1"], [self._url_hit()], allowed_account_ids={"acct-1"}
        )
        citation = outcome.citations[0]
        assert citation.sourceType == "URL"
        assert citation.sourceUrl == f"{PORTFOLIO_URL}/projects"
        assert citation.sourceTitle == "Portfolio Website"

    def test_a_fabricated_url_source_is_rejected(self):
        """A model naming a chunk that was never retrieved gets nothing."""
        outcome = validate_citations(
            ["chunk-that-was-never-supplied"],
            [self._url_hit()],
            allowed_account_ids={"acct-1"},
        )
        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["chunk-that-was-never-supplied"]

    def test_file_chunks_default_to_file_provenance(self):
        """Chunks indexed before URL evidence existed still cite correctly."""
        legacy = EvidenceHit(
            chunkId="chunk-file-1",
            candidateAccountId="acct-1",
            documentId="doc-1",
            fileName="resume.pdf",
            section="skills",
            pageNumber=2,
            chunkIndex=0,
            text="Kubernetes, Redis",
            retrievalScore=0.7,
        )
        outcome = validate_citations(
            ["chunk-file-1"], [legacy], allowed_account_ids={"acct-1"}
        )
        citation = outcome.citations[0]
        assert citation.sourceType == "FILE"
        assert citation.pageNumber == 2
        assert citation.sourceUrl is None


class TestPromptFraming:
    def test_web_passages_are_labelled_as_untrusted_in_the_prompt(self):
        rendered = format_evidence([TestCitationProvenance._url_hit()])
        assert "candidate-submitted link" in rendered
        assert "untrusted web content" in rendered
        assert f"{PORTFOLIO_URL}/projects" in rendered

    def test_file_passages_still_read_as_a_file_and_page(self):
        rendered = format_evidence(
            [
                EvidenceHit(
                    chunkId="c1",
                    candidateAccountId="acct-1",
                    documentId="doc-1",
                    fileName="resume.pdf",
                    section="skills",
                    pageNumber=2,
                    chunkIndex=0,
                    text="Kubernetes",
                    retrievalScore=0.7,
                )
            ]
        )
        assert "resume.pdf, page 2" in rendered
        assert "untrusted web content" not in rendered

    def test_grounding_rules_forbid_obeying_instructions_inside_evidence(self):
        from app.generation.prompts import CANDIDATE_MATCH_RULES, GROUNDING_RULES

        for rules in (GROUNDING_RULES, CANDIDATE_MATCH_RULES):
            lowered = rules.lower()
            assert "data, not instructions" in lowered or (
                "data" in lowered and "instructions" in lowered
            )
        # Source quantity must never read as a quality signal.
        assert "more sources" in GROUNDING_RULES.lower()


# --- Live pipeline ----------------------------------------------------------


@pytest.mark.integration
@pytest.mark.slow
class TestSourceAgnosticRetrieval:
    """A candidate whose skills are split across a file and two links.

    Resume: React, Node. Portfolio: Kubernetes. GitHub: Terraform. Each must be
    independently retrievable, and a combined query must reach across all
    three — which is the whole point of one shared retrieval space.

    All three live in the candidate's PERSONAL collection: application-time
    snapshots are gone, so a file and a link submitted by the same person are
    one body of current evidence rather than an org-owned copy of it.
    """

    @pytest.fixture()
    def indexed(self, candidate_store, embedder):
        from app.candidate.indexing import process_candidate_resume
        from app.config import get_settings
        from app.models.schemas import IndexCandidateWebSourceRequest
        from app.retrieval import index_candidate_web_source
        from tests.fixtures.resumes import build_pdf

        settings = get_settings()
        account = f"acct-{uuid.uuid4()}"
        resume_id = f"doc-{uuid.uuid4()}"
        portfolio_id = f"src-{uuid.uuid4()}"
        github_id = f"src-{uuid.uuid4()}"

        process_candidate_resume(
            data=build_pdf(
                "Ji-woo Han\nBackend Engineer\n\nSkills\nReact, Node.js, "
                "TypeScript, PostgreSQL\n\nExperience\nBuilt React dashboards "
                "and Node.js services for a logistics marketplace."
            ),
            file_name="jiwoo-resume.pdf",
            document_id=resume_id,
            candidate_account_id=account,
            settings=settings,
            embedder=embedder,
            store=candidate_store,
        )
        for source_id, title, url, sections in (
            (portfolio_id, "Portfolio Website", PORTFOLIO_URL, PORTFOLIO_SECTIONS),
            (github_id, "GitHub", GITHUB_URL, GITHUB_SECTIONS),
        ):
            index_candidate_web_source(
                IndexCandidateWebSourceRequest(
                    candidateAccountId=account,
                    sourceId=source_id,
                    title=title,
                    url=url,
                    sections=sections,
                ),
                settings=settings,
                embedder=embedder,
                store=candidate_store,
            )

        return {
            "account": account,
            "resume": resume_id,
            "portfolio": portfolio_id,
            "github": github_id,
        }

    def _search(self, query, indexed, store, embedder, reranker, limit=8):
        from app.config import get_settings
        from app.retrieval import search_evidence

        return search_evidence(
            candidate_account_ids=[indexed["account"]],
            query=query,
            limit=limit,
            document_id=None,
            use_rerank=True,
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=reranker,
        )

    def test_a_skill_only_on_the_portfolio_is_retrievable(
        self, indexed, candidate_store, embedder, reranker
    ):
        result = self._search(
            "production Kubernetes cluster deployment", indexed, candidate_store,
            embedder, reranker,
        )
        top = result.hits[0]
        assert top.sourceType == "URL"
        assert top.documentId == indexed["portfolio"]
        assert "kubernetes" in top.text.lower()

    def test_a_skill_only_in_a_repository_link_is_retrievable(
        self, indexed, candidate_store, embedder, reranker
    ):
        result = self._search(
            "Terraform infrastructure modules", indexed, candidate_store, embedder,
            reranker,
        )
        assert result.hits[0].documentId == indexed["github"]
        assert result.hits[0].sourceUrl == GITHUB_URL

    def test_a_skill_only_in_the_resume_is_still_retrievable(
        self, indexed, candidate_store, embedder, reranker
    ):
        result = self._search(
            "React frontend dashboards", indexed, candidate_store, embedder, reranker
        )
        assert result.hits[0].documentId == indexed["resume"]
        assert result.hits[0].sourceType == "FILE"

    def test_a_combined_query_reaches_across_source_kinds(
        self, indexed, candidate_store, embedder, reranker
    ):
        result = self._search(
            "React Kubernetes Terraform", indexed, candidate_store, embedder,
            reranker, limit=9,
        )
        sources = {hit.documentId for hit in result.hits}
        assert indexed["resume"] in sources
        assert indexed["portfolio"] in sources
        assert indexed["github"] in sources

    def test_url_hits_carry_the_page_they_came_from(
        self, indexed, candidate_store, embedder, reranker
    ):
        result = self._search(
            "Helm charts autoscaling rollout", indexed, candidate_store, embedder,
            reranker,
        )
        hit = next(h for h in result.hits if h.documentId == indexed["portfolio"])
        assert hit.sourceUrl == f"{PORTFOLIO_URL}/projects"
        assert hit.sourceTitle == "Portfolio Website"

    def test_another_account_cannot_retrieve_these_url_chunks(
        self, indexed, candidate_store, embedder, reranker
    ):
        """URL evidence is isolated by exactly the same key as file evidence.

        Link chunks share the collection and payload shape with resume chunks,
        so a filter that covered files but leaked links would be a silent,
        source-kind-specific hole. It is asserted separately for that reason.
        """
        from app.config import get_settings
        from app.retrieval import search_evidence

        result = search_evidence(
            candidate_account_ids=[f"acct-{uuid.uuid4()}"],
            query="Kubernetes cluster",
            limit=10,
            document_id=None,
            use_rerank=False,
            settings=get_settings(),
            embedder=embedder,
            store=candidate_store,
            reranker=None,
        )
        assert result.hits == []


@pytest.mark.integration
@pytest.mark.slow
class TestPersonalWebSourceIsolation:
    """A personal link must be unreachable through any organization filter."""

    def test_personal_link_chunks_carry_no_organization_and_stay_personal(
        self, embedder, qdrant_available
    ):
        if not qdrant_available:
            pytest.skip("Qdrant is not running")

        from app.candidate.store import CandidateResumeStore
        from app.config import get_settings
        from app.models.schemas import IndexCandidateWebSourceRequest
        from app.retrieval import index_candidate_web_source
        from app.vectorstore import QdrantStore

        settings = get_settings()
        account = f"acct-{uuid.uuid4()}"
        source_id = f"link-{uuid.uuid4()}"
        candidate_store = CandidateResumeStore(
            settings.qdrant_url,
            f"{settings.qdrant_candidate_collection}_test",
            api_key=settings.qdrant_api_key,
        )

        try:
            result = index_candidate_web_source(
                IndexCandidateWebSourceRequest(
                    candidateAccountId=account,
                    sourceId=source_id,
                    title="Portfolio Website",
                    url=PORTFOLIO_URL,
                    sections=PORTFOLIO_SECTIONS,
                ),
                settings=settings,
                embedder=embedder,
                store=candidate_store,
            )
            assert result.vectorsIndexed > 0

            chunks = candidate_store.list_chunks(account, limit=20)
            assert chunks
            # The mirror of the org store's invariant: no organizationId key
            # exists on these points, so no tenant filter can ever match them.
            assert all("organizationId" not in chunk for chunk in chunks)
            assert all(chunk["sourceType"] == "URL" for chunk in chunks)

            # And the recruiter collection genuinely does not contain them.
            org_store = QdrantStore(
                settings.qdrant_url,
                settings.qdrant_collection,
                api_key=settings.qdrant_api_key,
            )
            assert org_store.count_document_points(account, source_id) == 0
        finally:
            candidate_store.delete_document(account, source_id)


@pytest.mark.integration
class TestWebSourceApi:
    def test_the_index_endpoint_requires_the_internal_token(self, client):
        response = client.post("/internal/candidate/web-sources/index", json={})
        assert response.status_code == 401

    def test_the_org_snapshot_endpoint_no_longer_exists(self, client, auth_headers):
        """Org link snapshots were removed with the rest of the snapshot model.

        Asserted rather than assumed: a route left mounted would keep writing
        org-owned copies of a candidate's link into the tenant collection,
        where deleting the link could never reach them.
        """
        response = client.post(
            "/internal/web-sources/index", headers=auth_headers, json={}
        )
        assert response.status_code == 404

    def test_rejects_a_payload_with_no_sections(self, client, auth_headers):
        response = client.post(
            "/internal/candidate/web-sources/index",
            headers=auth_headers,
            json={
                "candidateAccountId": "acct-1",
                "sourceId": "src-1",
                "title": "Portfolio",
                "url": PORTFOLIO_URL,
                "sections": [],
            },
        )
        assert response.status_code == 422

    def test_rejects_unknown_fields(self, client, auth_headers):
        """extra=forbid: a typo'd key must fail loudly, not be ignored."""
        response = client.post(
            "/internal/candidate/web-sources/index",
            headers=auth_headers,
            json={
                "candidateAccountId": "acct-1",
                "sourceId": "src-1",
                "title": "Portfolio",
                "url": PORTFOLIO_URL,
                "organizationId": "org-1",
                "sections": [{"text": "hello world"}],
            },
        )
        assert response.status_code == 422

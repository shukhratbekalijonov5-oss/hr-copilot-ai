"""JD requirement -> evidence mapping.

Unit tests cover the classification policy in isolation; the integration class
at the bottom runs the whole thing against real Qdrant and the real models,
which is what actually proves the §48 Test 4 scenario.
"""

from __future__ import annotations

import uuid

import pytest

from app.mapping import (
    EVIDENCE_FOUND,
    NEEDS_HUMAN_REVIEW,
    NO_EVIDENCE_FOUND,
    MappingThresholds,
    classify_requirement,
    extract_terms,
    lexical_coverage,
)
from app.models.schemas import EvidenceHit


def hit(text: str, score: float = 0.5, chunk_id: str | None = None):
    return EvidenceHit(
        chunkId=chunk_id or f"chunk-{uuid.uuid4()}",
        candidateAccountId="acct-1",
        documentId="doc-1",
        fileName="resume.pdf",
        section="experience",
        pageNumber=1,
        chunkIndex=0,
        text=text,
        retrievalScore=score,
        rerankScore=score,
    )


class TestTermExtraction:
    def test_drops_filler_words(self):
        assert extract_terms("5+ years of production Kubernetes experience") == [
            "kubernetes"
        ]

    def test_keeps_technology_punctuation(self):
        terms = extract_terms("Node.js, C++ and CI/CD")
        assert "node.js" in terms
        assert "c++" in terms

    def test_drops_bare_numbers(self):
        assert "5" not in extract_terms("5 years")

    def test_deduplicates(self):
        assert extract_terms("Kubernetes and Kubernetes") == ["kubernetes"]

    def test_a_requirement_of_only_filler_yields_nothing(self):
        assert extract_terms("strong professional experience") == []


class TestLexicalCoverage:
    def test_full_coverage(self):
        cov, matched, missing = lexical_coverage(
            ["kubernetes"], ["Migrated to a production Kubernetes cluster"]
        )
        assert cov == 1.0 and matched == ["kubernetes"] and missing == []

    def test_no_coverage(self):
        cov, _, missing = lexical_coverage(["aws"], ["Kubernetes and Redis work"])
        assert cov == 0.0 and missing == ["aws"]

    def test_partial_coverage(self):
        cov, matched, missing = lexical_coverage(
            ["kafka", "streams"], ["Skills: Kafka, Redis, Go"]
        )
        assert cov == 0.5 and matched == ["kafka"] and missing == ["streams"]

    def test_does_not_match_inside_a_longer_word(self):
        """'go' must not match 'algorithm'."""
        cov, _, _ = lexical_coverage(["go"], ["algorithms and algorithmic design"])
        assert cov == 0.0

    def test_matches_a_dotted_technology_name(self):
        cov, _, _ = lexical_coverage(["node.js"], ["Backend work in Node.js"])
        assert cov == 1.0

    def test_is_case_insensitive(self):
        cov, _, _ = lexical_coverage(["kubernetes"], ["KUBERNETES operations"])
        assert cov == 1.0


class TestClassification:
    def test_evidence_found_when_terms_appear(self):
        result = classify_requirement(
            requirement_id="r1",
            requirement_text="Production Kubernetes experience",
            hits=[hit("Led migration to a production Kubernetes cluster", 0.2)],
        )
        assert result.status == EVIDENCE_FOUND
        assert result.evidence

    def test_no_evidence_when_nothing_matches(self):
        """The headline case: AWS must not be inferred from Kubernetes."""
        result = classify_requirement(
            requirement_id="r2",
            requirement_text="AWS production experience",
            hits=[hit("Led migration to a production Kubernetes cluster", 0.04)],
        )
        assert result.status == NO_EVIDENCE_FOUND
        assert result.evidence == []
        assert "aws" in result.missing_terms

    def test_partial_match_needs_human_review(self):
        result = classify_requirement(
            requirement_id="r3",
            requirement_text="Kafka Streams stateful processing",
            hits=[hit("Skills: TypeScript, Kafka, Redis", 0.02)],
        )
        assert result.status == NEEDS_HUMAN_REVIEW
        assert "kafka" in result.matched_terms
        assert "streams" in result.missing_terms

    def test_high_semantic_score_with_no_lexical_match_escalates(self):
        """Safety net for synonyms and other languages."""
        result = classify_requirement(
            requirement_id="r4",
            requirement_text="Container orchestration",
            hits=[hit("쿠버네티스 클러스터를 운영했습니다", 0.85)],
        )
        assert result.status == NEEDS_HUMAN_REVIEW

    def test_no_hits_is_no_evidence(self):
        result = classify_requirement(
            requirement_id="r5", requirement_text="Anything", hits=[]
        )
        assert result.status == NO_EVIDENCE_FOUND
        assert result.evidence == []

    def test_never_returns_a_score_or_percentage(self):
        result = classify_requirement(
            requirement_id="r6",
            requirement_text="Production Kubernetes experience",
            hits=[hit("production Kubernetes cluster", 0.9)],
        )
        payload = vars(result)
        for banned in ("fit", "percentage", "rating", "score_percent", "quality"):
            assert banned not in payload

    def test_thresholds_are_configurable(self):
        strict = MappingThresholds(lexical_found=1.0)
        result = classify_requirement(
            requirement_id="r7",
            requirement_text="Kafka Streams",
            hits=[hit("Skills: Kafka", 0.5)],
            thresholds=strict,
        )
        assert result.status == NEEDS_HUMAN_REVIEW

    def test_evidence_prefers_the_passage_naming_the_technology(self):
        unrelated = hit("General backend engineering work", 0.9, chunk_id="c-unrelated")
        naming = hit("Operated a production Kubernetes cluster", 0.1, chunk_id="c-k8s")

        result = classify_requirement(
            requirement_id="r8",
            requirement_text="Kubernetes",
            hits=[unrelated, naming],
        )
        assert result.evidence[0].chunkId == "c-k8s"

    def test_reason_explains_the_decision(self):
        result = classify_requirement(
            requirement_id="r9",
            requirement_text="AWS experience",
            hits=[hit("Kubernetes work", 0.01)],
        )
        assert "aws" in result.reason.lower()


@pytest.mark.integration
@pytest.mark.slow
class TestRealJdMapping:
    """§48 Test 4 against real Qdrant, real embeddings and the real reranker."""

    @pytest.fixture()
    def indexed(self, candidate_store, embedder):
        """The candidate's own CURRENT evidence.

        Mapping reads the personal collection now — a requirement is judged
        against what this person actually has on file today, not against an
        org-owned copy taken when they applied.
        """
        from app.candidate.indexing import process_candidate_resume
        from app.config import get_settings
        from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_pdf

        account = f"acct-{uuid.uuid4()}"
        doc = f"doc-{uuid.uuid4()}"
        process_candidate_resume(
            data=build_pdf(JIWOO_HAN_TEXT),
            file_name="jiwoo-han.pdf",
            document_id=doc,
            candidate_account_id=account,
            settings=get_settings(),
            embedder=embedder,
            store=candidate_store,
        )
        return {"account": account, "doc": doc}

    def _map(self, store, embedder, reranker, account, requirements):
        from app.config import get_settings
        from app.mapping import map_requirements
        from app.models.schemas import RequirementInput

        return map_requirements(
            candidate_account_id=account,
            vacancy_id="vac-1",
            requirements=[
                RequirementInput(requirementId=f"r{i}", text=t)
                for i, t in enumerate(requirements)
            ],
            settings=get_settings(),
            embedder=embedder,
            store=store,
            reranker=reranker,
        )

    def test_the_headline_scenario(self, candidate_store, embedder, reranker, indexed):
        result = self._map(
            candidate_store, embedder, reranker, indexed["account"],
            ["NestJS", "Redis Pub/Sub", "Production Kubernetes experience",
             "AWS production experience"],
        )
        statuses = {m.requirementText: m.status for m in result.requirements}

        assert statuses["NestJS"] == EVIDENCE_FOUND
        assert statuses["Redis Pub/Sub"] == EVIDENCE_FOUND
        assert statuses["Production Kubernetes experience"] == EVIDENCE_FOUND
        assert statuses["AWS production experience"] == NO_EVIDENCE_FOUND

    def test_the_response_names_the_account_it_answered_about(
        self, candidate_store, embedder, reranker, indexed
    ):
        """The subject is echoed back as an ACCOUNT id, not an org-side one.

        The caller correlates this response with the applicant it asked about;
        answering with a key from a different id space would let a mapping be
        filed against the wrong person.
        """
        result = self._map(
            candidate_store, embedder, reranker, indexed["account"], ["Kubernetes"]
        )
        assert result.candidateAccountId == indexed["account"]

    def test_absent_requirements_carry_no_evidence(
        self, candidate_store, embedder, reranker, indexed
    ):
        result = self._map(
            candidate_store, embedder, reranker, indexed["account"],
            ["AWS production experience", "Terraform infrastructure as code",
             "Salesforce administration"],
        )
        for mapping in result.requirements:
            assert mapping.status == NO_EVIDENCE_FOUND
            assert mapping.evidence == []

    def test_found_requirements_carry_citable_evidence(
        self, candidate_store, embedder, reranker, indexed
    ):
        result = self._map(
            candidate_store, embedder, reranker, indexed["account"], ["Kubernetes"]
        )
        mapping = result.requirements[0]

        assert mapping.status == EVIDENCE_FOUND
        assert mapping.evidence
        citation = mapping.evidence[0]
        assert citation.chunkId
        assert citation.fileName == "jiwoo-han.pdf"
        assert "kubernetes" in citation.text.lower()

    def test_partial_requirement_is_flagged_for_review(
        self, candidate_store, embedder, reranker, indexed
    ):
        """Resume lists Kafka but never describes stream processing."""
        result = self._map(
            candidate_store, embedder, reranker, indexed["account"],
            ["Kafka Streams stateful processing"],
        )
        assert result.requirements[0].status == NEEDS_HUMAN_REVIEW

    def test_mapping_is_deterministic_across_runs(
        self, candidate_store, embedder, reranker, indexed
    ):
        reqs = ["NestJS", "AWS production experience", "Kubernetes"]
        first = self._map(candidate_store, embedder, reranker, indexed["account"], reqs)
        second = self._map(candidate_store, embedder, reranker, indexed["account"], reqs)

        assert [m.status for m in first.requirements] == [
            m.status for m in second.requirements
        ]

    def test_an_unrelated_account_gets_no_evidence(
        self, candidate_store, embedder, reranker, indexed
    ):
        """Mapping is scoped to exactly one account, and cannot spill.

        This is the isolation property the old tenant test held: asking about
        somebody else must produce "not shown", never this candidate's
        Kubernetes evidence under another person's name.
        """
        result = self._map(
            candidate_store, embedder, reranker, f"acct-other-{uuid.uuid4()}",
            ["Kubernetes"],
        )
        assert result.requirements[0].status == NO_EVIDENCE_FOUND
        assert result.requirements[0].evidence == []

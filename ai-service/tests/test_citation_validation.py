"""Citation integrity (§31).

Fully deterministic — no LLM involved. These are the checks that make a
model-supplied citation trustworthy, so they must hold regardless of what any
model emits.
"""

from __future__ import annotations

from app.generation import scrub_context, validate_citations
from app.models.schemas import EvidenceHit

ORG_A = "org-a"
ORG_B = "org-b"
CAND_1 = "cand-1"
CAND_2 = "cand-2"


def hit(chunk_id: str, *, candidate=CAND_1, doc="doc-1", page=2, text="Kubernetes work"):
    return EvidenceHit(
        chunkId=chunk_id,
        candidateId=candidate,
        documentId=doc,
        fileName="resume.pdf",
        section="experience",
        pageNumber=page,
        chunkIndex=0,
        text=text,
        retrievalScore=0.5,
    )


class TestValidCitations:
    def test_accepts_a_citation_present_in_the_context(self):
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-1"], context, organization_id=ORG_A)

        assert len(outcome.citations) == 1
        assert outcome.citations[0].chunkId == "chunk-1"
        assert not outcome.had_rejections

    def test_metadata_comes_from_the_chunk_not_the_model(self):
        """A hallucinated page number must be overwritten by the true one."""
        context = [hit("chunk-1", page=7, doc="doc-real")]
        outcome = validate_citations(["chunk-1"], context, organization_id=ORG_A)

        citation = outcome.citations[0]
        assert citation.pageNumber == 7
        assert citation.documentId == "doc-real"
        assert citation.fileName == "resume.pdf"
        assert citation.text == "Kubernetes work"

    def test_deduplicates_repeated_citations(self):
        context = [hit("chunk-1")]
        outcome = validate_citations(
            ["chunk-1", "chunk-1", "chunk-1"], context, organization_id=ORG_A
        )
        assert len(outcome.citations) == 1

    def test_preserves_the_order_the_model_cited(self):
        context = [hit("a"), hit("b"), hit("c")]
        outcome = validate_citations(["c", "a"], context, organization_id=ORG_A)

        assert [c.chunkId for c in outcome.citations] == ["c", "a"]


class TestRejectedCitations:
    def test_rejects_a_chunk_id_that_does_not_exist(self):
        """The core anti-hallucination check."""
        context = [hit("chunk-1")]
        outcome = validate_citations(
            ["chunk-does-not-exist"], context, organization_id=ORG_A
        )

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["chunk-does-not-exist"]

    def test_rejects_a_real_id_that_was_not_in_this_context(self):
        """An id from a previous request must not be citable in this one."""
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-from-another-query"], context, organization_id=ORG_A)

        assert outcome.citations == []
        assert outcome.had_rejections

    def test_rejects_a_citation_about_another_candidate(self):
        context = [hit("chunk-1", candidate=CAND_1), hit("chunk-2", candidate=CAND_2)]
        outcome = validate_citations(
            ["chunk-2"], context, organization_id=ORG_A, candidate_id=CAND_1
        )

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["chunk-2"]

    def test_keeps_valid_citations_when_some_are_rejected(self):
        context = [hit("chunk-1")]
        outcome = validate_citations(
            ["chunk-1", "invented"], context, organization_id=ORG_A
        )

        assert [c.chunkId for c in outcome.citations] == ["chunk-1"]
        assert outcome.rejected_chunk_ids == ["invented"]

    def test_ignores_empty_ids(self):
        outcome = validate_citations(["", None or ""], [hit("chunk-1")], organization_id=ORG_A)
        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == []

    def test_no_citations_when_context_is_empty(self):
        outcome = validate_citations(["anything"], [], organization_id=ORG_A)
        assert outcome.citations == []
        assert outcome.had_rejections


class TestContextScrubbing:
    """Last check before resume text leaves the process for a third party."""

    def test_drops_passages_for_another_candidate(self):
        context = [hit("a", candidate=CAND_1), hit("b", candidate=CAND_2)]
        safe = scrub_context(context, organization_id=ORG_A, candidate_id=CAND_1)

        assert [h.chunkId for h in safe] == ["a"]

    def test_keeps_everything_when_no_candidate_filter_applies(self):
        context = [hit("a", candidate=CAND_1), hit("b", candidate=CAND_2)]
        safe = scrub_context(context, organization_id=ORG_A, candidate_id=None)

        assert len(safe) == 2

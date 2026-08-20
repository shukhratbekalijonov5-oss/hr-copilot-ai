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


UUID_A = "aaaaaaa1-1111-4111-8111-111111111111"
UUID_B = "aaaaaaa2-1111-4111-8111-111111111111"
UUID_C = "aaaaaaa3-1111-4111-8111-111111111111"


class TestOrdinalNormalisation:
    """The prompt labels passages "PASSAGE n"; a model citing by that number
    is referencing OUR exact context, so it maps deterministically to the real
    chunkId — and everything else about validation stays as strict as before.
    """

    def test_ordinal_claim_maps_to_the_nth_passage(self):
        context = [hit(UUID_A), hit(UUID_B, text="Redis work")]
        outcome = validate_citations(["2"], context, organization_id=ORG_A)

        assert [c.chunkId for c in outcome.citations] == [UUID_B]
        assert not outcome.had_rejections

    def test_bracketed_ordinal_maps_too(self):
        context = [hit(UUID_A)]
        outcome = validate_citations(["[1]"], context, organization_id=ORG_A)

        assert [c.chunkId for c in outcome.citations] == [UUID_A]

    def test_out_of_range_ordinal_stays_rejected(self):
        context = [hit(UUID_A)]
        outcome = validate_citations(["7"], context, organization_id=ORG_A)

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["7"]

    def test_ordinal_mapping_cannot_bypass_candidate_scoping(self):
        # Passage 1 belongs to another candidate; citing "1" maps to it and
        # is then dropped by the same candidate check as a direct chunkId.
        context = [hit(UUID_A, candidate=CAND_2)]
        outcome = validate_citations(
            ["1"], context, organization_id=ORG_A, candidate_id=CAND_1
        )

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == [UUID_A]


class TestAnswerMarkerReconciliation:
    """The answer prose must agree with the accepted-citation list."""

    def _accepted(self, context, ids):
        return validate_citations(ids, context, organization_id=ORG_A).citations

    def test_accepted_ordinal_marker_becomes_canonical_chunk_id(self):
        from app.generation import reconcile_answer_markers

        context = [hit(UUID_A)]
        accepted = self._accepted(context, [UUID_A])
        answer = reconcile_answer_markers("Uses Kubernetes [1].", context, accepted)

        assert answer == f"Uses Kubernetes [{UUID_A}]."

    def test_marker_without_accepted_citation_is_removed(self):
        from app.generation import reconcile_answer_markers

        context = [hit(UUID_A), hit(UUID_B)]
        accepted = self._accepted(context, [UUID_A])
        answer = reconcile_answer_markers(
            "Good [1] but dangling [2] and out-of-range [9].", context, accepted
        )

        assert f"[{UUID_A}]" in answer
        assert UUID_B not in answer
        assert "[2]" not in answer and "[9]" not in answer

    def test_zero_citations_means_zero_markers(self):
        from app.generation import reconcile_answer_markers

        context = [hit(UUID_A), hit(UUID_B), hit(UUID_C)]
        answer = reconcile_answer_markers(
            f"Claims [1], [2] and [{UUID_C}] with no accepted sources.",
            context,
            [],
        )

        assert "[" not in answer or "[1" not in answer
        assert UUID_A not in answer and UUID_B not in answer and UUID_C not in answer

    def test_unaccepted_uuid_marker_is_removed_accepted_kept(self):
        from app.generation import reconcile_answer_markers

        context = [hit(UUID_A), hit(UUID_B)]
        accepted = self._accepted(context, [UUID_A])
        answer = reconcile_answer_markers(
            f"Kept [{UUID_A}], dropped [{UUID_B}], bare dropped {UUID_B}.",
            context,
            accepted,
        )

        assert f"[{UUID_A}]" in answer
        assert UUID_B not in answer

    def test_prose_brackets_are_untouched(self):
        from app.generation import reconcile_answer_markers

        answer = reconcile_answer_markers(
            "Built [internal tooling] for the team.", [hit(UUID_A)], []
        )

        assert answer == "Built [internal tooling] for the team."

    def test_multi_ordinal_marker_maps_each_accepted_reference(self):
        from app.generation import reconcile_answer_markers

        context = [hit(UUID_A), hit(UUID_B), hit(UUID_C)]
        accepted = self._accepted(context, [UUID_A, UUID_C])
        answer = reconcile_answer_markers("Shown in [1, 3].", context, accepted)

        assert f"[{UUID_A}]" in answer and f"[{UUID_C}]" in answer

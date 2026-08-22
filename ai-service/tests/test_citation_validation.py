"""Citation integrity (§31).

Fully deterministic — no LLM involved. These are the checks that make a
model-supplied citation trustworthy, so they must hold regardless of what any
model emits.

Since evidence snapshots were removed, the membership check is by candidate
ACCOUNT: retrieval runs against the personal collection over an authorized
universe of account ids, so "this passage belongs to somebody I am allowed to
read about" is expressed as ``hit.candidateAccountId in allowed_account_ids``.
``None`` still means "no membership restriction" — the org-wide answer path,
where the caller has no single subject to scope by.
"""

from __future__ import annotations

from app.generation import scrub_context, validate_citations
from app.models.schemas import EvidenceHit

ACCT_1 = "acct-1"
ACCT_2 = "acct-2"


def hit(chunk_id: str, *, account=ACCT_1, doc="doc-1", page=2, text="Kubernetes work"):
    return EvidenceHit(
        chunkId=chunk_id,
        candidateAccountId=account,
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
        outcome = validate_citations(["chunk-1"], context)

        assert len(outcome.citations) == 1
        assert outcome.citations[0].chunkId == "chunk-1"
        assert not outcome.had_rejections

    def test_metadata_comes_from_the_chunk_not_the_model(self):
        """A hallucinated page number must be overwritten by the true one."""
        context = [hit("chunk-1", page=7, doc="doc-real")]
        outcome = validate_citations(["chunk-1"], context)

        citation = outcome.citations[0]
        assert citation.pageNumber == 7
        assert citation.documentId == "doc-real"
        assert citation.fileName == "resume.pdf"
        assert citation.text == "Kubernetes work"

    def test_deduplicates_repeated_citations(self):
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-1", "chunk-1", "chunk-1"], context)
        assert len(outcome.citations) == 1

    def test_preserves_the_order_the_model_cited(self):
        context = [hit("a"), hit("b"), hit("c")]
        outcome = validate_citations(["c", "a"], context)

        assert [c.chunkId for c in outcome.citations] == ["c", "a"]


class TestRejectedCitations:
    def test_rejects_a_chunk_id_that_does_not_exist(self):
        """The core anti-hallucination check."""
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-does-not-exist"], context)

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["chunk-does-not-exist"]

    def test_rejects_a_real_id_that_was_not_in_this_context(self):
        """An id from a previous request must not be citable in this one."""
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-from-another-query"], context)

        assert outcome.citations == []
        assert outcome.had_rejections

    def test_rejects_a_citation_about_an_unauthorized_account(self):
        """The account-isolation half of validation.

        Retrieval already filters to the authorized universe, so a passage
        belonging to anyone else should never be in the context at all. This
        is the second lock on the same door: even handed a passage from
        outside the universe, a citation naming it is dropped.
        """
        context = [hit("chunk-1", account=ACCT_1), hit("chunk-2", account=ACCT_2)]
        outcome = validate_citations(
            ["chunk-2"], context, allowed_account_ids={ACCT_1}
        )

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["chunk-2"]

    def test_accepts_any_account_inside_a_multi_account_universe(self):
        """A recruiter search spans every applicant they may read about.

        The universe is a LIST, so a citation about the second applicant is
        just as valid as one about the first — isolation is the boundary of
        that list, not a single-subject rule.
        """
        context = [hit("chunk-1", account=ACCT_1), hit("chunk-2", account=ACCT_2)]
        outcome = validate_citations(
            ["chunk-1", "chunk-2"], context, allowed_account_ids={ACCT_1, ACCT_2}
        )

        assert [c.chunkId for c in outcome.citations] == ["chunk-1", "chunk-2"]
        assert not outcome.had_rejections

    def test_keeps_valid_citations_when_some_are_rejected(self):
        context = [hit("chunk-1")]
        outcome = validate_citations(["chunk-1", "invented"], context)

        assert [c.chunkId for c in outcome.citations] == ["chunk-1"]
        assert outcome.rejected_chunk_ids == ["invented"]

    def test_ignores_empty_ids(self):
        outcome = validate_citations(["", None or ""], [hit("chunk-1")])
        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == []

    def test_no_citations_when_context_is_empty(self):
        outcome = validate_citations(["anything"], [])
        assert outcome.citations == []
        assert outcome.had_rejections


class TestContextScrubbing:
    """Last check before resume text leaves the process for a third party."""

    def test_drops_passages_for_an_unauthorized_account(self):
        context = [hit("a", account=ACCT_1), hit("b", account=ACCT_2)]
        safe = scrub_context(context, allowed_account_ids={ACCT_1})

        assert [h.chunkId for h in safe] == ["a"]

    def test_keeps_every_account_inside_the_universe(self):
        context = [hit("a", account=ACCT_1), hit("b", account=ACCT_2)]
        safe = scrub_context(context, allowed_account_ids={ACCT_1, ACCT_2})

        assert len(safe) == 2

    def test_an_empty_universe_scrubs_everything(self):
        """An empty set is "nobody is retrievable", not "no filter".

        Treating it as falsy here would hand a third-party API exactly the
        passages the caller was told not to read.
        """
        context = [hit("a", account=ACCT_1), hit("b", account=ACCT_2)]

        assert scrub_context(context, allowed_account_ids=set()) == []

    def test_keeps_everything_when_no_membership_filter_applies(self):
        context = [hit("a", account=ACCT_1), hit("b", account=ACCT_2)]
        safe = scrub_context(context, allowed_account_ids=None)

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
        outcome = validate_citations(["2"], context)

        assert [c.chunkId for c in outcome.citations] == [UUID_B]
        assert not outcome.had_rejections

    def test_bracketed_ordinal_maps_too(self):
        context = [hit(UUID_A)]
        outcome = validate_citations(["[1]"], context)

        assert [c.chunkId for c in outcome.citations] == [UUID_A]

    def test_out_of_range_ordinal_stays_rejected(self):
        context = [hit(UUID_A)]
        outcome = validate_citations(["7"], context)

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == ["7"]

    def test_ordinal_mapping_cannot_bypass_account_scoping(self):
        # Passage 1 belongs to an account outside the universe; citing "1"
        # maps to it and is then dropped by the same membership check as a
        # direct chunkId.
        context = [hit(UUID_A, account=ACCT_2)]
        outcome = validate_citations(["1"], context, allowed_account_ids={ACCT_1})

        assert outcome.citations == []
        assert outcome.rejected_chunk_ids == [UUID_A]


class TestAnswerMarkerReconciliation:
    """The answer prose must agree with the accepted-citation list."""

    def _accepted(self, context, ids):
        return validate_citations(ids, context).citations

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

"""Candidate job matching — deterministic core, with every model faked.

The security-critical properties tested here are STRUCTURAL:

  * the match label is a pure function of requirement coverage;
  * requirement lists are computed BEFORE generation, so the model cannot
    move a requirement into "supported" or invent one;
  * only explanations for vacancy ids we asked about are attached;
  * the resume store is only ever queried with the requesting candidate's
    account id.
"""

from __future__ import annotations

import pytest

from app.candidate.job_match import match_jobs
from app.candidate.ranking import TIER_PARTIAL, TIER_STRONG, tier_for
from app.config import get_settings
from app.generation.client import GenerationFailedError
from app.models.schemas import (
    CandidateProfileInput,
    JobMatchRequest,
    ProfileExperienceInput,
    RequirementCheck,
)
from app.vectorstore.qdrant_store import SearchHit
from tests.fixtures.embedding import FakeEmbedder, embed


def check(required: bool = True) -> RequirementCheck:
    return RequirementCheck(text="x", required=required, reason="")


class TestTierRule:
    """The label is now DERIVED from the score, so the two cannot disagree.

    This replaced a separate requirement-counting table. Two rules that could
    each decide a label independently is one rule too many: they drift, and
    then a match reads "STRONG" next to a low position in the list.
    """

    def test_boundaries_are_inclusive_at_the_bottom_of_each_tier(self):
        assert tier_for(TIER_STRONG) == "STRONG"
        assert tier_for(TIER_STRONG - 1) == "PARTIAL"
        assert tier_for(TIER_PARTIAL) == "PARTIAL"
        assert tier_for(TIER_PARTIAL - 1) == "WEAK"

    def test_the_extremes(self):
        assert tier_for(100) == "STRONG"
        assert tier_for(0) == "WEAK"

    def test_is_monotonic(self):
        """A higher score can never mean a weaker label."""
        order = {"WEAK": 0, "PARTIAL": 1, "STRONG": 2}
        tiers = [order[tier_for(score)] for score in range(0, 101)]
        assert tiers == sorted(tiers)


# --- fakes --------------------------------------------------------------------


class FakeResumeStore:
    """Personal-resume store that records how it was queried."""

    def __init__(self, chunks: list[dict]):
        self.chunks = chunks
        self.queried_accounts: list[str] = []
        #: Every allowlist the pipeline passed, so a test can assert the
        #: surviving-source filter actually reached the store.
        self.allowlists: list[list[str] | None] = []

    def _permitted(self, allowed_source_ids):
        """Mirrors the real store's filter, including the empty-list rule."""
        self.allowlists.append(allowed_source_ids)
        if allowed_source_ids is None:
            return self.chunks
        if len(allowed_source_ids) == 0:
            return []
        return [c for c in self.chunks if c.get("documentId") in allowed_source_ids]

    def search(
        self, *, candidate_account_id, query_vector, limit, allowed_source_ids=None
    ):
        if not candidate_account_id:
            raise ValueError("candidate_account_id is required for every search")
        self.queried_accounts.append(candidate_account_id)
        # Low raw score: whether a requirement is supported must come from the
        # lexical evidence check, not from an inflated retrieval score (which
        # would land in the semantic NEEDS_HUMAN_REVIEW escalation band).
        permitted = self._permitted(allowed_source_ids)
        return [SearchHit(score=0.05, payload=c) for c in permitted[:limit]]

    def list_chunks(
        self, candidate_account_id, limit=12, allowed_source_ids=None, with_vectors=False
    ):
        self.queried_accounts.append(candidate_account_id)
        permitted = self._permitted(allowed_source_ids)[:limit]
        if not with_vectors:
            return permitted
        # A vector per chunk, so the in-process evidence map has something to
        # compare against — the real store returns these too.
        return [{**c, "_vector": embed(c.get("text", ""))} for c in permitted]


class FakeVacancyStore:
    """Vacancy index that records what it was ASKED for.

    `fetch_vacancies` is the production path now: the backend names the
    eligible vacancies and every one of them is scored. `search_open` survives
    only for standalone calls that supply no eligible set.
    """

    def __init__(self, hits: list[SearchHit]):
        self.hits = hits
        self.requested_ids: list[str] | None = None

    def search_open(self, *, query_vector, limit):
        return self.hits[:limit]

    def fetch_vacancies(self, vacancy_ids, *, with_vectors=True):
        self.requested_ids = list(vacancy_ids)
        wanted = set(vacancy_ids)
        rows = []
        for hit in self.hits:
            payload = dict(hit.payload)
            if payload.get("vacancyId") not in wanted:
                continue
            if with_vectors:
                payload["_vector"] = embed(
                    f"{payload.get('title', '')} {payload.get('text', '')}"
                )
            rows.append(payload)
        return rows


class FakeGenerator:
    def __init__(self, explanations=None, enabled=True, fail=False):
        self.enabled = enabled
        self.fail = fail
        self.explanations = explanations or {}
        self.calls = 0
        self.seen_context = ""

    def generate_match_explanations(self, *, context, vacancy_ids, locale):
        self.calls += 1
        self.seen_context = context
        if self.fail:
            raise GenerationFailedError("provider down")
        wanted = set(vacancy_ids)
        return {k: v for k, v in self.explanations.items() if k in wanted}


def resume_chunk(text: str, index: int = 0) -> dict:
    return {
        "chunkId": f"c-{index}",
        "candidateAccountId": "acct-1",
        "documentId": "doc-1",
        "fileName": "resume.pdf",
        "section": "experience",
        "pageNumber": 1,
        "chunkIndex": index,
        "text": text,
    }


def vacancy_hit(vacancy_id: str, requirements: list[dict], text="Backend role") -> SearchHit:
    return SearchHit(
        score=0.8,
        payload={
            "vacancyId": vacancy_id,
            "organizationId": "org-x",
            "status": "OPEN",
            "title": f"Role {vacancy_id}",
            "text": text,
            "chunkIndex": 0,
            "requirements": requirements,
        },
    )


def run_match(
    *,
    resume_chunks=None,
    vacancy_hits=None,
    profile=None,
    generator=None,
    locale="en",
    eligible=None,
    explain_limit=20,
):
    """Runs the pipeline the way the backend does: with an eligible set.

    `eligible=None` defaults to EVERY vacancy in the fixture, which is the
    point — the universe is the caller's, not a top-K search's.
    """
    hits = vacancy_hits or []
    stores = (
        FakeResumeStore(resume_chunks or []),
        FakeVacancyStore(hits),
    )
    if eligible is None:
        eligible = sorted({h.payload["vacancyId"] for h in hits})
    response = match_jobs(
        request=JobMatchRequest(
            candidateAccountId="acct-1",
            profile=profile or CandidateProfileInput(skills=["Docker"]),
            locale=locale,
            eligibleVacancyIds=eligible,
            explainLimit=explain_limit,
        ),
        settings=get_settings(),
        embedder=FakeEmbedder(),
        resume_store=stores[0],
        vacancy_store=stores[1],
        reranker=None,
        generator=generator,
    )
    return response, stores


class TestMatchPipeline:
    def test_supported_requirement_carries_real_evidence(self):
        response, _ = run_match(
            resume_chunks=[resume_chunk("Operated Docker containers in production.")],
            vacancy_hits=[vacancy_hit("v1", [{"text": "Docker", "required": True}])],
            generator=FakeGenerator({"v1": "ok"}),
        )
        [match] = response.matches
        assert [c.text for c in match.supportedRequirements] == ["Docker"]
        assert match.evidence, "supported requirement must cite evidence"
        assert match.evidence[0].fileName == "resume.pdf"
        assert match.evidence[0].pageNumber == 1
        # Full required coverage, so the coverage signal is maxed out. The
        # TIER is derived from the whole score, not from coverage alone —
        # this fixture's vacancy is a bare title with no skills or role family
        # to corroborate it, so it lands mid-table rather than STRONG. That is
        # the deliberate change: the old rule called any vacancy whose stated
        # requirements happened to be met a STRONG match, which is how a
        # two-line posting outranked a genuinely well-matched role.
        assert match.signals["required"] == 1.0
        assert match.match in ("STRONG", "PARTIAL")

    def test_absent_skill_stays_unsupported_no_matter_what_the_model_says(self):
        # The generator "claims" AWS is fine — the lists are computed before
        # generation and are immutable to it, so nothing changes.
        generator = FakeGenerator({"v1": "You have AWS experience!"})
        response, _ = run_match(
            resume_chunks=[resume_chunk("Docker and Kubernetes work.")],
            vacancy_hits=[
                vacancy_hit("v1", [{"text": "AWS production experience", "required": True}])
            ],
            generator=generator,
        )
        [match] = response.matches
        assert [c.text for c in match.unsupportedRequirements] == [
            "AWS production experience"
        ]
        assert match.supportedRequirements == []
        # The coverage floor: nothing the job requires was demonstrated, so the
        # label stays WEAK however similar the text reads. The job is still
        # ranked and still returned — it is the CLAIM that is held honest.
        assert match.match == "WEAK"

    def test_profile_fields_ground_requirements_without_a_resume(self):
        profile = CandidateProfileInput(
            skills=["PostgreSQL", "Redis"],
            experience=[ProfileExperienceInput(title="Backend Engineer")],
        )
        response, _ = run_match(
            resume_chunks=[],
            vacancy_hits=[vacancy_hit("v1", [{"text": "PostgreSQL", "required": True}])],
            profile=profile,
            generator=FakeGenerator({"v1": "ok"}),
        )
        [match] = response.matches
        assert [c.text for c in match.supportedRequirements] == ["PostgreSQL"]
        assert match.evidence[0].fileName == "Profile"
        assert match.evidence[0].pageNumber is None

    def test_resume_store_is_only_queried_with_the_requesting_account(self):
        _, (resume_store, _) = run_match(
            resume_chunks=[resume_chunk("Docker")],
            vacancy_hits=[vacancy_hit("v1", [{"text": "Docker", "required": True}])],
            generator=FakeGenerator(),
        )
        assert set(resume_store.queried_accounts) == {"acct-1"}

    def test_one_generation_call_for_all_matches(self):
        generator = FakeGenerator({"v1": "a", "v2": "b"})
        response, _ = run_match(
            resume_chunks=[resume_chunk("Docker")],
            vacancy_hits=[
                vacancy_hit("v1", [{"text": "Docker", "required": True}]),
                vacancy_hit("v2", [{"text": "Docker", "required": True}]),
            ],
            generator=generator,
        )
        assert len(response.matches) == 2
        assert generator.calls == 1, "explanations must be batched, never per-vacancy"
        assert response.generated is True

    def test_unknown_vacancy_ids_from_the_model_are_dropped(self):
        generator = FakeGenerator({"v1": "real", "v-invented": "fake"})
        response, _ = run_match(
            resume_chunks=[resume_chunk("Docker")],
            vacancy_hits=[vacancy_hit("v1", [{"text": "Docker", "required": True}])],
            generator=generator,
        )
        [match] = response.matches
        assert match.explanation == "real"
        assert all(m.vacancyId != "v-invented" for m in response.matches)

    def test_generation_failure_keeps_deterministic_matches(self):
        response, _ = run_match(
            resume_chunks=[resume_chunk("Docker")],
            vacancy_hits=[vacancy_hit("v1", [{"text": "Docker", "required": True}])],
            generator=FakeGenerator(fail=True),
        )
        [match] = response.matches
        # The deterministic part survives a provider outage untouched: the
        # ranking, the score and the requirement lists are all computed before
        # generation is even attempted.
        assert match.signals["required"] == 1.0
        assert match.score > 0
        assert match.rank == 1
        assert match.explanation is None
        assert response.generated is False

    def test_generation_disabled_still_returns_matches(self):
        response, _ = run_match(
            resume_chunks=[resume_chunk("Docker")],
            vacancy_hits=[vacancy_hit("v1", [{"text": "Docker", "required": True}])],
            generator=FakeGenerator(enabled=False),
        )
        assert response.matches
        assert response.generated is False

    def test_empty_profile_and_resume_matches_nothing(self):
        response, _ = run_match(
            resume_chunks=[],
            vacancy_hits=[vacancy_hit("v1", [])],
            profile=CandidateProfileInput(),
            generator=FakeGenerator(),
        )
        assert response.matches == []
        assert response.vacanciesConsidered == 0

    def test_generation_context_never_contains_unsupported_as_supported(self):
        generator = FakeGenerator({"v1": "x"})
        run_match(
            resume_chunks=[resume_chunk("Docker experience only.")],
            vacancy_hits=[
                vacancy_hit(
                    "v1",
                    [
                        {"text": "Docker", "required": True},
                        {"text": "Terraform", "required": True},
                    ],
                )
            ],
            generator=generator,
        )
        context = generator.seen_context
        # Split on the SUPPORTED heading rather than a loose substring: the
        # context now also lists matched/missing technologies, and a fragile
        # split would pass or fail on layout rather than on the property.
        supported_block = context.split("Requirements SUPPORTED")[1].split(
            "Requirements NOT shown"
        )[0]
        assert "Terraform" not in supported_block
        assert "Docker" in supported_block

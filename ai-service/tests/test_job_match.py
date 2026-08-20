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

from app.candidate.job_match import classify_match, match_jobs
from app.config import get_settings
from app.generation.client import GenerationFailedError
from app.models.schemas import (
    CandidateProfileInput,
    JobMatchRequest,
    ProfileExperienceInput,
    RequirementCheck,
)
from app.vectorstore.qdrant_store import SearchHit


def check(required: bool = True) -> RequirementCheck:
    return RequirementCheck(text="x", required=required, reason="")


class TestClassifyMatchRule:
    """The documented deterministic table, case by case."""

    def test_no_requirements_is_partial(self):
        assert classify_match([], [], []) == "PARTIAL"

    def test_all_required_supported_is_strong(self):
        assert classify_match([check(), check()], [], []) == "STRONG"

    def test_supported_with_equal_unclear_is_strong(self):
        assert classify_match([check()], [], [check()]) == "STRONG"

    def test_more_unclear_than_supported_is_partial(self):
        assert classify_match([check()], [], [check(), check()]) == "PARTIAL"

    def test_any_missing_required_blocks_strong(self):
        assert classify_match([check(), check()], [check()], []) == "PARTIAL"

    def test_nothing_supported_is_weak(self):
        assert classify_match([], [check()], [check()]) == "WEAK"

    def test_more_missing_than_supported_is_weak(self):
        assert classify_match([check()], [check(), check()], []) == "WEAK"

    def test_optional_requirements_ignored_when_required_exist(self):
        # The optional gap must not drag a fully-supported required set down.
        supported = [check(required=True)]
        unsupported = [check(required=False)]
        assert classify_match(supported, unsupported, []) == "STRONG"

    def test_optional_only_vacancy_falls_back_to_all(self):
        assert classify_match([check(required=False)], [check(required=False)], []) == "PARTIAL"

    def test_deterministic_repeatable(self):
        args = ([check()], [check()], [check()])
        assert {classify_match(*args) for _ in range(10)} == {"PARTIAL"}


# --- fakes --------------------------------------------------------------------


class FakeEmbedder:
    dimension = 4

    def encode_query(self, text: str) -> list[float]:
        return [1.0, 0.0, 0.0, 0.0]

    def encode_passages(self, texts):
        return [[1.0, 0.0, 0.0, 0.0] for _ in texts]


class FakeResumeStore:
    """Personal-resume store that records how it was queried."""

    def __init__(self, chunks: list[dict]):
        self.chunks = chunks
        self.queried_accounts: list[str] = []

    def search(self, *, candidate_account_id, query_vector, limit):
        if not candidate_account_id:
            raise ValueError("candidate_account_id is required for every search")
        self.queried_accounts.append(candidate_account_id)
        # Low raw score: whether a requirement is supported must come from the
        # lexical evidence check, not from an inflated retrieval score (which
        # would land in the semantic NEEDS_HUMAN_REVIEW escalation band).
        return [SearchHit(score=0.05, payload=c) for c in self.chunks[:limit]]

    def list_chunks(self, candidate_account_id, limit=12):
        self.queried_accounts.append(candidate_account_id)
        return self.chunks[:limit]


class FakeVacancyStore:
    def __init__(self, hits: list[SearchHit]):
        self.hits = hits

    def search_open(self, *, query_vector, limit):
        return self.hits[:limit]


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
):
    stores = (
        FakeResumeStore(resume_chunks or []),
        FakeVacancyStore(vacancy_hits or []),
    )
    response = match_jobs(
        request=JobMatchRequest(
            candidateAccountId="acct-1",
            profile=profile or CandidateProfileInput(skills=["Docker"]),
            locale=locale,
            limit=5,
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
        assert match.match == "STRONG"
        assert [c.text for c in match.supportedRequirements] == ["Docker"]
        assert match.evidence, "supported requirement must cite evidence"
        assert match.evidence[0].fileName == "resume.pdf"
        assert match.evidence[0].pageNumber == 1

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
        assert match.match == "STRONG"
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
        supported_block = context.split("NOT shown")[0]
        assert "Terraform" not in supported_block
        assert "Docker" in supported_block

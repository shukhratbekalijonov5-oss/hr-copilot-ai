"""Grounded RAG behaviour.

IMPORTANT — what these tests do and do not prove.

They use a scripted GenerationClient, so they verify the *pipeline* around the
model: that an empty retrieval never reaches the LLM, that fabricated citations
are rejected, that a confidently-wrong model is downgraded rather than trusted,
and that provenance survives.

They do NOT prove that a real model refrains from hallucinating. Only an
evaluation against a live model can show that, and it is deliberately kept out
of the unit suite (see `tests/test_rag_live.py`, skipped without credentials).
A passing run here means the guardrails work, not that the model is honest.
"""

from __future__ import annotations

import uuid

import pytest

from app.config import get_settings
from app.generation import (
    GeneratedQuestion,
    GenerationClient,
    GenerationDisabledError,
    GroundedAnswer,
)
from app.models.schemas import EvidenceHit
from app.retrieval.rag import answer_question, summarise_candidate

# Recruiter RAG reads the CANDIDATE personal collection now, scoped to the
# authorized account universe the backend resolved. There is no tenant key.
ACCT = "acct-rag-1"


class ScriptedGenerator(GenerationClient):
    """Returns exactly what a test tells it to."""

    def __init__(self, answer="", cited=None, status="GROUNDED", questions=None):
        self._answer = answer
        self._cited = cited or []
        self._status = status
        self._questions = questions or []
        self.calls: list[dict] = []

    @property
    def enabled(self) -> bool:
        return True

    @property
    def model(self) -> str:
        return "scripted-test-model"

    def generate_grounded_answer(self, *, question, evidence, locale, vacancy_context=None):
        self.calls.append({"kind": "answer", "question": question,
                           "evidence": evidence, "locale": locale,
                           "vacancy_context": vacancy_context})
        return GroundedAnswer(self._answer, list(self._cited), self._status, self.model)

    def generate_candidate_summary(self, *, evidence, locale, vacancy_context=None):
        self.calls.append({"kind": "summary", "evidence": evidence, "locale": locale,
                           "vacancy_context": vacancy_context})
        return GroundedAnswer(self._answer, list(self._cited), self._status, self.model)

    def generate_interview_questions(self, *, requirement, evidence, locale, evidence_found):
        self.calls.append({"kind": "questions", "requirement": requirement,
                           "evidence": evidence, "evidence_found": evidence_found})
        return list(self._questions)


class ExplodingGenerator(ScriptedGenerator):
    """Fails if it is ever called — proves the LLM was not reached."""

    def generate_grounded_answer(self, **kwargs):
        raise AssertionError("the LLM must not be called with no evidence")

    def generate_candidate_summary(self, **kwargs):
        raise AssertionError("the LLM must not be called with no evidence")


@pytest.fixture()
def indexed(candidate_store, embedder):
    """A real indexed resume so retrieval is genuine.

    Personal evidence in a scratch candidate collection: exactly what a
    recruiter's question is answered from, once the backend has decided this
    account is in their authorized universe.
    """
    from app.candidate.indexing import process_candidate_resume
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


def _ask(store, embedder, generator, *, accounts, query, locale="en"):
    return answer_question(
        candidate_account_ids=accounts,
        query=query,
        locale=locale,
        limit=8,
        settings=get_settings(),
        embedder=embedder,
        store=store,
        reranker=None,
        generator=generator,
    )


@pytest.mark.integration
@pytest.mark.slow
class TestEmptyRetrievalRefusal:
    """§11: never send an empty context and let the model improvise."""

    def test_an_unknown_account_never_calls_the_llm(self, candidate_store, embedder):
        response = _ask(
            candidate_store, embedder, ExplodingGenerator(),
            accounts=[f"acct-empty-{uuid.uuid4()}"], query="Kubernetes experience",
        )
        assert response.status == "INSUFFICIENT_EVIDENCE"
        assert response.citations == []
        assert response.evidenceConsidered == 0

    def test_an_empty_universe_never_calls_the_llm(
        self, candidate_store, embedder, indexed
    ):
        """The authorization boundary reaches all the way to the model.

        Evidence for a real account IS indexed here. A caller authorized for
        nobody must still get a refusal, and the resume text must never leave
        the process — so the exploding generator is the assertion, not a prop.
        """
        response = _ask(
            candidate_store, embedder, ExplodingGenerator(),
            accounts=[], query="Kubernetes experience",
        )
        assert response.status == "INSUFFICIENT_EVIDENCE"
        assert response.citations == []
        assert response.evidenceConsidered == 0

    def test_refusal_message_is_localised(self, candidate_store, embedder):
        for locale, marker in [("ko", "근거"), ("ru", "кандидата"), ("uz", "dalil")]:
            response = _ask(
                candidate_store, embedder, ExplodingGenerator(),
                accounts=[f"acct-empty-{uuid.uuid4()}"], query="Kubernetes",
                locale=locale,
            )
            assert marker in response.answer
            assert response.locale == locale


@pytest.mark.integration
@pytest.mark.slow
class TestGroundedAnswer:
    def test_valid_citations_produce_a_grounded_answer(self, candidate_store, embedder, indexed):
        probe = _ask(candidate_store, embedder, ScriptedGenerator(), accounts=[indexed["account"]],
                     query="Kubernetes experience")
        # Re-run, this time citing a chunk that really was retrieved.
        chunk_ids = [h.chunkId for h in _retrieved(candidate_store, embedder, indexed["account"])]
        generator = ScriptedGenerator(
            answer="The documents describe a production Kubernetes migration.",
            cited=[chunk_ids[0]],
            status="GROUNDED",
        )
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]],
                        query="Kubernetes experience")

        assert response.status == "GROUNDED"
        assert len(response.citations) == 1
        assert response.citations[0].chunkId == chunk_ids[0]
        assert response.rejectedCitations == []
        assert probe.evidenceConsidered > 0

    def test_citations_carry_provenance_for_the_ui(self, candidate_store, embedder, indexed):
        chunk_ids = [h.chunkId for h in _retrieved(candidate_store, embedder, indexed["account"])]
        generator = ScriptedGenerator(answer="...", cited=[chunk_ids[0]])
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="Kubernetes")

        citation = response.citations[0]
        assert citation.fileName == "jiwoo-han.pdf"
        assert citation.documentId
        assert citation.text.strip()

    def test_evidence_text_is_never_translated(self, candidate_store, embedder, indexed):
        """A Korean answer must still cite the original English text."""
        chunk_ids = [h.chunkId for h in _retrieved(candidate_store, embedder, indexed["account"])]
        generator = ScriptedGenerator(
            answer="지원자는 프로덕션 쿠버네티스 경험이 있습니다.", cited=[chunk_ids[0]]
        )
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]],
                        query="쿠버네티스 경험", locale="ko")

        assert response.locale == "ko"
        # The citation is verbatim source text, not a translation.
        assert response.citations[0].text.isascii()

    def test_the_model_receives_only_this_candidates_evidence(self, candidate_store, embedder, indexed):
        generator = ScriptedGenerator(answer="x", cited=[])
        _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="engineer")

        sent = generator.calls[0]["evidence"]
        assert sent
        assert all(h.candidateAccountId == indexed["account"] for h in sent)


@pytest.mark.integration
@pytest.mark.slow
class TestHallucinationGuards:
    """§30: the generator asserting something unsupported must not pass through."""

    def test_invented_citation_is_rejected(self, candidate_store, embedder, indexed):
        generator = ScriptedGenerator(
            answer="The candidate has extensive AWS experience.",
            cited=["totally-invented-chunk-id"],
            status="GROUNDED",
        )
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="AWS")

        assert response.citations == []
        assert "totally-invented-chunk-id" in response.rejectedCitations
        # A confident claim with zero valid citations must not read as grounded.
        assert response.status == "NEEDS_HUMAN_REVIEW"

    def test_a_confident_uncited_answer_is_downgraded(self, candidate_store, embedder, indexed):
        generator = ScriptedGenerator(
            answer="The candidate has 12 years of AWS experience.",
            cited=[],
            status="GROUNDED",
        )
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="AWS")

        assert response.status == "NEEDS_HUMAN_REVIEW"
        assert response.citations == []

    def test_model_reporting_insufficient_evidence_is_respected(self, candidate_store, embedder, indexed):
        generator = ScriptedGenerator(
            answer="The documents do not mention AWS.", cited=[],
            status="INSUFFICIENT_EVIDENCE",
        )
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="AWS")

        assert response.status == "INSUFFICIENT_EVIDENCE"

    def test_citation_from_another_account_is_rejected(self, candidate_store, embedder, indexed):
        """Even if the model somehow names a real chunk from someone else.

        Nothing outside the authorized universe is in the retrieved context,
        so an id belonging to another account can only ever be rejected.
        """
        generator = ScriptedGenerator(answer="x", cited=["chunk-of-another-person"])
        response = _ask(candidate_store, embedder, generator, accounts=[indexed["account"]], query="Kubernetes")

        assert response.citations == []
        assert response.rejectedCitations == ["chunk-of-another-person"]


class TestGenerationDisabled:
    """Retrieval must not depend on LLM availability (§43)."""

    def test_disabled_client_refuses_rather_than_improvising(self):
        from app.generation import DisabledGenerationClient

        client = DisabledGenerationClient()
        assert not client.enabled
        with pytest.raises(GenerationDisabledError):
            client.generate_grounded_answer(question="q", evidence=[], locale="en")
        with pytest.raises(GenerationDisabledError):
            client.generate_candidate_summary(evidence=[], locale="en")
        with pytest.raises(GenerationDisabledError):
            client.generate_interview_questions(
                requirement="r", evidence=[], locale="en", evidence_found=False
            )


def _retrieved(store, embedder, account):
    from app.retrieval import search_evidence

    return search_evidence(
        candidate_account_ids=[account], query="Kubernetes", limit=8,
        document_id=None, use_rerank=False, settings=get_settings(),
        embedder=embedder, store=store, reranker=None,
    ).hits


class TestGenerationFailureIsHonest:
    """§43: RAG must fail with a clear, actionable status — never an opaque 500."""

    def test_disabled_generation_maps_to_503_with_a_specific_code(self):
        from app.common.errors import AiServiceError
        from app.generation import GenerationDisabledError

        error = GenerationDisabledError("answer a question")

        assert isinstance(error, AiServiceError)
        assert error.http_status == 503
        assert error.code == "generation_disabled"

    def test_provider_failure_is_distinguishable_from_disabled(self):
        from app.generation import GenerationFailedError

        error = GenerationFailedError("provider timeout")

        assert error.http_status == 503
        assert error.code == "generation_failed"

    def test_rag_endpoint_returns_503_not_500_without_a_provider(self, client, auth_headers):
        response = client.post(
            "/internal/rag",
            headers=auth_headers,
            json={
                "candidateAccountIds": ["acct-a"],
                "query": "Kubernetes?",
                "locale": "en",
            },
        )
        # Either no evidence (200, refused before the LLM) or a clean 503 —
        # never an opaque internal error.
        assert response.status_code in (200, 503)
        assert response.status_code != 500
        if response.status_code == 503:
            assert response.json()["code"] in (
                "generation_disabled", "generation_failed",
            )

    def test_search_still_works_when_generation_is_unavailable(self, client, auth_headers):
        """Semantic search must not depend on LLM availability."""
        response = client.post(
            "/internal/search",
            headers=auth_headers,
            json={
                "candidateAccountIds": ["acct-a"],
                "query": "Kubernetes",
                "rerank": False,
            },
        )
        assert response.status_code == 200

    def test_evidence_mapping_still_works_when_generation_is_unavailable(
        self, client, auth_headers
    ):
        """JD mapping is retrieval-only and must survive an LLM outage."""
        response = client.post(
            "/internal/evidence-map",
            headers=auth_headers,
            json={
                "candidateAccountId": "acct-a", "vacancyId": "v1",
                "requirements": [{"requirementId": "r1", "text": "Kubernetes"}],
            },
        )
        assert response.status_code == 200
        assert response.json()["requirements"][0]["status"] in (
            "EVIDENCE_FOUND", "NO_EVIDENCE_FOUND", "NEEDS_HUMAN_REVIEW",
        )


@pytest.mark.integration
@pytest.mark.slow
class TestAnswerCitationConsistency:
    """The answer prose and the citation list must never contradict.

    A model that cites by PASSAGE NUMBER is referencing the exact context we
    sent, so those references are mapped to real chunkIds and validated as
    usual — while any marker whose reference did not survive validation is
    stripped from the prose. The response can therefore never say "[1]" while
    carrying zero citations.
    """

    def test_ordinal_citations_map_to_real_chunks_and_stay_grounded(
        self, candidate_store, embedder, indexed
    ):
        generator = ScriptedGenerator(
            answer="The candidate ran production Kubernetes [1].",
            cited=["1"],
            status="GROUNDED",
        )
        response = _ask(
            candidate_store, embedder, generator,
            accounts=[indexed["account"]], query="Kubernetes",
        )

        # Passage 1 of the exact retrieved context, validated normally.
        assert response.status == "GROUNDED"
        assert len(response.citations) == 1
        assert response.rejectedCitations == []
        citation = response.citations[0]
        assert citation.fileName
        assert citation.text
        # The prose marker was canonicalized to that accepted chunkId.
        assert f"[{citation.chunkId}]" in response.answer
        assert "[1]" not in response.answer

    def test_rejected_references_leave_no_markers_behind(
        self, candidate_store, embedder, indexed
    ):
        generator = ScriptedGenerator(
            answer="Claims here [1] and there [99] and invented "
            "[deadbeef-dead-4bad-8bad-deadbeefdead].",
            cited=["99", "deadbeef-dead-4bad-8bad-deadbeefdead"],
            status="GROUNDED",
        )
        response = _ask(
            candidate_store, embedder, generator,
            accounts=[indexed["account"]], query="Kubernetes",
        )

        # Nothing validated -> downgraded, and the prose carries NO markers.
        assert response.citations == []
        assert response.status == "NEEDS_HUMAN_REVIEW"
        assert "[1]" not in response.answer
        assert "[99]" not in response.answer
        assert "deadbeef" not in response.answer

    def test_no_raw_chunk_uuid_without_a_matching_citation(
        self, candidate_store, embedder, indexed
    ):
        # An accepted citation's id MAY appear (the frontend renders it as a
        # numbered reference); any other uuid must not survive.
        generator = ScriptedGenerator(
            answer="Kubernetes work [2].", cited=["2"], status="GROUNDED"
        )
        response = _ask(
            candidate_store, embedder, generator,
            accounts=[indexed["account"]], query="Kubernetes",
        )

        accepted = {c.chunkId for c in response.citations}
        import re
        uuids = set(
            re.findall(
                r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
                r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
                response.answer,
            )
        )
        assert uuids <= accepted


class TestVacancyContextGrounding:
    """The SELECTED vacancy steers generation without ever becoming evidence."""

    def _vacancy(self):
        from app.models.schemas import VacancyContext, VacancyContextRequirement

        return VacancyContext(
            vacancyId="vac-1",
            title="Senior Backend Engineer",
            requirements=[
                VacancyContextRequirement(text="Kubernetes", required=True),
                VacancyContextRequirement(text="Korean language", required=False),
            ],
        )

    def test_summary_passes_vacancy_context_to_the_generator(
        self, candidate_store, embedder, indexed
    ):
        generator = ScriptedGenerator(answer="ok", status="GROUNDED")
        summarise_candidate(
            candidate_account_id=indexed["account"],
            locale="en",
            limit=8,
            settings=get_settings(),
            embedder=embedder,
            store=candidate_store,
            reranker=None,
            generator=generator,
            vacancy=self._vacancy(),
        )
        call = generator.calls[-1]
        assert call["kind"] == "summary"
        assert "Senior Backend Engineer" in call["vacancy_context"]
        assert "[required] Kubernetes" in call["vacancy_context"]
        assert "[nice-to-have] Korean language" in call["vacancy_context"]

    def test_answer_passes_vacancy_context_to_the_generator(
        self, candidate_store, embedder, indexed
    ):
        generator = ScriptedGenerator(answer="ok", status="GROUNDED")
        answer_question(
            candidate_account_ids=[indexed["account"]],
            query="Does this candidate know Kubernetes?",
            locale="en",
            limit=8,
            settings=get_settings(),
            embedder=embedder,
            store=candidate_store,
            reranker=None,
            generator=generator,
            vacancy=self._vacancy(),
        )
        call = generator.calls[-1]
        assert call["kind"] == "answer"
        assert "Senior Backend Engineer" in call["vacancy_context"]

    def test_without_vacancy_the_context_stays_none(
        self, candidate_store, embedder, indexed
    ):
        generator = ScriptedGenerator(answer="ok", status="GROUNDED")
        summarise_candidate(
            candidate_account_id=indexed["account"],
            locale="en",
            limit=8,
            settings=get_settings(),
            embedder=embedder,
            store=candidate_store,
            reranker=None,
            generator=generator,
        )
        assert generator.calls[-1]["vacancy_context"] is None

    def test_vacancy_block_marks_itself_as_non_evidence(self):
        from app.generation.prompts import build_answer_prompt, build_summary_prompt

        answer = build_answer_prompt(
            "q", [], "en", vacancy_context="Title: X"
        )
        summary = build_summary_prompt([], "en", vacancy_context="Title: X")
        for prompt in (answer, summary):
            assert "NOT evidence" in prompt
            assert "Title: X" in prompt

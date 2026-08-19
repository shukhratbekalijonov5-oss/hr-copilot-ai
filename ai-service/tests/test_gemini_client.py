"""GeminiGenerationClient — provider wiring, structured output and error safety.

No network. A fake SDK stands in for `google.genai` so the transport, the
config passed to the model, and every failure path can be exercised
deterministically. Real-model behaviour is proven separately in
`tests/test_rag_live.py`.
"""

from __future__ import annotations

import sys
import types as pytypes

import pytest

from app.config import Settings
from app.generation import build_generation_client
from app.generation.client import (
    AnthropicGenerationClient,
    DisabledGenerationClient,
    GenerationDisabledError,
    GenerationFailedError,
)
from app.generation.gemini_client import GeminiGenerationClient
from app.generation.schemas import AnswerPayload, QuestionPayload, QuestionsPayload
from app.models.schemas import EvidenceHit


def hit(chunk_id="chunk-1", text="Led a production Kubernetes migration."):
    return EvidenceHit(
        chunkId=chunk_id, candidateId="cand-1", documentId="doc-1",
        fileName="cv.pdf", section="experience", pageNumber=2, chunkIndex=0,
        text=text, retrievalScore=0.5,
    )


class FakeUsage:
    prompt_token_count = 1200
    candidates_token_count = 90
    total_token_count = 1290
    thoughts_token_count = 40


class FakeResponse:
    def __init__(self, parsed=None, block_reason=None, finish_reason=None):
        self.parsed = parsed
        self.usage_metadata = FakeUsage()
        self.prompt_feedback = pytypes.SimpleNamespace(block_reason=block_reason)
        self.candidates = (
            [pytypes.SimpleNamespace(finish_reason=finish_reason)] if finish_reason else []
        )


class FakeModels:
    def __init__(self, response=None, raises=None):
        self._response = response
        self._raises = raises
        self.calls: list[dict] = []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._raises:
            raise self._raises
        return self._response


@pytest.fixture()
def fake_sdk(monkeypatch):
    """Installs a stand-in `google.genai` and returns a control handle."""
    state: dict = {"models": None}

    class FakeClient:
        def __init__(self, **kwargs):
            state["client_kwargs"] = kwargs
            self.models = state["models"]

    genai_mod = pytypes.ModuleType("google.genai")
    genai_mod.Client = FakeClient

    class HttpOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class GenerateContentConfig:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    types_mod = pytypes.ModuleType("google.genai.types")
    types_mod.HttpOptions = HttpOptions
    types_mod.GenerateContentConfig = GenerateContentConfig

    class APIError(Exception):
        def __init__(self, code, message="provider said no"):
            super().__init__(message)
            self.code = code

    errors_mod = pytypes.ModuleType("google.genai.errors")
    errors_mod.APIError = APIError

    google_mod = pytypes.ModuleType("google")
    google_mod.genai = genai_mod
    genai_mod.types = types_mod
    genai_mod.errors = errors_mod

    for name, mod in {
        "google": google_mod,
        "google.genai": genai_mod,
        "google.genai.types": types_mod,
        "google.genai.errors": errors_mod,
    }.items():
        monkeypatch.setitem(sys.modules, name, mod)

    state["APIError"] = APIError
    return state


def client(**kwargs):
    return GeminiGenerationClient(
        api_key=kwargs.pop("api_key", "test-key"),
        model=kwargs.pop("model", "gemini-2.5-flash"),
        **kwargs,
    )


class TestProviderSelection:
    def test_factory_builds_gemini_when_configured(self):
        built = build_generation_client(
            Settings(llm_provider="gemini", gemini_api_key="k", llm_api_key="")
        )
        assert isinstance(built, GeminiGenerationClient)

    def test_anthropic_client_is_still_available(self):
        """Provider flexibility is preserved (§33)."""
        built = build_generation_client(
            Settings(llm_provider="anthropic", anthropic_api_key="k", llm_api_key="")
        )
        assert isinstance(built, AnthropicGenerationClient)

    def test_missing_credential_disables_generation(self):
        built = build_generation_client(
            Settings(llm_provider="gemini", gemini_api_key="", llm_api_key="")
        )
        assert isinstance(built, DisabledGenerationClient)
        assert not built.enabled

    def test_provider_none_disables_generation(self):
        built = build_generation_client(Settings(llm_provider="none"))
        assert isinstance(built, DisabledGenerationClient)

    def test_generic_key_overrides_the_provider_specific_one(self):
        settings = Settings(
            llm_provider="gemini", gemini_api_key="specific", llm_api_key="generic"
        )
        assert settings.resolved_api_key == "generic"

    def test_default_model_per_provider(self):
        assert Settings(llm_provider="gemini", llm_model="").resolved_llm_model.startswith("gemini")
        assert Settings(llm_provider="anthropic", llm_model="").resolved_llm_model.startswith("claude")

    def test_configured_model_wins_over_the_default(self):
        assert Settings(llm_provider="gemini", llm_model="gemini-3-pro").resolved_llm_model == "gemini-3-pro"


class TestStructuredOutput:
    def test_grounded_answer_is_parsed_from_structured_output(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(
                answer="The documents describe a Kubernetes migration.",
                cited_chunk_ids=["chunk-1"], status="GROUNDED",
            ))
        )
        result = client().generate_grounded_answer(
            question="Kubernetes?", evidence=[hit()], locale="en"
        )

        assert result.status == "GROUNDED"
        assert result.cited_chunk_ids == ["chunk-1"]
        assert result.model == "gemini-2.5-flash"

    def test_json_mode_and_schema_are_requested(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        config = fake_sdk["models"].calls[0]["config"]
        assert config.response_mime_type == "application/json"
        assert config.response_schema is AnswerPayload

    def test_grounding_rules_are_sent_as_system_instruction(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        system = fake_sdk["models"].calls[0]["config"].system_instruction
        assert "ONLY the numbered evidence passages" in system
        assert "Never infer one technology from another" in system

    def test_temperature_is_deterministic_by_default(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert fake_sdk["models"].calls[0]["config"].temperature == 0.0

    def test_only_retrieved_evidence_is_sent(self, fake_sdk):
        """§25: the whole resume must not be shipped to the provider."""
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client().generate_grounded_answer(
            question="q", evidence=[hit(text="ONLY THIS PASSAGE")], locale="en"
        )

        contents = fake_sdk["models"].calls[0]["contents"]
        assert "ONLY THIS PASSAGE" in contents
        assert contents.count("chunkId:") == 1

    def test_locale_reaches_the_prompt(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client().generate_grounded_answer(question="q", evidence=[hit()], locale="ko")

        assert "Korean" in fake_sdk["models"].calls[0]["contents"]

    def test_interview_questions_are_parsed(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(QuestionsPayload(questions=[
                QuestionPayload(question="Why Redis Pub/Sub?", reason="Candidate reports it.",
                                cited_chunk_ids=["chunk-1"]),
            ]))
        )
        questions = client().generate_interview_questions(
            requirement="Redis Pub/Sub", evidence=[hit()], locale="en", evidence_found=True,
        )

        assert len(questions) == 1
        assert questions[0].cited_chunk_ids == ["chunk-1"]

    def test_summary_uses_the_summary_prompt(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="s", cited_chunk_ids=["chunk-1"], status="GROUNDED"))
        )
        client().generate_candidate_summary(evidence=[hit()], locale="en")

        assert "Summarise what these documents state" in fake_sdk["models"].calls[0]["contents"]


class TestErrorHandling:
    """§22/§23: safe application errors, no provider internals leaked."""

    @pytest.mark.parametrize(
        "code,expected",
        [
            (401, "authentication failed"),
            (403, "access denied"),
            (429, "rate limit or quota exceeded"),
            (404, "model is unavailable"),
            (503, "temporarily unavailable"),
            (500, "provider error"),
        ],
    )
    def test_provider_errors_map_to_safe_reasons(self, fake_sdk, code, expected):
        fake_sdk["models"] = FakeModels(raises=fake_sdk["APIError"](code))

        with pytest.raises(GenerationFailedError) as exc:
            client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert expected in str(exc.value)

    def test_provider_message_is_never_forwarded(self, fake_sdk):
        """A provider message can name internal projects and quote requests."""
        leaky = fake_sdk["APIError"](
            403, "Gemini API has not been used in project 914128557862 before"
        )
        fake_sdk["models"] = FakeModels(raises=leaky)

        with pytest.raises(GenerationFailedError) as exc:
            client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert "914128557862" not in str(exc.value)
        assert "project" not in str(exc.value).lower()

    def test_api_key_never_appears_in_an_error(self, fake_sdk):
        fake_sdk["models"] = FakeModels(raises=fake_sdk["APIError"](401))

        with pytest.raises(GenerationFailedError) as exc:
            client(api_key="super-secret-key-value").generate_grounded_answer(
                question="q", evidence=[hit()], locale="en"
            )

        assert "super-secret-key-value" not in str(exc.value)

    def test_timeout_is_reported_safely(self, fake_sdk):
        fake_sdk["models"] = FakeModels(raises=TimeoutError("read timeout"))

        with pytest.raises(GenerationFailedError) as exc:
            client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert "TimeoutError" in str(exc.value)

    def test_blocked_response_fails_rather_than_looking_empty(self, fake_sdk):
        """A safety block must not be reported as 'no evidence'."""
        fake_sdk["models"] = FakeModels(FakeResponse(parsed=None, block_reason="SAFETY"))

        with pytest.raises(GenerationFailedError) as exc:
            client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert "SAFETY" in str(exc.value)

    def test_truncated_response_fails_loudly(self, fake_sdk):
        fake_sdk["models"] = FakeModels(FakeResponse(parsed=None, finish_reason="MAX_TOKENS"))

        with pytest.raises(GenerationFailedError) as exc:
            client().generate_grounded_answer(question="q", evidence=[hit()], locale="en")

        assert "MAX_TOKENS" in str(exc.value)

    def test_disabled_client_refuses_before_any_transport(self, fake_sdk):
        fake_sdk["models"] = FakeModels(FakeResponse(parsed=None))

        with pytest.raises(GenerationDisabledError):
            client(api_key="").generate_grounded_answer(
                question="q", evidence=[hit()], locale="en"
            )
        assert fake_sdk["models"].calls == []


class TestTimeoutConfiguration:
    def test_timeout_is_passed_to_the_sdk_in_milliseconds(self, fake_sdk):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(answer="x", cited_chunk_ids=[], status="GROUNDED"))
        )
        client(timeout_seconds=30.0).generate_grounded_answer(
            question="q", evidence=[hit()], locale="en"
        )

        http_options = fake_sdk["client_kwargs"]["http_options"]
        assert http_options.kwargs["timeout"] == 30000


class TestLogSafety:
    def test_usage_is_recorded_without_any_text(self, fake_sdk, caplog):
        fake_sdk["models"] = FakeModels(
            FakeResponse(AnswerPayload(
                answer="SENSITIVE ANSWER TEXT", cited_chunk_ids=[], status="GROUNDED",
            ))
        )
        with caplog.at_level("INFO"):
            client().generate_grounded_answer(
                question="SENSITIVE QUESTION", evidence=[hit(text="SENSITIVE CV TEXT")],
                locale="en",
            )

        assert "SENSITIVE" not in caplog.text
        # Structured fields live on the record, not in caplog's rendered text.
        record = next(r for r in caplog.records if r.message == "Generation completed")
        assert record.inputTokens == 1200
        assert record.outputTokens == 90
        assert record.provider == "gemini"
        # Nothing carrying document or prompt text may be attached.
        for value in vars(record).values():
            assert "SENSITIVE" not in str(value)

    def test_api_key_is_never_logged(self, fake_sdk, caplog):
        fake_sdk["models"] = FakeModels(raises=fake_sdk["APIError"](429))

        with caplog.at_level("DEBUG"):
            with pytest.raises(GenerationFailedError):
                client(api_key="key-must-not-be-logged").generate_grounded_answer(
                    question="q", evidence=[hit()], locale="en"
                )

        assert "key-must-not-be-logged" not in caplog.text

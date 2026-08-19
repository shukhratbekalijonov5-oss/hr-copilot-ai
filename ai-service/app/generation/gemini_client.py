"""Gemini implementation of GenerationClient.

Isolated here on purpose: nothing outside this file imports the Google SDK, so
switching provider stays a configuration change rather than a refactor.

Structured output is used rather than prose parsing. Gemini is given the same
Pydantic schema the rest of the pipeline expects, so an answer either arrives
with machine-checkable citation ids or it does not arrive at all — there is no
regex over free text deciding which claims are supported.

Nothing here is trusted. Whatever Gemini returns is validated against the
retrieved context by `app.generation.validation` before it reaches a caller.
"""

from __future__ import annotations

import time
from typing import Any

from app.common.logging import get_logger
from app.generation.client import (
    GeneratedQuestion,
    GenerationClient,
    GenerationDisabledError,
    GenerationFailedError,
    GroundedAnswer,
)
from app.models.schemas import EvidenceHit

logger = get_logger(__name__)


class GeminiGenerationClient(GenerationClient):
    """Grounded generation via the Google Gen AI SDK (`google-genai`)."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        max_tokens: int = 4096,
        timeout_seconds: float = 120.0,
        temperature: float = 0.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._max_tokens = max_tokens
        self._timeout = timeout_seconds
        self._temperature = temperature
        self._client: Any = None

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    @property
    def model(self) -> str:
        return self._model

    @property
    def provider(self) -> str:
        return "gemini"

    def _sdk(self) -> Any:
        """Builds the SDK client lazily, so importing this module is cheap."""
        if self._client is None:
            from google import genai
            from google.genai import types

            self._client = genai.Client(
                api_key=self._api_key,
                # SDK timeout is milliseconds.
                http_options=types.HttpOptions(
                    timeout=int(self._timeout * 1000)
                ),
            )
        return self._client

    # -- public API --------------------------------------------------------

    def generate_grounded_answer(
        self, *, question: str, evidence: list[EvidenceHit], locale: str
    ) -> GroundedAnswer:
        from app.generation.prompts import GROUNDING_RULES, build_answer_prompt
        from app.generation.schemas import AnswerPayload

        payload = self._generate(
            system=GROUNDING_RULES,
            prompt=build_answer_prompt(question, evidence, locale),
            schema=AnswerPayload,
            operation="generate a grounded answer",
        )
        return GroundedAnswer(
            answer=payload.answer,
            cited_chunk_ids=list(payload.cited_chunk_ids),
            status=payload.status,
            model=self._model,
        )

    def generate_candidate_summary(
        self, *, evidence: list[EvidenceHit], locale: str
    ) -> GroundedAnswer:
        from app.generation.prompts import GROUNDING_RULES, build_summary_prompt
        from app.generation.schemas import AnswerPayload

        payload = self._generate(
            system=GROUNDING_RULES,
            prompt=build_summary_prompt(evidence, locale),
            schema=AnswerPayload,
            operation="generate a candidate summary",
        )
        return GroundedAnswer(
            answer=payload.answer,
            cited_chunk_ids=list(payload.cited_chunk_ids),
            status=payload.status,
            model=self._model,
        )

    def generate_interview_questions(
        self,
        *,
        requirement: str,
        evidence: list[EvidenceHit],
        locale: str,
        evidence_found: bool,
    ) -> list[GeneratedQuestion]:
        from app.generation.prompts import (
            GROUNDING_RULES,
            build_interview_questions_prompt,
        )
        from app.generation.schemas import QuestionsPayload

        payload = self._generate(
            system=GROUNDING_RULES,
            prompt=build_interview_questions_prompt(
                requirement, evidence, locale, evidence_found=evidence_found
            ),
            schema=QuestionsPayload,
            operation="generate interview questions",
        )
        return [
            GeneratedQuestion(
                question=q.question,
                reason=q.reason,
                cited_chunk_ids=list(q.cited_chunk_ids),
            )
            for q in payload.questions
        ]

    # -- transport ---------------------------------------------------------

    def _generate(self, *, system: str, prompt: str, schema: Any, operation: str) -> Any:
        if not self.enabled:
            raise GenerationDisabledError(operation)

        from google.genai import errors as genai_errors
        from google.genai import types

        started = time.perf_counter()
        try:
            response = self._sdk().models.generate_content(
                model=self._model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    # JSON mode + schema: the model must return the exact shape
                    # the pipeline validates, not prose we would have to parse.
                    response_mime_type="application/json",
                    response_schema=schema,
                    max_output_tokens=self._max_tokens,
                    # Grounded extraction is a reporting task, not a creative
                    # one; determinism matters more than variety.
                    temperature=self._temperature,
                ),
            )
        except genai_errors.APIError as exc:
            raise self._as_failure(exc, operation) from exc
        except Exception as exc:
            # Timeouts and transport faults surface as plain exceptions.
            logger.error(
                "Generation transport error",
                extra={
                    "stage": "generation",
                    "provider": self.provider,
                    "operation": operation,
                    "model": self._model,
                    "errorType": type(exc).__name__,
                },
            )
            raise GenerationFailedError(
                f"Generation request failed: {type(exc).__name__}"
            ) from exc

        parsed = self._parsed_or_fail(response, operation)

        logger.info(
            "Generation completed",
            extra={
                "stage": "generation",
                "provider": self.provider,
                "operation": operation,
                "model": self._model,
                "durationMs": int((time.perf_counter() - started) * 1000),
                # Token counts only — never prompt or response text, which
                # contain resume content.
                **_usage(response),
            },
        )
        return parsed

    def _parsed_or_fail(self, response: Any, operation: str) -> Any:
        """Returns the structured payload, or fails loudly.

        A blocked or truncated response yields no `parsed` object. Treating
        that as an empty answer would present "no evidence" when the truth is
        "the model did not answer".
        """
        parsed = getattr(response, "parsed", None)
        if parsed is not None:
            return parsed

        reason = _block_reason(response)
        logger.error(
            "Generation returned no structured output",
            extra={
                "stage": "generation",
                "provider": self.provider,
                "operation": operation,
                "model": self._model,
                "blockReason": reason,
            },
        )
        raise GenerationFailedError(
            f"The model returned no structured output ({reason})"
        )

    def _as_failure(self, exc: Any, operation: str) -> GenerationFailedError:
        """Maps a provider error to a safe application error.

        The provider's message can echo request content and internal detail, so
        only the status code and a short reason cross this boundary. The key is
        never part of an SDK error message, but the message is not forwarded
        verbatim regardless.
        """
        status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        reason = _CLIENT_REASONS.get(int(status) if status else 0, "provider error")

        logger.error(
            "Generation provider error",
            extra={
                "stage": "generation",
                "provider": self.provider,
                "operation": operation,
                "model": self._model,
                "statusCode": status,
                "errorType": type(exc).__name__,
            },
        )
        return GenerationFailedError(f"Generation unavailable: {reason}")


# Status -> caller-safe reason. Deliberately terse: enough for an operator to
# act on, nothing that reveals request content or account structure.
_CLIENT_REASONS: dict[int, str] = {
    400: "invalid generation request",
    401: "provider authentication failed",
    403: "provider access denied",
    404: "configured model is unavailable",
    408: "provider timed out",
    429: "provider rate limit or quota exceeded",
    500: "provider error",
    503: "provider temporarily unavailable",
    504: "provider timed out",
}


def _usage(response: Any) -> dict[str, int]:
    """Token counts for cost tracking. Never text."""
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        return {}
    out: dict[str, int] = {}
    for attr, name in (
        ("prompt_token_count", "inputTokens"),
        ("candidates_token_count", "outputTokens"),
        ("total_token_count", "totalTokens"),
        ("thoughts_token_count", "thinkingTokens"),
    ):
        value = getattr(usage, attr, None)
        if isinstance(value, int):
            out[name] = value
    return out


def _block_reason(response: Any) -> str:
    """Why a response carried no payload, without quoting any content."""
    feedback = getattr(response, "prompt_feedback", None)
    blocked = getattr(feedback, "block_reason", None)
    if blocked:
        return f"blocked: {blocked}"

    candidates = getattr(response, "candidates", None) or []
    if candidates:
        finish = getattr(candidates[0], "finish_reason", None)
        if finish:
            return f"finish_reason: {finish}"
    return "empty response"

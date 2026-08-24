"""LLM abstraction for grounded generation.

Business logic depends on `GenerationClient` only. Swapping provider or model
is a change in this file and nothing else.

While no provider is configured the client is *disabled*, and every method
raises `GenerationDisabledError`. It does not fall back to answering from the
model's own knowledge, and it does not return a plausible placeholder — either
would put an ungrounded claim in front of someone making a hiring decision.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.models.schemas import EvidenceHit

logger = get_logger(__name__)


class GenerationDisabledError(GenerationUnavailableError):
    """No LLM provider is configured."""

    code = "generation_disabled"

    def __init__(self, operation: str) -> None:
        super().__init__(
            f"Generation is not configured (LLM_API_KEY is unset); cannot {operation}"
        )
        self.operation = operation


class GenerationFailedError(GenerationUnavailableError):
    """The provider was reached but did not return a usable answer."""

    code = "generation_failed"


@dataclass
class GroundedAnswer:
    """Raw model output, before citation validation.

    `cited_chunk_ids` is what the model *claimed*; nothing here is trusted
    until `app.generation.validation` checks it against the retrieved context.
    """

    answer: str
    cited_chunk_ids: list[str]
    status: str
    model: str


@dataclass
class GeneratedQuestion:
    question: str
    reason: str
    cited_chunk_ids: list[str]


@dataclass
class WhyMatchItem:
    title: str
    explanation: str


@dataclass
class ExternalWhyMatch:
    """One grounded 'why this external job matches you' explanation.

    Prose only. There is deliberately no score, band, rank or percentage
    field: the deterministic pipeline already decided all of those and this
    structure has nowhere to put a competing number.
    """

    summary: str
    strengths: list[WhyMatchItem]
    gaps: list[WhyMatchItem]


#: Bounds for a why-match answer, enforced on OUR side after validation.
#: The schema descriptions ask the model for these counts; this is what makes
#: them true. A model that returns six strengths gets its four best kept, and
#: one that returns a padded gap list gets it truncated -- never extended,
#: because inventing a gap to reach a minimum is exactly the dishonesty the
#: feature must not commit.
MAX_WHY_MATCH_STRENGTHS = 4
MAX_WHY_MATCH_GAPS = 2


def bounded_why_match(payload: Any) -> ExternalWhyMatch:
    """Validated payload -> bounded dataclass.

    Drops items missing a title or an explanation rather than rendering an
    empty bullet, and clamps both lists. There is no lower bound to enforce:
    "fewer, honest" is always the correct direction.
    """

    def items(raw: Any, limit: int) -> list[WhyMatchItem]:
        out: list[WhyMatchItem] = []
        for item in raw or []:
            title = (item.title or "").strip()
            explanation = (item.explanation or "").strip()
            if not title or not explanation:
                continue
            out.append(WhyMatchItem(title=title, explanation=explanation))
            if len(out) == limit:
                break
        return out

    return ExternalWhyMatch(
        summary=(payload.summary or "").strip(),
        strengths=items(payload.strengths, MAX_WHY_MATCH_STRENGTHS),
        gaps=items(payload.gaps, MAX_WHY_MATCH_GAPS),
    )


class GenerationClient(ABC):
    """Provider-agnostic grounded generation."""

    @property
    @abstractmethod
    def enabled(self) -> bool: ...

    @property
    @abstractmethod
    def model(self) -> str: ...

    @abstractmethod
    def generate_grounded_answer(
        self,
        *,
        question: str,
        evidence: list[EvidenceHit],
        locale: str,
        vacancy_context: str | None = None,
    ) -> GroundedAnswer: ...

    @abstractmethod
    def generate_candidate_summary(
        self,
        *,
        evidence: list[EvidenceHit],
        locale: str,
        vacancy_context: str | None = None,
    ) -> GroundedAnswer: ...

    @abstractmethod
    def generate_interview_questions(
        self,
        *,
        requirement: str,
        evidence: list[EvidenceHit],
        locale: str,
        evidence_found: bool,
    ) -> list[GeneratedQuestion]: ...

    def generate_match_explanations(
        self, *, context: str, vacancy_ids: list[str], locale: str
    ) -> dict[str, str]:
        """Candidate-facing explanations for pre-classified job matches.

        One batched call for ALL matches — never one call per vacancy. The
        match labels are decided deterministically before this runs; the model
        only explains the already-validated evidence. Returns
        {vacancyId: explanation} for the ids it covered; the caller drops any
        id it did not ask about.

        Deliberately NOT abstract: a provider (or a test fake) that does not
        implement it refuses honestly instead of breaking instantiation, and
        the job-match pipeline treats that refusal as "no explanations".
        """
        raise GenerationDisabledError("generate job match explanations")

    def generate_external_why_match(
        self, *, context: str, locale: str
    ) -> ExternalWhyMatch:
        """Why ONE external job relates to ONE candidate's current profile.

        Single-job by design: this is a lazy, user-initiated action ("why this
        match?"), never something a page of twenty results triggers. The
        caller supplies an already-assembled, already-minimized context — the
        candidate's CURRENT profile, the job's stored facts, and the
        deterministic match facts — and gets prose back.

        Non-abstract for the same reason as `generate_match_explanations`: a
        provider that cannot do it refuses honestly, and the caller turns that
        refusal into a controlled "explanation unavailable".
        """
        raise GenerationDisabledError("generate an external match explanation")


class DisabledGenerationClient(GenerationClient):
    """Used when no provider is configured. Refuses, never improvises."""

    @property
    def enabled(self) -> bool:
        return False

    @property
    def model(self) -> str:
        return ""

    def generate_grounded_answer(self, **_: object) -> GroundedAnswer:
        raise GenerationDisabledError("generate a grounded answer")

    def generate_candidate_summary(self, **_: object) -> GroundedAnswer:
        raise GenerationDisabledError("generate a candidate summary")

    def generate_interview_questions(self, **_: object) -> list[GeneratedQuestion]:
        raise GenerationDisabledError("generate interview questions")

    def generate_match_explanations(self, **_: object) -> dict[str, str]:
        raise GenerationDisabledError("generate job match explanations")

    def generate_external_why_match(self, **_: object) -> ExternalWhyMatch:
        raise GenerationDisabledError("generate an external match explanation")


class AnthropicGenerationClient(GenerationClient):
    """Claude implementation.

    Uses structured outputs so the model returns citations as data rather than
    prose we would have to parse — a regex over free text is a bad place to
    decide which claims are supported.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        max_tokens: int = 4096,
        timeout_seconds: float = 120.0,
    ) -> None:
        self._model = model
        self._max_tokens = max_tokens
        self._timeout = timeout_seconds
        self._api_key = api_key
        self._client = None

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    @property
    def model(self) -> str:
        return self._model

    def _sdk(self):
        if self._client is None:
            # Imported lazily so the package is only required when generation
            # is actually configured.
            import anthropic

            self._client = anthropic.Anthropic(
                api_key=self._api_key, timeout=self._timeout
            )
        return self._client

    # -- public API --------------------------------------------------------

    def generate_grounded_answer(
        self,
        *,
        question: str,
        evidence: list[EvidenceHit],
        locale: str,
        vacancy_context: str | None = None,
    ) -> GroundedAnswer:
        from app.generation.prompts import GROUNDING_RULES, build_answer_prompt
        from app.generation.schemas import AnswerPayload

        payload = self._parse(
            system=GROUNDING_RULES,
            prompt=build_answer_prompt(
                question, evidence, locale, vacancy_context=vacancy_context
            ),
            output_format=AnswerPayload,
            operation="generate a grounded answer",
        )
        return GroundedAnswer(
            answer=payload.answer,
            cited_chunk_ids=list(payload.cited_chunk_ids),
            status=payload.status,
            model=self._model,
        )

    def generate_candidate_summary(
        self,
        *,
        evidence: list[EvidenceHit],
        locale: str,
        vacancy_context: str | None = None,
    ) -> GroundedAnswer:
        from app.generation.prompts import GROUNDING_RULES, build_summary_prompt
        from app.generation.schemas import AnswerPayload

        payload = self._parse(
            system=GROUNDING_RULES,
            prompt=build_summary_prompt(
                evidence, locale, vacancy_context=vacancy_context
            ),
            output_format=AnswerPayload,
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

        payload = self._parse(
            system=GROUNDING_RULES,
            prompt=build_interview_questions_prompt(
                requirement, evidence, locale, evidence_found=evidence_found
            ),
            output_format=QuestionsPayload,
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

    def generate_match_explanations(
        self, *, context: str, vacancy_ids: list[str], locale: str
    ) -> dict[str, str]:
        from app.generation.prompts import (
            CANDIDATE_MATCH_RULES,
            build_match_explanations_prompt,
        )
        from app.generation.schemas import MatchExplanationsPayload

        payload = self._parse(
            system=CANDIDATE_MATCH_RULES,
            prompt=build_match_explanations_prompt(context, locale),
            output_format=MatchExplanationsPayload,
            operation="generate job match explanations",
        )
        wanted = set(vacancy_ids)
        return {
            e.vacancy_id: e.explanation
            for e in payload.explanations
            if e.vacancy_id in wanted and e.explanation.strip()
        }

    def generate_external_why_match(
        self, *, context: str, locale: str
    ) -> ExternalWhyMatch:
        from app.generation.prompts import (
            EXTERNAL_WHY_MATCH_RULES,
            build_external_why_match_prompt,
        )
        from app.generation.schemas import ExternalWhyMatchPayload

        payload = self._parse(
            system=EXTERNAL_WHY_MATCH_RULES,
            prompt=build_external_why_match_prompt(context, locale),
            output_format=ExternalWhyMatchPayload,
            operation="generate an external match explanation",
        )
        return bounded_why_match(payload)

    # -- transport ---------------------------------------------------------

    def _parse(self, *, system: str, prompt: str, output_format, operation: str):
        if not self.enabled:
            raise GenerationDisabledError(operation)

        started = time.perf_counter()
        try:
            response = self._sdk().messages.parse(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                # Adaptive thinking: deciding what a passage does and does not
                # support benefits from deliberation.
                thinking={"type": "adaptive"},
                messages=[{"role": "user", "content": prompt}],
                output_format=output_format,
            )
        except Exception as exc:
            # Never let a provider error message reach a client — it can quote
            # the prompt, which contains resume text.
            logger.error(
                "LLM request failed",
                extra={
                    "stage": "generation",
                    "operation": operation,
                    "model": self._model,
                    "errorType": type(exc).__name__,
                },
            )
            raise GenerationFailedError(f"LLM request failed: {type(exc).__name__}") from exc

        if response.stop_reason == "refusal":
            raise GenerationFailedError("The model declined to answer this request")

        parsed = response.parsed_output
        if parsed is None:
            raise GenerationFailedError("The model returned no structured output")

        logger.info(
            "Generation completed",
            extra={
                "stage": "generation",
                "operation": operation,
                "model": self._model,
                "durationMs": int((time.perf_counter() - started) * 1000),
                "inputTokens": getattr(response.usage, "input_tokens", None),
                "outputTokens": getattr(response.usage, "output_tokens", None),
            },
        )
        return parsed

"""Structured-output schemas the LLM must fill.

Asking for citations as a typed field (rather than parsing them out of prose)
means an answer either carries machine-checkable references or it does not.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AnswerPayload(BaseModel):
    answer: str = Field(
        description=(
            "The answer, written in the requested language, using only the "
            "supplied evidence passages."
        )
    )
    cited_chunk_ids: list[str] = Field(
        default_factory=list,
        description=(
            "chunkId of every passage relied on. Must be ids that appear in "
            "the supplied evidence; never invent one."
        ),
    )
    status: Literal["GROUNDED", "INSUFFICIENT_EVIDENCE", "NEEDS_HUMAN_REVIEW"] = Field(
        description=(
            "GROUNDED when the evidence fully supports the answer. "
            "INSUFFICIENT_EVIDENCE when the passages do not answer the "
            "question. NEEDS_HUMAN_REVIEW when the evidence is partial or "
            "ambiguous. Describes the ANSWER, never the candidate."
        )
    )


class QuestionPayload(BaseModel):
    question: str = Field(description="An open interview question for a human to ask.")
    reason: str = Field(
        description="Why this question is worth asking, referencing the evidence."
    )
    cited_chunk_ids: list[str] = Field(
        default_factory=list,
        description="chunkId of any evidence this question was drawn from.",
    )


class QuestionsPayload(BaseModel):
    questions: list[QuestionPayload] = Field(default_factory=list)


class MatchExplanationPayload(BaseModel):
    vacancy_id: str = Field(
        description="The vacancyId this explanation belongs to, copied exactly."
    )
    explanation: str = Field(
        description=(
            "2-4 sentences, in the requested language, addressed to the job "
            "seeker, describing why this role relates to their documented "
            "experience and which stated requirements their documents do not "
            "show. Uses only the supplied facts."
        )
    )


class MatchExplanationsPayload(BaseModel):
    explanations: list[MatchExplanationPayload] = Field(default_factory=list)

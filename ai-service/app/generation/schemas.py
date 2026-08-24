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


class WhyMatchItemPayload(BaseModel):
    title: str = Field(
        description=(
            "A short label for this point (2-6 words, in the requested "
            "language)."
        )
    )
    explanation: str = Field(
        description=(
            "1-2 concise sentences, in the requested language, grounded ONLY "
            "in the supplied facts."
        )
    )


class ExternalWhyMatchPayload(BaseModel):
    """The structured 'why this external job matches you' answer.

    Bounds are enforced twice: described here for the model, and clamped by
    the caller after validation — the model's cooperation is expected, never
    trusted.
    """

    summary: str = Field(
        description=(
            "80-150 words, in the requested language, addressed to the job "
            "seeker: how this specific job relates to their documented "
            "profile. Uses only supplied facts; no scores or percentages."
        )
    )
    strengths: list[WhyMatchItemPayload] = Field(
        default_factory=list,
        description="2-4 genuine alignment points, strongest first.",
    )
    gaps: list[WhyMatchItemPayload] = Field(
        default_factory=list,
        description=(
            "0-2 honest gaps or unknowns. Return FEWER or none rather than "
            "inventing a weakness to fill the list."
        ),
    )


class ExternalCoverLetterPayload(BaseModel):
    """The structured cover letter draft.

    Bounds and honesty are enforced twice: described here for the model, and
    clamped/validated by the caller after parsing — the model's cooperation
    is expected, never trusted.
    """

    subject: str = Field(
        description=(
            "A short application subject line in the requested language, "
            'e.g. "Application for Backend Engineer". Keep company, product '
            "and technology names in their original form."
        )
    )
    content: str = Field(
        description=(
            "The letter body: roughly 250-450 words of plain professional "
            "text in the requested language, written in the candidate's own "
            "first-person voice. No markdown syntax, no bullet characters, "
            "no headings, no placeholders. Open with a neutral greeting "
            'appropriate to the language (such as "Dear Hiring Team,") — '
            "never an invented recipient name. Close politely WITHOUT a "
            "signature name, because the sender's name is not supplied. "
            "Every claim must be grounded ONLY in the supplied candidate "
            "facts."
        )
    )


class InterviewQuestionPayload(BaseModel):
    question: str = Field(
        description=(
            "One realistic interview question for THIS specific job, in the "
            "requested language."
        )
    )
    whyAsked: str = Field(
        description=(
            "1-2 sentences on why this employer would plausibly ask it, "
            "grounded in the supplied job facts."
        )
    )
    preparation: str = Field(
        description=(
            "2-3 sentences of preparation advice grounded ONLY in the "
            "candidate's supplied facts: point at the experience or skills "
            "they actually state, or — where the job asks for something "
            "their profile does not show — advise preparing an honest "
            "account of their real current level. Never script a fabricated "
            "answer."
        )
    )


class InterviewFocusAreaPayload(BaseModel):
    title: str = Field(
        description=(
            "A short label (2-6 words, in the requested language) for one "
            "preparation theme specific to this job and candidate."
        )
    )
    guidance: str = Field(
        description=(
            "2-4 sentences of concrete guidance for this theme, grounded "
            "ONLY in the supplied facts."
        )
    )


class ExternalInterviewPrepPayload(BaseModel):
    """The structured interview preparation answer."""

    questions: list[InterviewQuestionPayload] = Field(
        default_factory=list,
        description=(
            "5-8 questions this candidate should prepare for, most "
            "important first. Every question must be motivated by a "
            "supplied job fact or match fact — no generic filler."
        ),
    )
    focusAreas: list[InterviewFocusAreaPayload] = Field(
        default_factory=list,
        description=(
            "2-4 preparation themes. Return FEWER rather than inventing an "
            "irrelevant theme to fill the list."
        ),
    )


class BreakdownExplanationPayload(BaseModel):
    key: str = Field(
        description=(
            "The dimension key EXACTLY as supplied in the dimension table "
            "(e.g. 'skills', 'salary'). Never invent a key that was not "
            "supplied."
        )
    )
    explanation: str = Field(
        description=(
            "1-2 concise sentences, in the requested language, explaining "
            "this dimension's ALREADY-DECIDED status using only the "
            "supplied facts. Never restate the status as a different "
            "verdict, and never add a score or percentage."
        )
    )


class ExternalMatchBreakdownPayload(BaseModel):
    """The structured breakdown answer: a summary plus one explanation per
    supplied dimension. There is deliberately no status, score or ranking
    field — the system decided every status before this model was called."""

    summary: str = Field(
        description=(
            "60-120 words, in the requested language, addressed to the job "
            "seeker: an honest overview of how the supplied dimension "
            "verdicts fit together. Uses only supplied facts; no scores, "
            "percentages or hiring probabilities."
        )
    )
    explanations: list[BreakdownExplanationPayload] = Field(
        default_factory=list,
        description=(
            "Exactly one entry per supplied dimension key, same order as "
            "supplied."
        ),
    )

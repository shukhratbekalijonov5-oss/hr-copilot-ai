"""JD -> candidate evidence mapping, and interview questions built from it.

Mapping is pure retrieval + classification: no LLM is involved, so it works
whether or not generation is configured. Interview questions sit on top and do
need generation.
"""

from __future__ import annotations

import time

from app.common import metrics
from app.common.logging import get_logger
from app.config import Settings
from app.generation import GenerationClient, validate_citations
from app.mapping.requirement_mapping import (
    EVIDENCE_FOUND,
    MappingThresholds,
    classify_requirement,
)
from app.models.schemas import (
    Citation,
    EvidenceMapResponse,
    InterviewQuestion,
    InterviewQuestionsResponse,
    RequirementInput,
    RequirementMapping,
)
from app.retrieval.search import search_evidence

logger = get_logger(__name__)


def _thresholds(settings: Settings) -> MappingThresholds:
    return MappingThresholds(
        lexical_found=settings.mapping_lexical_found,
        semantic_review=settings.mapping_semantic_review,
        max_evidence=settings.mapping_max_evidence,
    )


def map_requirements(
    *,
    candidate_account_id: str,
    vacancy_id: str,
    requirements: list[RequirementInput],
    settings: Settings,
    embedder,
    store,
    reranker,
    allowed_source_ids: list[str] | None = None,
) -> EvidenceMapResponse:
    """Runs candidate-scoped retrieval for each requirement and classifies it.

    ``allowed_source_ids`` restricts every requirement's retrieval to the
    candidate's SURVIVING sources. Without it a requirement could come back
    EVIDENCE_FOUND on the strength of a passage from a file or link the
    candidate has withdrawn — a recruiter would read a verdict supported by
    evidence that no longer exists anywhere else in the product.
    """
    started = time.perf_counter()
    metrics.increment(metrics.JD_MAPPING_TOTAL)
    limits = _thresholds(settings)
    mapped: list[RequirementMapping] = []

    for requirement in requirements:
        retrieval = search_evidence(
            # Candidate-scoped: a requirement is judged against THIS person's
            # CURRENT documents and links, never against the corpus at large.
            candidate_account_ids=[candidate_account_id],
            query=requirement.text,
            limit=settings.mapping_candidate_pool,
            document_id=None,
            use_rerank=True,
            settings=settings,
            embedder=embedder,
            store=store,
            reranker=reranker,
            allowed_source_ids=allowed_source_ids,
        )

        result = classify_requirement(
            requirement_id=requirement.requirementId,
            requirement_text=requirement.text,
            hits=retrieval.hits,
            thresholds=limits,
        )

        mapped.append(
            RequirementMapping(
                requirementId=result.requirement_id,
                requirementText=result.requirement_text,
                status=result.status,
                evidence=[_to_citation(h) for h in result.evidence],
                matchedTerms=result.matched_terms,
                missingTerms=result.missing_terms,
                reason=result.reason,
            )
        )

    logger.info(
        "Requirement mapping completed",
        extra={
            "vacancyId": vacancy_id,
            "stage": "jd_mapping",
            "requirementCount": len(requirements),
            "found": sum(1 for m in mapped if m.status == EVIDENCE_FOUND),
            "durationMs": int((time.perf_counter() - started) * 1000),
        },
    )

    metrics.observe_ms(
        metrics.JD_MAPPING_DURATION, (time.perf_counter() - started) * 1000
    )
    return EvidenceMapResponse(
        candidateAccountId=candidate_account_id,
        vacancyId=vacancy_id,
        requirements=mapped,
        durationMs=int((time.perf_counter() - started) * 1000),
    )


def generate_interview_questions(
    *,
    candidate_account_id: str,
    vacancy_id: str,
    requirements: list[RequirementInput],
    locale: str,
    settings: Settings,
    embedder,
    store,
    reranker,
    generator: GenerationClient,
    allowed_source_ids: list[str] | None = None,
) -> InterviewQuestionsResponse:
    """Builds interview prompts from what the evidence does and does not show.

    Questions are prompts for a human interviewer. A question generated because
    evidence is missing is marked `missing_requirement_probe` so the UI can
    present it as "worth asking about", never as a deficiency.
    """
    started = time.perf_counter()
    mapping = map_requirements(
        candidate_account_id=candidate_account_id,
        vacancy_id=vacancy_id,
        requirements=requirements,
        settings=settings,
        embedder=embedder,
        store=store,
        reranker=reranker,
        allowed_source_ids=allowed_source_ids,
    )

    questions: list[InterviewQuestion] = []

    for requirement, mapped in zip(requirements, mapping.requirements):
        evidence_found = mapped.status == EVIDENCE_FOUND
        context = _citations_to_hits(mapped.evidence, candidate_account_id)

        generated = generator.generate_interview_questions(
            requirement=requirement.text,
            evidence=context,
            locale=locale,
            evidence_found=evidence_found,
        )

        for item in generated:
            outcome = validate_citations(
                item.cited_chunk_ids,
                context,
                allowed_account_ids={candidate_account_id},
            )
            questions.append(
                InterviewQuestion(
                    question=item.question,
                    reason=item.reason,
                    kind="evidence_probe" if evidence_found else "missing_requirement_probe",
                    requirementId=requirement.requirementId,
                    citations=outcome.citations,
                )
            )

    return InterviewQuestionsResponse(
        candidateAccountId=candidate_account_id,
        vacancyId=vacancy_id,
        questions=questions,
        locale=locale,
        durationMs=int((time.perf_counter() - started) * 1000),
        model=generator.model or None,
    )


def _to_citation(hit) -> Citation:
    """Carries provenance through, INCLUDING which kind of source it was.

    Dropping the source fields here would make every mapped citation look like
    a file: "Portfolio Website · Projects" would be presented as a document
    with no page number rather than a page a recruiter can open.
    """
    return Citation(
        chunkId=hit.chunkId,
        documentId=hit.documentId,
        fileName=hit.fileName,
        pageNumber=hit.pageNumber,
        section=hit.section,
        text=hit.text,
        sourceType=hit.sourceType,
        sourceTitle=hit.sourceTitle or hit.fileName,
        sourceUrl=hit.sourceUrl,
    )


def _citations_to_hits(citations: list[Citation], candidate_account_id: str):
    """Re-wraps stored citations as hits so validation can check against them."""
    from app.models.schemas import EvidenceHit

    return [
        EvidenceHit(
            chunkId=c.chunkId,
            candidateAccountId=candidate_account_id,
            documentId=c.documentId,
            fileName=c.fileName,
            section=c.section,
            pageNumber=c.pageNumber,
            chunkIndex=0,
            text=c.text,
            retrievalScore=0.0,
            # Kept, so a question generated from link evidence cites the link
            # rather than a nameless "document".
            sourceType=c.sourceType,
            sourceTitle=c.sourceTitle or c.fileName,
            sourceUrl=c.sourceUrl,
        )
        for c in citations
    ]

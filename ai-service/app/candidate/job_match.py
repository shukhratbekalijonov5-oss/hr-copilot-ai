"""Candidate → vacancy matching: the reverse of recruiter evidence search.

Pipeline (bounded at every stage — no per-vacancy LLM loop):

    candidate profile + personal resume chunks
    → one search representation → one embedding
    → vacancy vector retrieval (OPEN only, pool-limited)
    → cross-encoder rerank of grouped vacancies
    → per-requirement evidence classification (deterministic, no LLM,
      reusing the same lexical+semantic mapper the recruiter side uses)
    → deterministic match label
    → ONE batched Gemini call for candidate-facing explanations

## The match label rule (deterministic, documented, tested)

Only requirement-coverage counts decide the label. Let R be the vacancy's
REQUIRED requirements (or all of them when none is flagged required), and
S / U / C the number of R classified SUPPORTED / UNSUPPORTED / UNCLEAR:

    no requirements at all      → PARTIAL   (nothing verifiable either way)
    U == 0 and S >= 1 and S >= C → STRONG   (nothing required is missing, and
                                             at least as much is supported as
                                             is unclear)
    S == 0 or U > S              → WEAK     (nothing supported, or more
                                             missing than supported)
    otherwise                    → PARTIAL

Never a percentage, never a rating, never an LLM decision. Gemini only writes
the explanation text afterwards, and it is told the label rather than asked
for one.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.candidate.store import CandidateResumeStore, VacancyStore
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.mapping.requirement_mapping import (
    EVIDENCE_FOUND,
    NO_EVIDENCE_FOUND,
    MappingThresholds,
    classify_requirement,
)
from app.models.schemas import (
    CandidateProfileInput,
    EvidenceHit,
    JobMatch,
    JobMatchRequest,
    JobMatchResponse,
    MatchEvidence,
    RequirementCheck,
)

logger = get_logger(__name__)

# Length caps keep the representation inside the embedder/reranker windows.
_REPRESENTATION_CHARS = 1600
_VACANCY_TEXT_CHARS = 1200
_EVIDENCE_SNIPPET_CHARS = 220
_MAX_EVIDENCE_PER_MATCH = 5


@dataclass
class _VacancyCandidate:
    vacancy_id: str
    organization_id: str
    title: str
    texts: list[str] = field(default_factory=list)
    requirements: list[dict] = field(default_factory=list)
    best_score: float = 0.0
    rerank_score: float | None = None


def match_jobs(
    *,
    request: JobMatchRequest,
    settings: Settings,
    embedder: EmbeddingModel,
    resume_store: CandidateResumeStore,
    vacancy_store: VacancyStore,
    reranker,
    generator,
) -> JobMatchResponse:
    started = time.perf_counter()
    account_id = request.candidateAccountId

    representation = _candidate_representation(
        request.profile, resume_store, account_id
    )
    if not representation.strip():
        # Nothing to match on. The backend guards this too; belt and braces.
        return JobMatchResponse(
            matches=[], locale=request.locale, vacanciesConsidered=0,
            generated=False, durationMs=_ms(started),
        )

    # --- stage 1: vector retrieval over OPEN vacancies ----------------------
    query_vector = embedder.encode_query(representation)
    hits = vacancy_store.search_open(
        query_vector=query_vector, limit=settings.match_vacancy_pool
    )
    grouped = _group_by_vacancy(hits)

    # --- stage 2: rerank whole vacancies against the representation ---------
    ordered = _rerank_vacancies(representation, list(grouped.values()), reranker)
    top = ordered[: request.limit]

    # --- stage 3: deterministic requirement comparison ----------------------
    thresholds = MappingThresholds(
        lexical_found=settings.mapping_lexical_found,
        semantic_review=settings.mapping_semantic_review,
        max_evidence=settings.mapping_max_evidence,
    )
    profile_hits = _profile_pseudo_hits(request.profile)
    matches: list[JobMatch] = []
    for vacancy in top:
        matches.append(
            _compare_vacancy(
                vacancy,
                account_id=account_id,
                profile_hits=profile_hits,
                thresholds=thresholds,
                settings=settings,
                embedder=embedder,
                resume_store=resume_store,
                reranker=reranker,
            )
        )

    # --- stage 4: ONE batched explanation call ------------------------------
    generated = False
    if matches and generator is not None and generator.enabled:
        try:
            explanations = generator.generate_match_explanations(
                context=_explanation_context(matches),
                vacancy_ids=[m.vacancyId for m in matches],
                locale=request.locale,
            )
            for m in matches:
                m.explanation = explanations.get(m.vacancyId)
            generated = True
        except GenerationUnavailableError as exc:
            # The labels and evidence are deterministic and already computed;
            # a provider hiccup must not throw them away. `generated: false`
            # states honestly that no explanation text exists.
            logger.warning(
                "Match explanations unavailable; returning deterministic "
                "matches without prose",
                extra={"stage": "job_match", "errorType": type(exc).__name__},
            )

    logger.info(
        "Job matches computed",
        extra={
            "stage": "job_match",
            "candidateAccountId": account_id,
            "vacanciesConsidered": len(grouped),
            "matchesReturned": len(matches),
            "generated": generated,
            "durationMs": _ms(started),
        },
    )
    return JobMatchResponse(
        matches=matches,
        locale=request.locale,
        vacanciesConsidered=len(grouped),
        generated=generated,
        durationMs=_ms(started),
    )


def classify_match(
    supported: list[RequirementCheck],
    unsupported: list[RequirementCheck],
    unclear: list[RequirementCheck],
) -> str:
    """The deterministic label rule. See the module docstring for the table."""
    all_checks = [(c, "S") for c in supported]
    all_checks += [(c, "U") for c in unsupported]
    all_checks += [(c, "C") for c in unclear]
    if not all_checks:
        return "PARTIAL"

    considered = [(c, s) for c, s in all_checks if c.required] or all_checks
    s = sum(1 for _, kind in considered if kind == "S")
    u = sum(1 for _, kind in considered if kind == "U")
    c = sum(1 for _, kind in considered if kind == "C")

    if u == 0 and s >= 1 and s >= c:
        return "STRONG"
    if s == 0 or u > s:
        return "WEAK"
    return "PARTIAL"


# -- internals -----------------------------------------------------------------


def _candidate_representation(
    profile: CandidateProfileInput,
    resume_store: CandidateResumeStore,
    account_id: str,
) -> str:
    """Compact text standing in for the candidate in vector space.

    Canonical profile first (it is curated), resume chunk text after, the
    whole thing capped so it fits the embedder's window.
    """
    parts: list[str] = []
    if profile.headline:
        parts.append(profile.headline)
    if profile.skills:
        parts.append("Skills: " + ", ".join(profile.skills))
    if profile.languages:
        parts.append("Languages: " + ", ".join(profile.languages))
    for exp in profile.experience:
        line = exp.title + (f" at {exp.company}" if exp.company else "")
        if exp.description:
            line += f": {exp.description}"
        parts.append(line)
    for edu in profile.education:
        parts.append(
            " ".join(x for x in (edu.degree, edu.field, "—", edu.institution) if x)
        )
    if profile.summary:
        parts.append(profile.summary)

    for chunk in resume_store.list_chunks(account_id, limit=8):
        text = str(chunk.get("text", "")).strip()
        if text:
            parts.append(text)

    return "\n".join(parts)[:_REPRESENTATION_CHARS]


def _group_by_vacancy(hits) -> dict[str, _VacancyCandidate]:
    grouped: dict[str, _VacancyCandidate] = {}
    for hit in hits:
        payload = hit.payload
        vacancy_id = str(payload.get("vacancyId", ""))
        if not vacancy_id:
            continue
        entry = grouped.get(vacancy_id)
        if entry is None:
            entry = _VacancyCandidate(
                vacancy_id=vacancy_id,
                organization_id=str(payload.get("organizationId", "")),
                title=str(payload.get("title", "")),
                requirements=list(payload.get("requirements") or []),
            )
            grouped[vacancy_id] = entry
        entry.texts.append(str(payload.get("text", "")))
        entry.best_score = max(entry.best_score, hit.score)
    return grouped


def _rerank_vacancies(
    representation: str, vacancies: list[_VacancyCandidate], reranker
) -> list[_VacancyCandidate]:
    if not vacancies:
        return []
    if reranker is None:
        return sorted(vacancies, key=lambda v: v.best_score, reverse=True)

    docs = [
        (v.title + "\n" + "\n".join(v.texts))[:_VACANCY_TEXT_CHARS]
        for v in vacancies
    ]
    scores = reranker.score(representation, docs)
    for vacancy, score in zip(vacancies, scores):
        vacancy.rerank_score = float(score)
    return sorted(vacancies, key=lambda v: v.rerank_score or 0.0, reverse=True)


def _profile_pseudo_hits(profile: CandidateProfileInput) -> list[EvidenceHit]:
    """Canonical profile fields as evidence passages.

    They join the retrieved resume chunks in requirement classification, so a
    skill the candidate curated on their profile counts as evidence with
    honest provenance (fileName "Profile", no page number). rerank scoring
    treats them like any other passage.
    """
    entries: list[tuple[str, str]] = []
    if profile.skills:
        entries.append(("skills", "Skills: " + ", ".join(profile.skills)))
    if profile.languages:
        entries.append(("languages", "Languages: " + ", ".join(profile.languages)))
    for i, exp in enumerate(profile.experience):
        line = exp.title + (f" at {exp.company}" if exp.company else "")
        if exp.description:
            line += f". {exp.description}"
        entries.append((f"experience-{i + 1}", line))
    for i, edu in enumerate(profile.education):
        entries.append(
            (
                f"education-{i + 1}",
                " ".join(x for x in (edu.degree, edu.field, edu.institution) if x),
            )
        )
    if profile.headline:
        entries.append(("headline", profile.headline))
    if profile.summary:
        entries.append(("summary", profile.summary))

    return [
        EvidenceHit(
            chunkId=f"profile:{name}",
            candidateId=None,
            documentId="profile",
            fileName="Profile",
            section=name,
            pageNumber=None,
            chunkIndex=index,
            text=text,
            retrievalScore=0.0,
        )
        for index, (name, text) in enumerate(entries)
        if text.strip()
    ]


def _compare_vacancy(
    vacancy: _VacancyCandidate,
    *,
    account_id: str,
    profile_hits: list[EvidenceHit],
    thresholds: MappingThresholds,
    settings: Settings,
    embedder: EmbeddingModel,
    resume_store: CandidateResumeStore,
    reranker,
) -> JobMatch:
    supported: list[RequirementCheck] = []
    unsupported: list[RequirementCheck] = []
    unclear: list[RequirementCheck] = []
    evidence: list[MatchEvidence] = []
    seen_evidence: set[tuple[str, int]] = set()

    requirements = vacancy.requirements[: settings.match_max_requirements]
    for index, req in enumerate(requirements):
        text = str(req.get("text", "")).strip()
        if not text:
            continue
        required = bool(req.get("required", True))

        resume_hits = [
            _to_hit(h.payload, h.score)
            for h in resume_store.search(
                candidate_account_id=account_id,
                query_vector=embedder.encode_query(text),
                limit=settings.mapping_candidate_pool,
            )
        ]
        combined = resume_hits + profile_hits
        if reranker is not None and combined:
            scores = reranker.score(text, [h.text for h in combined])
            for hit, score in zip(combined, scores):
                hit.rerankScore = float(score)
            combined.sort(key=lambda h: h.rerankScore or 0.0, reverse=True)
        combined = combined[: settings.mapping_candidate_pool]

        result = classify_requirement(
            requirement_id=f"{vacancy.vacancy_id}:{index}",
            requirement_text=text,
            hits=combined,
            thresholds=thresholds,
        )
        check = RequirementCheck(text=text, required=required, reason=result.reason)
        if result.status == EVIDENCE_FOUND:
            supported.append(check)
        elif result.status == NO_EVIDENCE_FOUND:
            unsupported.append(check)
        else:
            unclear.append(check)

        # Evidence provenance survives into the response: resume page/section
        # or the profile field, never a bare id.
        for hit in result.evidence:
            key = (hit.documentId, hit.chunkIndex)
            if key in seen_evidence or len(evidence) >= _MAX_EVIDENCE_PER_MATCH:
                continue
            seen_evidence.add(key)
            evidence.append(
                MatchEvidence(
                    fileName=hit.fileName,
                    pageNumber=hit.pageNumber,
                    section=hit.section,
                    text=hit.text[:_EVIDENCE_SNIPPET_CHARS],
                )
            )

    return JobMatch(
        vacancyId=vacancy.vacancy_id,
        organizationId=vacancy.organization_id,
        title=vacancy.title,
        match=classify_match(supported, unsupported, unclear),
        explanation=None,
        supportedRequirements=supported,
        unsupportedRequirements=unsupported,
        unclearRequirements=unclear,
        evidence=evidence,
    )


def _explanation_context(matches: list[JobMatch]) -> str:
    """The facts Gemini may use — nothing else exists as far as it knows."""
    blocks: list[str] = []
    for m in matches:
        lines = [f"vacancyId: {m.vacancyId}", f"Role: {m.title}", f"Match category: {m.match}"]
        if m.supportedRequirements:
            lines.append("Requirements SUPPORTED by the candidate's documents:")
            lines += [f"  - {c.text}" for c in m.supportedRequirements]
        if m.unsupportedRequirements:
            lines.append("Requirements NOT shown in the documents:")
            lines += [f"  - {c.text}" for c in m.unsupportedRequirements]
        if m.unclearRequirements:
            lines.append("Requirements that are UNCLEAR from the documents:")
            lines += [f"  - {c.text}" for c in m.unclearRequirements]
        if m.evidence:
            lines.append("Evidence passages:")
            lines += [
                f"  - ({e.fileName or 'document'}"
                + (f", page {e.pageNumber}" if e.pageNumber else "")
                + f") {e.text}"
                for e in m.evidence
            ]
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


def _to_hit(payload: dict, score: float) -> EvidenceHit:
    return EvidenceHit(
        chunkId=str(payload.get("chunkId", "")),
        candidateId=None,
        documentId=str(payload.get("documentId", "")),
        fileName=payload.get("fileName"),
        section=payload.get("section"),
        pageNumber=payload.get("pageNumber"),
        chunkIndex=int(payload.get("chunkIndex", 0)),
        text=str(payload.get("text", "")),
        retrievalScore=score,
    )


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)

"""Candidate → vacancy matching: rank EVERY eligible vacancy, best first.

    candidate profile + ALL indexed personal evidence
    → capability profile (skills, role families, several probe texts)
    → ONE embedding per probe
    → EVERY eligible vacancy fetched by id (not a top-K search)
    → multi-signal scoring of all of them
    → deterministic ranking, strongest to weakest
    → optional batched explanations for the page the caller will show

## What changed, and why it had to

The previous pipeline asked the index for the top 32 CHUNKS, grouped them into
~30 vacancies, and truncated to `request.limit` — default 5, capped at 10. With
153 open vacancies, 148 of them were never compared to the candidate at all,
and "why is this job missing?" had no answer because it had never been scored.

Three specific defects, all fixed here:

1. **The universe was a top-K search.** Now the caller passes the eligible
   vacancy ids and every one is fetched and scored. Retrieval is no longer a
   filter, and a stale index entry cannot appear in results because the
   database, not the index, decides what is eligible.
2. **`limit` truncated before ranking.** The full ranked list is returned; the
   application paginates it. The count of results is not the model's decision
   and not a side effect of a vector search.
3. **One 1600-character representation of the candidate.** A full-stack person
   became one vector between frontend and backend, matching neither well —
   which is exactly why every one of Uchqun's results was titled "Backend
   Engineer". Now several probes, built from ALL their evidence.

## Scoring

Five weighted signals, in `ranking.py`, with the score deciding the tier so the
two can never disagree. Tiers stay the three the product already localizes —
STRONG / PARTIAL / WEAK — because inventing a four-label vocabulary would mean
new copy in four languages for no gain in meaning.

Gemini writes explanation prose and nothing else. It is told the label; it is
never asked how many jobs exist.
"""

from __future__ import annotations

import time

from app.candidate.capability import (
    MAX_EVIDENCE_CHUNKS,
    CandidateCapabilityProfile,
    build_capability_profile,
)
from app.candidate.ranking import ScoredVacancy, VacancyCandidate, rank_vacancies
from app.candidate.store import CandidateResumeStore, VacancyStore
from app.common.errors import GenerationUnavailableError
from app.common.logging import get_logger
from app.config import Settings
from app.embeddings import EmbeddingModel
from app.mapping.requirement_mapping import MappingThresholds
from app.models.schemas import (
    EvidenceHit,
    JobMatch,
    JobMatchRequest,
    JobMatchResponse,
    MatchEvidence,
    RequirementCheck,
    RequirementInsight,
)

logger = get_logger(__name__)

_EVIDENCE_SNIPPET_CHARS = 220
_MAX_EVIDENCE_PER_MATCH = 5


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
    allowed = request.allowedSourceIds

    # ZERO EVIDENCE. An empty allowlist says the candidate has no files and no
    # links at all. Matching is evidence-grounded, so there is nothing here to
    # ground it in — and the profile fields below must NOT be allowed to stand
    # in for evidence, or a candidate who deleted everything would still get an
    # analysis assembled from their headline.
    if allowed is not None and len(allowed) == 0:
        logger.info(
            "Job match requested with no surviving evidence; nothing generated",
            extra={"stage": "job_match", "candidateAccountId": account_id},
        )
        return JobMatchResponse(
            matches=[], locale=request.locale, vacanciesConsidered=0,
            generated=False, durationMs=_ms(started),
        )

    # --- stage 1: what can this candidate do? ------------------------------
    # EVERY indexed chunk, not the first eight — and WITH vectors, so every
    # requirement can be scored against them in process.
    chunks = resume_store.list_chunks(
        account_id,
        limit=MAX_EVIDENCE_CHUNKS,
        allowed_source_ids=allowed,
        with_vectors=True,
    )
    capability = build_capability_profile(profile=request.profile, chunks=chunks)

    if not capability.probes:
        return JobMatchResponse(
            matches=[], locale=request.locale, vacanciesConsidered=0,
            generated=False, durationMs=_ms(started),
        )

    probe_vectors = [embedder.encode_query(probe) for probe in capability.probes]

    # --- stage 2: the ELIGIBLE universe, decided by the caller -------------
    eligible_ids = request.eligibleVacancyIds
    if eligible_ids is None:
        # No explicit universe: fall back to the whole indexed OPEN set. The
        # backend always sends one; this keeps the endpoint usable on its own
        # (tests, diagnostics) without silently ranking a top-K subset.
        raw = vacancy_store.search_open(
            query_vector=probe_vectors[0], limit=settings.match_vacancy_pool
        )
        eligible_ids = sorted({str(h.payload.get("vacancyId", "")) for h in raw} - {""})

    if not eligible_ids:
        return JobMatchResponse(
            matches=[], locale=request.locale, vacanciesConsidered=0,
            generated=False, durationMs=_ms(started),
        )

    capped = eligible_ids[: settings.match_max_vacancies]
    if len(capped) < len(eligible_ids):
        # Never silent: a truncated universe is exactly the failure this
        # rewrite exists to remove, so if it ever happens it is stated.
        logger.warning(
            "Eligible vacancy set exceeds match_max_vacancies; ranking a prefix",
            extra={
                "stage": "job_match",
                "eligible": len(eligible_ids),
                "ranked": len(capped),
                "cap": settings.match_max_vacancies,
            },
        )

    rows = vacancy_store.fetch_vacancies(capped)
    vacancies = _assemble(rows, probe_vectors)

    # --- stage 3: score EVERY one of them ----------------------------------
    thresholds = MappingThresholds(
        lexical_found=settings.mapping_lexical_found,
        semantic_review=settings.mapping_semantic_review,
        max_evidence=settings.mapping_max_evidence,
    )
    profile_hits = _profile_pseudo_hits(request.profile)

    # THE PERFORMANCE DECISION.
    #
    # Every distinct requirement across every vacancy is embedded in ONE batched
    # call, and matched against the candidate's chunks in process. The obvious
    # implementation — embed each requirement and run a Qdrant search per
    # requirement — measured 350 seconds for 153 vacancies (181 distinct
    # requirements at ~1.9s each, most of it a cross-encoder pass over a
    # handful of passages). Since the candidate's whole evidence set is ~50
    # vectors, comparing in memory is exact AND orders of magnitude cheaper
    # than asking a vector database 181 times.
    requirement_texts = sorted(
        {
            str(req.get("text", "")).strip()
            for vacancy in vacancies
            for req in vacancy.requirements[: settings.match_max_requirements]
            if str(req.get("text", "")).strip()
        }
    )
    evidence_cache = _build_evidence_map(
        requirement_texts=requirement_texts,
        chunks=chunks,
        profile_hits=profile_hits,
        embedder=embedder,
        pool=settings.mapping_candidate_pool,
    )

    def evidence_for(requirement_text: str) -> list[EvidenceHit]:
        return evidence_cache.get(requirement_text, list(profile_hits))

    scored = rank_vacancies(
        capability=capability,
        vacancies=vacancies,
        evidence_hits_for=evidence_for,
        thresholds=thresholds,
        max_requirements=settings.match_max_requirements,
    )

    matches = [_to_match(entry, rank) for rank, entry in enumerate(scored, start=1)]

    # --- stage 4: explanations, for the requested WINDOW only --------------
    # Generation is the expensive stage, so it is spent on the slice the caller
    # will actually show. Everything else is already ranked and returned; a
    # match without prose is still a match, and `generated` says so.
    generated = _explain(
        matches=matches,
        request=request,
        generator=generator,
        settings=settings,
    )

    logger.info(
        "Job matches ranked",
        extra={
            "stage": "job_match",
            "candidateAccountId": account_id,
            "evidenceChunks": len(chunks),
            "evidenceSources": len(capability.evidence_sources),
            "skills": len(capability.skills),
            "roleFamilies": sorted(capability.role_families),
            "probes": len(capability.probes),
            "eligible": len(eligible_ids),
            "fetched": len(vacancies),
            "ranked": len(matches),
            "explained": sum(1 for m in matches if m.explanation),
            "tiers": _tier_counts(matches),
            "requirementQueries": len(evidence_cache),
            "durationMs": _ms(started),
        },
    )
    return JobMatchResponse(
        matches=matches,
        locale=request.locale,
        vacanciesConsidered=len(vacancies),
        eligibleConsidered=len(eligible_ids),
        generated=generated,
        capability=_capability_summary(capability),
        durationMs=_ms(started),
    )


# -- assembly ------------------------------------------------------------------


def _assemble(
    rows: list[dict], probe_vectors: list[list[float]]
) -> list[VacancyCandidate]:
    """Groups indexed chunks into vacancies and scores each against the probes.

    Similarity is the best cosine against ANY probe, not the average. A
    candidate with frontend AND backend evidence should match a React role on
    the strength of their frontend probe; averaging it against their backend
    probe would drag both down and is what made a genuinely full-stack person
    look mediocre at everything.
    """
    grouped: dict[str, VacancyCandidate] = {}
    vectors: dict[str, list[list[float]]] = {}

    for row in rows:
        vacancy_id = str(row.get("vacancyId", ""))
        if not vacancy_id:
            continue
        entry = grouped.get(vacancy_id)
        if entry is None:
            entry = VacancyCandidate(
                vacancy_id=vacancy_id,
                organization_id=str(row.get("organizationId", "")),
                title=str(row.get("title", "")),
                requirements=list(row.get("requirements") or []),
                location=row.get("location"),
                employment_type=row.get("employmentType"),
            )
            grouped[vacancy_id] = entry
            vectors[vacancy_id] = []
        entry.texts.append(str(row.get("text", "")))
        vector = row.get("_vector")
        if vector:
            vectors[vacancy_id].append(vector)

    for vacancy_id, entry in grouped.items():
        best = 0.0
        for chunk_vector in vectors[vacancy_id]:
            for probe in probe_vectors:
                best = max(best, _cosine(probe, chunk_vector))
        entry.semantic = _similarity_signal(best)

    return list(grouped.values())


def _build_evidence_map(
    *,
    requirement_texts: list[str],
    chunks: list[dict],
    profile_hits: list[EvidenceHit],
    embedder: EmbeddingModel,
    pool: int,
) -> dict[str, list[EvidenceHit]]:
    """Requirement text → the candidate's most relevant passages.

    One batched embedding call for every distinct requirement, then pure
    arithmetic against the candidate's own chunk vectors. The alternative —
    a Qdrant search per requirement — is what made ranking 153 vacancies take
    350 seconds; the candidate's whole evidence set is a few dozen vectors, so
    an exhaustive in-memory comparison is both exact and far cheaper.

    Profile fields are appended to every result the same way they were before,
    so a skill someone curated on their profile still counts as evidence.
    """
    if not requirement_texts:
        return {}

    vectors = [(c, c.get("_vector")) for c in chunks]
    usable = [(c, v) for c, v in vectors if v]
    if not usable:
        # Indexed without vectors (older points): every requirement falls back
        # to the profile fields rather than silently scoring zero evidence.
        return {text: list(profile_hits) for text in requirement_texts}

    encoded = embedder.encode_passages(requirement_texts)

    result: dict[str, list[EvidenceHit]] = {}
    for text, query_vector in zip(requirement_texts, encoded):
        scored = sorted(
            (
                (_cosine(query_vector, vector), chunk)
                for chunk, vector in usable
            ),
            key=lambda pair: pair[0],
            reverse=True,
        )[:pool]
        result[text] = [
            _to_hit(chunk, score) for score, chunk in scored
        ] + list(profile_hits)
    return result


def _cosine(a: list[float], b: list[float]) -> float:
    """Raw cosine similarity, on the SAME scale Qdrant returns.

    This matters more than it looks. `classify_requirement` compares a hit's
    `retrievalScore` against `mapping_semantic_review` (0.30), and that
    threshold was calibrated against Qdrant's raw cosine. Rescaling to [0, 1]
    with `(cos + 1) / 2` — which looks harmless — puts every non-opposite pair
    above 0.5 and would escalate essentially EVERY requirement to
    NEEDS_HUMAN_REVIEW, quietly inflating every score in the ranking.

    So: raw here, and rescaled only where a 0-1 weighting scale is genuinely
    needed (see `_similarity_signal`).
    """
    dot = norm_a = norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a <= 0 or norm_b <= 0:
        return 0.0
    return dot / ((norm_a**0.5) * (norm_b**0.5))


def _similarity_signal(cosine: float) -> float:
    """Raw cosine → the 0-1 scale the weighted score needs.

    Clamped at zero rather than remapped through `(c + 1) / 2`: a negative
    cosine means "unrelated", and giving unrelated text a 0.5 baseline would
    hand every vacancy a third of the semantic weight for nothing.
    """
    return max(0.0, min(1.0, cosine))


def _to_match(entry: ScoredVacancy, rank: int) -> JobMatch:
    return JobMatch(
        vacancyId=entry.vacancy.vacancy_id,
        organizationId=entry.vacancy.organization_id,
        title=entry.vacancy.title,
        match=entry.tier,
        score=entry.score,
        rank=rank,
        signals=entry.signals,
        matchedSkills=entry.matched_skills,
        missingSkills=entry.missing_skills,
        explanation=None,
        supportedRequirements=[RequirementCheck(**c) for c in entry.supported],
        unsupportedRequirements=[RequirementCheck(**c) for c in entry.unsupported],
        unclearRequirements=[RequirementCheck(**c) for c in entry.unclear],
        evidence=_evidence_for(entry),
        requirementInsights=[
            RequirementInsight(**row) for row in entry.requirement_insights
        ],
    )


def _evidence_for(entry: ScoredVacancy) -> list[MatchEvidence]:
    """The candidate's own passages that argued for this match.

    Carries the source kind and URL through, so a capability demonstrated only
    on a portfolio link is shown as coming from that link and not as a nameless
    document.
    """
    return [
        MatchEvidence(
            fileName=hit.sourceTitle or hit.fileName,
            pageNumber=hit.pageNumber,
            section=hit.section,
            text=hit.text[:_EVIDENCE_SNIPPET_CHARS],
            sourceType=hit.sourceType,
            sourceUrl=hit.sourceUrl,
        )
        for hit in entry.evidence
    ]


def _tier_counts(matches: list[JobMatch]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for match in matches:
        counts[match.match] = counts.get(match.match, 0) + 1
    return counts


def _capability_summary(capability: CandidateCapabilityProfile) -> dict:
    """What the ranking actually knew about the candidate.

    Returned so the backend can report honestly which of a candidate's sources
    contributed, instead of the report claiming a portfolio was used when the
    portfolio produced no chunks.
    """
    return {
        "skills": sorted(capability.skills),
        "roleFamilies": sorted(capability.role_families),
        "evidenceSources": dict(capability.evidence_sources),
        "evidenceChars": capability.evidence_chars,
        "probes": len(capability.probes),
    }


# -- explanations --------------------------------------------------------------


def _explain(
    *,
    matches: list[JobMatch],
    request: JobMatchRequest,
    generator,
    settings: Settings,
) -> bool:
    """Writes prose for the requested window. Never changes the ranking."""
    if not matches or generator is None or not generator.enabled:
        return False

    start = max(0, request.explainOffset)
    window = matches[start : start + request.explainLimit]
    if not window:
        return False

    try:
        explanations = generator.generate_match_explanations(
            context=_explanation_context(window),
            vacancy_ids=[m.vacancyId for m in window],
            locale=request.locale,
        )
    except GenerationUnavailableError as exc:
        # The ranking is deterministic and already computed; a provider hiccup
        # must not throw it away. `generated: false` states honestly that no
        # prose exists.
        logger.warning(
            "Match explanations unavailable; returning ranked matches without prose",
            extra={"stage": "job_match", "errorType": type(exc).__name__},
        )
        return False

    for match in window:
        match.explanation = explanations.get(match.vacancyId)
    return True


def explain_matches(
    *,
    items,
    locale: str,
    generator,
) -> tuple[dict[str, str], bool]:
    """Prose for one page of an ALREADY-RANKED list.

    Separate from `match_jobs` on purpose: paging to results 21-40 must not
    re-rank the catalogue to write four sentences. The order and the count are
    already decided and stored — this only adds words, and has no way to change
    either.
    """
    if not items or generator is None or not generator.enabled:
        return {}, False

    facts = [
        JobMatch(
            vacancyId=item.vacancyId,
            organizationId="",
            title=item.title,
            match=item.match,
            matchedSkills=item.matchedSkills,
            missingSkills=item.missingSkills,
            supportedRequirements=item.supportedRequirements,
            unsupportedRequirements=item.unsupportedRequirements,
            unclearRequirements=item.unclearRequirements,
            evidence=[],
        )
        for item in items
    ]
    try:
        explanations = generator.generate_match_explanations(
            context=_explanation_context(facts),
            vacancy_ids=[f.vacancyId for f in facts],
            locale=locale,
        )
    except GenerationUnavailableError as exc:
        logger.warning(
            "Match explanations unavailable for this page",
            extra={"stage": "job_match_explain", "errorType": type(exc).__name__},
        )
        return {}, False
    return {k: v for k, v in explanations.items() if v}, True


def _explanation_context(matches: list[JobMatch]) -> str:
    """The facts Gemini may use — nothing else exists as far as it knows."""
    blocks: list[str] = []
    for m in matches:
        lines = [
            f"vacancyId: {m.vacancyId}",
            f"Role: {m.title}",
            f"Match category: {m.match}",
        ]
        if m.matchedSkills:
            lines.append("Technologies the candidate has evidence for: "
                         + ", ".join(m.matchedSkills))
        if m.missingSkills:
            lines.append("Technologies the posting names that the evidence does "
                         "not show: " + ", ".join(m.missingSkills))
        if m.supportedRequirements:
            lines.append("Requirements SUPPORTED by the candidate's documents:")
            lines += [f"  - {c.text}" for c in m.supportedRequirements]
        if m.unsupportedRequirements:
            lines.append("Requirements NOT shown in the documents:")
            lines += [f"  - {c.text}" for c in m.unsupportedRequirements]
        if m.unclearRequirements:
            lines.append("Requirements that are UNCLEAR from the documents:")
            lines += [f"  - {c.text}" for c in m.unclearRequirements]
        blocks.append("\n".join(lines))
    return "\n\n---\n\n".join(blocks)


# -- evidence hits -------------------------------------------------------------


def _profile_pseudo_hits(profile) -> list[EvidenceHit]:
    """Canonical profile fields as evidence passages.

    They join the retrieved chunks in requirement classification, so a skill
    the candidate curated on their profile counts as evidence with honest
    provenance (fileName "Profile", no page number).
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
            candidateAccountId=None,
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


def _to_hit(payload: dict, score: float) -> EvidenceHit:
    """One personal-collection payload → a hit.

    The collection holds BOTH the candidate's files and their professional
    links, so a skill demonstrated only on a portfolio is retrieved by exactly
    the same query that finds one listed on a CV.
    """
    file_name = payload.get("fileName")
    return EvidenceHit(
        chunkId=str(payload.get("chunkId", "")),
        candidateAccountId=payload.get("candidateAccountId"),
        documentId=str(payload.get("documentId", "")),
        fileName=file_name,
        section=payload.get("section"),
        pageNumber=payload.get("pageNumber"),
        chunkIndex=int(payload.get("chunkIndex", 0)),
        text=str(payload.get("text", "")),
        retrievalScore=score,
        sourceType=payload.get("sourceType") or "FILE",
        sourceTitle=payload.get("sourceTitle") or file_name,
        sourceUrl=payload.get("sourceUrl"),
    )


def _ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)

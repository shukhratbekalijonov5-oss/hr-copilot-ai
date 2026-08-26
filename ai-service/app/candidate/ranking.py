"""Scores and ranks EVERY eligible vacancy for one candidate.

## The rule this file exists to enforce

> Every vacancy the candidate is allowed to see gets a rank. The only thing
> that removes a vacancy is a genuine eligibility rule, and eligibility is
> decided by the backend, not here.

The previous design did the opposite. It asked the vector index for the top 32
CHUNKS, grouped those into ~30 vacancies, and truncated to `limit` (default 5,
capped at 10). 153 open vacancies became 5 before anything had been compared,
and the reason a job was missing was unanswerable — it had never been scored.

So retrieval is no longer a filter. The backend hands over the eligible
vacancy ids; every one of them is fetched, scored and ranked, and the caller
paginates the finished list. Ranking is done here, in the application, so the
count is never a model's decision.

## The signals, and why more than one

Cosine similarity alone put every one of Uchqun's matches under the title
"Backend Engineer" — a single number cannot tell "uses React daily" apart from
"mentions React once". Five signals are combined, each measuring something the
others cannot:

| signal | answers |
|---|---|
| `semantic`   | does the evidence read like this job, as a whole? |
| `required`   | are the MUST-have requirements actually demonstrated? |
| `preferred`  | are the nice-to-haves demonstrated? |
| `skills`     | do the concrete technologies overlap? |
| `roleFamily` | is this the kind of work the candidate does? |

Each is computed from a different view of the evidence, so combining them does
not count the same fact twice: `semantic` reads the raw text, `required` and
`preferred` read the requirement list, `skills` reads the normalized lexicon,
and `roleFamily` reads the title. A candidate strong on one and weak on the
rest lands mid-table, which is the honest answer.

Scores are 0-100 and exist to ORDER the list. They are not a probability of
being hired, not a percentage of the job the person can do, and must never be
presented as either.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.candidate.capability import (
    ROLE_FAMILIES,
    CandidateCapabilityProfile,
    extract_skills,
)
from app.common.logging import get_logger
from app.mapping.requirement_mapping import (
    EVIDENCE_FOUND,
    NO_EVIDENCE_FOUND,
    MappingThresholds,
    classify_requirement,
)
from app.models.schemas import EvidenceHit

logger = get_logger(__name__)

# Weights sum to 1.0. Semantic carries the most because it is the only signal
# that reads evidence the lexicon has never heard of; requirement coverage is
# next because a vacancy's own stated requirements are the most direct
# statement of what the job needs.
WEIGHTS = {
    "semantic": 0.34,
    "required": 0.26,
    "preferred": 0.10,
    "skills": 0.18,
    "roleFamily": 0.12,
}

# Tier boundaries on the 0-100 score. Kept to the THREE labels the product
# already ships and localizes (STRONG / PARTIAL / WEAK) rather than inventing a
# four-tier vocabulary that would need new copy in four languages.
TIER_STRONG = 68
TIER_PARTIAL = 40

#: Supporting passages kept per match. Enough to show provenance, few enough
#: that a page of results stays small.
MAX_EVIDENCE_PER_MATCH = 5

#: Passages kept per REQUIREMENT in the insight rows, and how long each
#: snippet may be. Three cited passages per requirement is what the recruiter
#: evidence map ships with (`mapping_max_evidence`), kept as a constant here so
#: this module stays store- and settings-free.
MAX_EVIDENCE_PER_REQUIREMENT = 3
_INSIGHT_SNIPPET_CHARS = 220

#: The pseudo-source built from the profile form. One "source" no matter how
#: many fields repeat a skill — repetition inside the profile must never look
#: like independent corroboration.
PROFILE_SOURCE_ID = "profile"


@dataclass
class VacancyCandidate:
    """One eligible vacancy, assembled from its indexed chunks."""

    vacancy_id: str
    organization_id: str
    title: str
    texts: list[str] = field(default_factory=list)
    requirements: list[dict] = field(default_factory=list)
    location: str | None = None
    employment_type: str | None = None
    #: Best cosine against ANY candidate probe, filled during scoring.
    semantic: float = 0.0


@dataclass
class ScoredVacancy:
    vacancy: VacancyCandidate
    score: int
    tier: str
    signals: dict[str, float]
    supported: list[dict] = field(default_factory=list)
    unsupported: list[dict] = field(default_factory=list)
    unclear: list[dict] = field(default_factory=list)
    matched_skills: list[str] = field(default_factory=list)
    missing_skills: list[str] = field(default_factory=list)
    #: The candidate's own passages that supported this match, deduplicated.
    #: Provenance is not optional — a capability the UI shows must be traceable
    #: to the file or link it came from.
    evidence: list[EvidenceHit] = field(default_factory=list)
    #: Per-requirement classification depth (dicts shaped like
    #: schemas.RequirementInsight). Parallel to supported/unsupported/unclear,
    #: which are a frozen wire contract that must not grow.
    requirement_insights: list[dict] = field(default_factory=list)


def rank_vacancies(
    *,
    capability: CandidateCapabilityProfile,
    vacancies: list[VacancyCandidate],
    evidence_hits_for: callable,
    thresholds: MappingThresholds,
    max_requirements: int,
) -> list[ScoredVacancy]:
    """Scores every vacancy and returns them strongest first.

    `evidence_hits_for(text)` returns the candidate's own evidence passages
    most relevant to one requirement — injected so this module never touches a
    vector store and stays unit-testable without one.

    Ordering is `(-score, vacancyId)`. The tiebreak is not cosmetic: pagination
    serves slices of this list, so two vacancies on the same score must not
    swap places between page 1 and page 2.
    """
    scored = [
        _score_one(
            vacancy=vacancy,
            capability=capability,
            evidence_hits_for=evidence_hits_for,
            thresholds=thresholds,
            max_requirements=max_requirements,
        )
        for vacancy in vacancies
    ]
    scored.sort(key=lambda s: (-s.score, s.vacancy.vacancy_id))
    return scored


def _score_one(
    *,
    vacancy: VacancyCandidate,
    capability: CandidateCapabilityProfile,
    evidence_hits_for,
    thresholds: MappingThresholds,
    max_requirements: int,
) -> ScoredVacancy:
    blob = f"{vacancy.title}\n" + "\n".join(vacancy.texts)
    vacancy_skills = extract_skills(blob)

    # --- requirement coverage, split by whether the vacancy calls it required
    required_total = preferred_total = 0
    required_met = preferred_met = 0.0
    supported: list[dict] = []
    unsupported: list[dict] = []
    unclear: list[dict] = []
    insight_rows: list[dict] = []
    evidence: list[EvidenceHit] = []
    seen_evidence: set[tuple[str, int]] = set()

    for index, req in enumerate(vacancy.requirements[:max_requirements]):
        text = str(req.get("text", "")).strip()
        if not text:
            continue
        is_required = bool(req.get("required", True))
        hits: list[EvidenceHit] = evidence_hits_for(text)
        result = classify_requirement(
            requirement_id=f"{vacancy.vacancy_id}:{index}",
            requirement_text=text,
            hits=hits,
            thresholds=thresholds,
        )
        entry = {"text": text, "required": is_required, "reason": result.reason}

        # The parallel insight row: same classification, plus the depth the
        # advanced contract needs. DISTINCT non-profile sources is the
        # anti-stuffing measure — twenty mentions in one file are one source.
        insight_rows.append(
            {
                "text": text,
                "required": is_required,
                "status": result.status,
                "reason": result.reason,
                "matchedTerms": list(result.matched_terms),
                "missingTerms": list(result.missing_terms),
                "distinctEvidenceSources": len(
                    {
                        hit.documentId
                        for hit in result.evidence
                        if hit.documentId and hit.documentId != PROFILE_SOURCE_ID
                    }
                ),
                "evidence": [
                    {
                        "documentId": hit.documentId,
                        "fileName": hit.sourceTitle or hit.fileName,
                        "pageNumber": hit.pageNumber,
                        "section": hit.section,
                        "text": hit.text[:_INSIGHT_SNIPPET_CHARS],
                        "sourceType": hit.sourceType or "FILE",
                        "sourceUrl": hit.sourceUrl,
                    }
                    for hit in result.evidence[:MAX_EVIDENCE_PER_REQUIREMENT]
                ],
            }
        )

        if result.status == EVIDENCE_FOUND:
            supported.append(entry)
            credit = 1.0
        elif result.status == NO_EVIDENCE_FOUND:
            unsupported.append(entry)
            credit = 0.0
        else:
            unclear.append(entry)
            # Partial credit: "needs a human to look" is genuinely between the
            # two, and scoring it as zero would rank an ambiguous match below a
            # flatly unsuitable one.
            credit = 0.5

        if is_required:
            required_total += 1
            required_met += credit
        else:
            preferred_total += 1
            preferred_met += credit

        # Provenance: keep the passages that actually supported the match, so
        # the candidate can see WHICH of their files or links argued for it.
        for hit in result.evidence:
            key = (hit.documentId, hit.chunkIndex)
            if key in seen_evidence or len(evidence) >= MAX_EVIDENCE_PER_MATCH:
                continue
            seen_evidence.add(key)
            evidence.append(hit)

    # A vacancy that states no requirements cannot be measured on coverage, so
    # it scores neutral there instead of zero — otherwise every thin job
    # posting would sink regardless of how well the evidence fits.
    required_signal = required_met / required_total if required_total else 0.5
    preferred_signal = (
        preferred_met / preferred_total if preferred_total else 0.5
    )

    # --- concrete technology overlap ---------------------------------------
    if vacancy_skills:
        overlap = capability.skills & vacancy_skills
        skill_signal = len(overlap) / len(vacancy_skills)
        matched_skills = sorted(overlap)
        missing_skills = sorted(vacancy_skills - capability.skills)
    else:
        skill_signal = 0.5  # nothing named; neutral rather than punitive
        matched_skills = []
        missing_skills = []

    # --- role family --------------------------------------------------------
    role_signal = _role_family_signal(capability, vacancy.title, vacancy_skills)

    signals = {
        "semantic": _clamp(vacancy.semantic),
        "required": _clamp(required_signal),
        "preferred": _clamp(preferred_signal),
        "skills": _clamp(skill_signal),
        "roleFamily": _clamp(role_signal),
    }
    total = sum(signals[k] * w for k, w in WEIGHTS.items())
    score = int(round(_clamp(total) * 100))

    # THE COVERAGE FLOOR.
    #
    # A vacancy states requirements and the candidate's evidence demonstrates
    # NONE of them: that is a weak match however similar the text reads. Without
    # this, a high semantic score could carry a job into PARTIAL on the strength
    # of sounding related — telling someone a role is a partial fit when nothing
    # it asks for was found. The job still ranks, and still appears in the list;
    # it is the LABEL that is held honest.
    tier = tier_for(score)
    if required_total > 0 and required_met == 0:
        tier = "WEAK"

    return ScoredVacancy(
        vacancy=vacancy,
        score=score,
        tier=tier,
        signals=signals,
        supported=supported,
        unsupported=unsupported,
        unclear=unclear,
        matched_skills=matched_skills,
        missing_skills=missing_skills[:12],
        evidence=evidence,
        requirement_insights=insight_rows,
    )


def tier_for(score: int) -> str:
    """The categorical label, derived from the score so the two never disagree."""
    if score >= TIER_STRONG:
        return "STRONG"
    if score >= TIER_PARTIAL:
        return "PARTIAL"
    return "WEAK"


def _role_family_signal(
    capability: CandidateCapabilityProfile,
    title: str,
    vacancy_skills: set[str],
) -> float:
    """How close this job is to the kind of work the candidate does.

    A RANKING signal, never a filter — this is the specific thing that used to
    lose Uchqun their Backend Engineer matches for having "Full Stack" in a
    headline. A family mismatch costs at most this signal's weight; it can
    never remove a vacancy.
    """
    vacancy_families = _families_of(title, vacancy_skills)
    if not vacancy_families or not capability.role_families:
        return 0.5

    if capability.role_families & vacancy_families:
        return 1.0

    # Adjacent families still count for something: a backend engineer applying
    # to a devops role shares real ground, and scoring that as zero would rank
    # it below a job with nothing in common at all.
    adjacent = {
        frozenset({"frontend", "fullstack"}),
        frozenset({"backend", "fullstack"}),
        frozenset({"backend", "devops"}),
        frozenset({"backend", "data"}),
        frozenset({"frontend", "mobile"}),
        frozenset({"fullstack", "mobile"}),
    }
    for mine in capability.role_families:
        for theirs in vacancy_families:
            if frozenset({mine, theirs}) in adjacent:
                return 0.6
    return 0.2


def _families_of(title: str, skills: set[str]) -> set[str]:
    lowered = (title or "").lower()
    families = set()
    for family, spec in ROLE_FAMILIES.items():
        if any(marker in lowered for marker in spec["titles"]):
            families.add(family)
        if len(skills & set(spec["skills"])) >= 2:
            families.add(family)
    if {"frontend", "backend"} <= families:
        families.add("fullstack")
    return families


def _clamp(value: float) -> float:
    if math.isnan(value):
        return 0.0
    return max(0.0, min(1.0, value))

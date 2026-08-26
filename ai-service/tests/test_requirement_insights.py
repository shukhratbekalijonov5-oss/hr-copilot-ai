"""Per-requirement insight rows: the depth feed for the advanced match contract.

The three supported/unsupported/unclear arrays are a frozen wire contract
(they are stored by the backend and SENT BACK on the explanation path, where
an extra field is a 422), so the advanced data travels in a PARALLEL
`requirementInsights` list. These tests pin its properties:

  * one insight row per classified requirement, status identical to the array
    the requirement landed in;
  * DISTINCT non-profile sources is the depth measure — twenty repetitions
    inside one document stay ONE source (anti-keyword-stuffing);
  * the profile pseudo-source never counts as an independent source;
  * per-requirement evidence is capped and snippets are clipped;
  * `_to_match` carries the rows into the response model.
"""

from __future__ import annotations

from app.candidate.capability import build_capability_profile
from app.candidate.job_match import _to_match
from app.candidate.ranking import (
    MAX_EVIDENCE_PER_REQUIREMENT,
    VacancyCandidate,
    rank_vacancies,
)
from app.mapping.requirement_mapping import MappingThresholds
from app.models.schemas import CandidateProfileInput, EvidenceHit


THRESHOLDS = MappingThresholds(lexical_found=0.6, semantic_review=0.30, max_evidence=3)


def _hit(text: str, document_id: str, chunk_index: int = 0, score: float = 0.9) -> EvidenceHit:
    return EvidenceHit(
        chunkId=f"{document_id}:{chunk_index}",
        candidateAccountId="acc-1",
        documentId=document_id,
        fileName=f"{document_id}.pdf",
        section="experience",
        pageNumber=1,
        chunkIndex=chunk_index,
        text=text,
        retrievalScore=score,
    )


def _profile_hit(text: str, chunk_index: int = 0) -> EvidenceHit:
    return EvidenceHit(
        chunkId=f"profile:skills:{chunk_index}",
        candidateAccountId=None,
        documentId="profile",
        fileName="Profile",
        section="skills",
        pageNumber=None,
        chunkIndex=chunk_index,
        text=text,
        retrievalScore=0.0,
    )


def _capability(skills: list[str]) -> object:
    profile = CandidateProfileInput(skills=skills)
    return build_capability_profile(profile=profile, chunks=[])


def _rank_one(vacancy: VacancyCandidate, hits_by_req: dict[str, list[EvidenceHit]]):
    scored = rank_vacancies(
        capability=_capability(["kubernetes", "docker"]),
        vacancies=[vacancy],
        evidence_hits_for=lambda text: hits_by_req.get(text, []),
        thresholds=THRESHOLDS,
        max_requirements=12,
    )
    return scored[0]


def _vacancy(requirements: list[dict]) -> VacancyCandidate:
    return VacancyCandidate(
        vacancy_id="vac-1",
        organization_id="org-1",
        title="Platform Engineer",
        texts=["Kubernetes and Docker platform work"],
        requirements=requirements,
    )


def test_insight_rows_parallel_the_three_arrays():
    vacancy = _vacancy(
        [
            {"text": "Kubernetes in production", "required": True},
            {"text": "Terraform modules", "required": True},
            {"text": "Korean language", "required": False},
        ]
    )
    entry = _rank_one(
        vacancy,
        {
            "Kubernetes in production": [
                _hit("Ran Kubernetes in production for two years", "doc-a")
            ],
            # lexical coverage 0, low relevance -> NO_EVIDENCE_FOUND
            "Terraform modules": [_hit("Unrelated catering text", "doc-a", score=0.05)],
            # partial coverage -> NEEDS_HUMAN_REVIEW
            "Korean language": [_hit("language classes", "doc-b", score=0.2)],
        },
    )

    by_text = {row["text"]: row for row in entry.requirement_insights}
    assert len(entry.requirement_insights) == 3
    assert by_text["Kubernetes in production"]["status"] == "EVIDENCE_FOUND"
    assert by_text["Kubernetes in production"]["required"] is True
    assert by_text["Terraform modules"]["status"] == "NO_EVIDENCE_FOUND"
    assert by_text["Korean language"]["status"] == "NEEDS_HUMAN_REVIEW"
    assert by_text["Korean language"]["required"] is False

    # Statuses agree with the frozen arrays.
    assert [c["text"] for c in entry.supported] == ["Kubernetes in production"]
    assert [c["text"] for c in entry.unsupported] == ["Terraform modules"]
    assert [c["text"] for c in entry.unclear] == ["Korean language"]


def test_repetition_in_one_source_is_one_source():
    req = "Kubernetes experience"
    vacancy = _vacancy([{"text": req, "required": True}])
    stuffed = [
        _hit("Kubernetes Kubernetes Kubernetes Kubernetes", "doc-a", i)
        for i in range(3)
    ]
    entry = _rank_one(vacancy, {req: stuffed})
    row = entry.requirement_insights[0]
    assert row["status"] == "EVIDENCE_FOUND"
    assert row["distinctEvidenceSources"] == 1  # one document, however loud


def test_independent_sources_count_individually():
    req = "Kubernetes experience"
    vacancy = _vacancy([{"text": req, "required": True}])
    entry = _rank_one(
        vacancy,
        {
            req: [
                _hit("Kubernetes experience on the platform team", "doc-a"),
                _hit("kubernetes experience: deployed the cluster", "doc-b"),
            ]
        },
    )
    assert entry.requirement_insights[0]["distinctEvidenceSources"] == 2


def test_profile_pseudo_source_never_counts_as_independent():
    req = "Kubernetes experience"
    vacancy = _vacancy([{"text": req, "required": True}])
    entry = _rank_one(
        vacancy,
        {req: [_profile_hit("Skills: kubernetes experience docker")]},
    )
    row = entry.requirement_insights[0]
    assert row["status"] == "EVIDENCE_FOUND"  # profile still supports the claim
    assert row["distinctEvidenceSources"] == 0  # but it is not a source


def test_evidence_capped_and_clipped():
    req = "Kubernetes experience"
    vacancy = _vacancy([{"text": req, "required": True}])
    long_text = "kubernetes experience " + "x" * 500
    entry = _rank_one(
        vacancy,
        {req: [_hit(long_text, f"doc-{i}", i) for i in range(6)]},
    )
    row = entry.requirement_insights[0]
    assert len(row["evidence"]) <= MAX_EVIDENCE_PER_REQUIREMENT
    assert all(len(e["text"]) <= 220 for e in row["evidence"])
    assert all(e["documentId"].startswith("doc-") for e in row["evidence"])


def test_to_match_carries_rows_into_the_response_model():
    req = "Kubernetes experience"
    vacancy = _vacancy([{"text": req, "required": True}])
    entry = _rank_one(vacancy, {req: [_hit("kubernetes experience", "doc-a")]})
    match = _to_match(entry, rank=1)
    assert len(match.requirementInsights) == 1
    insight = match.requirementInsights[0]
    assert insight.text == req
    assert insight.status == "EVIDENCE_FOUND"
    assert insight.distinctEvidenceSources == 1
    assert insight.evidence[0].documentId == "doc-a"
    # The frozen arrays are untouched.
    assert match.supportedRequirements[0].text == req

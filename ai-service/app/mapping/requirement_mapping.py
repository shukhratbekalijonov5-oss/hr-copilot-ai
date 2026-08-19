"""JD requirement -> candidate evidence mapping.

## Why this is not a single similarity threshold

Reranker scores were measured against the fixture resume (see
`docs/evidence-thresholding.md`). The distributions **overlap**: a requirement
the candidate genuinely meets scored as low as 0.0105 ("PostgreSQL schema
design"), while one they do not meet scored 0.0377 ("AWS production
experience"). A cross-encoder score ranks passages against a query; it is not a
calibrated "does this person have this skill" probability, and using it as one
would produce confident wrong answers.

## What is used instead

Two independent signals:

1. **Semantic retrieval** finds passages that plausibly address the
   requirement. This is what handles paraphrase and cross-language matching.
2. **Lexical verification** checks that the requirement's own distinctive terms
   actually appear in those passages. This is what stops the system inferring
   "AWS" from "Kubernetes" — a passage can only support a requirement it
   literally speaks to.

On the fixture, genuinely-absent requirements score exactly 0.0 lexical
coverage while genuinely-present ones score >= 0.5, which is the separation the
score alone could not provide.

## The middle band is a feature

Partial coverage produces NEEDS_HUMAN_REVIEW rather than a guess. "Kafka
Streams stateful processing" against a resume that lists "Kafka" but never
describes stream processing is genuinely uncertain, and saying so is more
useful than a confident answer in either direction.

None of these numbers is a candidate score. They describe how well retrieved
text matches a requirement string, and they are never exposed as a rating.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.models.schemas import EvidenceHit

# Words that carry no discriminating power in a requirement phrase. Matching on
# them would let "production experience" alone satisfy anything.
STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "or", "the", "of", "in", "on", "with", "for", "to",
        "at", "by", "from", "as", "is", "are", "be", "been", "have", "has",
        "years", "year", "plus", "strong", "solid", "good", "excellent",
        "proven", "demonstrable", "hands", "deep", "working", "professional",
        "experience", "experienced", "knowledge", "skills", "skill", "ability",
        "familiarity", "familiar", "understanding", "background", "expertise",
        "using", "used", "use", "building", "build", "built", "developing",
        "development", "design", "designing", "production", "environment",
        "environments", "level", "senior", "junior", "mid", "equivalent",
    }
)

# Keeps +, #, ., / and - so "C++", "C#", "Node.js", "CI/CD", "Pub/Sub" survive.
_TERM = re.compile(r"[A-Za-zㄱ-힝Ѐ-ӿ][\w+#./ㄱ-힝Ѐ-ӿ-]*")


@dataclass
class MappingThresholds:
    """Configurable, documented decision boundaries.

    Deliberately not a "score": these govern how confidently the system claims
    a requirement is addressed, and they are never surfaced to a user.
    """

    # Fraction of the requirement's distinctive terms that must appear in the
    # retrieved evidence for an automatic EVIDENCE_FOUND.
    lexical_found: float = 0.6
    # Above this reranker score, zero lexical coverage still escalates to human
    # review rather than a flat "no evidence" — the safety net for synonyms and
    # cross-language phrasing that lexical matching cannot see.
    semantic_review: float = 0.30
    # Evidence passages returned per requirement.
    max_evidence: int = 3


@dataclass
class RequirementMappingResult:
    requirement_id: str
    requirement_text: str
    status: str  # EVIDENCE_FOUND | NO_EVIDENCE_FOUND | NEEDS_HUMAN_REVIEW
    evidence: list[EvidenceHit] = field(default_factory=list)
    matched_terms: list[str] = field(default_factory=list)
    missing_terms: list[str] = field(default_factory=list)
    lexical_coverage: float = 0.0
    top_relevance: float = 0.0
    reason: str = ""


EVIDENCE_FOUND = "EVIDENCE_FOUND"
NO_EVIDENCE_FOUND = "NO_EVIDENCE_FOUND"
NEEDS_HUMAN_REVIEW = "NEEDS_HUMAN_REVIEW"


def extract_terms(requirement: str) -> list[str]:
    """Distinctive terms from a requirement phrase, lowercased and deduped."""
    seen: list[str] = []
    for raw in _TERM.findall(requirement.lower()):
        token = raw.strip("-./")
        if not token or token in STOPWORDS or len(token) < 2:
            continue
        # Purely numeric tokens ("5" from "5+ years") discriminate nothing.
        if token.isdigit():
            continue
        if token not in seen:
            seen.append(token)
    return seen


def lexical_coverage(terms: list[str], passages: list[str]) -> tuple[float, list[str], list[str]]:
    """Fraction of requirement terms that literally appear in the passages."""
    if not terms:
        return 0.0, [], []

    corpus = " ".join(passages).lower()
    matched = [t for t in terms if _contains(corpus, t)]
    missing = [t for t in terms if t not in matched]
    return len(matched) / len(terms), matched, missing


def _contains(corpus: str, term: str) -> bool:
    """Word-boundary-ish containment.

    A plain substring test would match "go" inside "algorithm"; anchoring to
    non-word characters avoids that while still matching "Node.js" and "C++",
    which a strict \\b pattern would not.
    """
    pattern = re.compile(
        rf"(?<![\w]){re.escape(term)}(?![\w])", re.IGNORECASE
    )
    return bool(pattern.search(corpus))


def classify_requirement(
    *,
    requirement_id: str,
    requirement_text: str,
    hits: list[EvidenceHit],
    thresholds: MappingThresholds | None = None,
) -> RequirementMappingResult:
    """Decides what the retrieved evidence actually supports.

    Never returns a percentage, a rating, or a hiring recommendation.
    """
    limits = thresholds or MappingThresholds()
    terms = extract_terms(requirement_text)
    top_relevance = _top_relevance(hits)

    if not hits:
        return RequirementMappingResult(
            requirement_id=requirement_id,
            requirement_text=requirement_text,
            status=NO_EVIDENCE_FOUND,
            lexical_coverage=0.0,
            missing_terms=terms,
            reason="No candidate documents matched this requirement.",
        )

    coverage, matched, missing = lexical_coverage(terms, [h.text for h in hits])
    evidence = _select_evidence(hits, matched, limits.max_evidence)

    if terms and coverage >= limits.lexical_found:
        status = EVIDENCE_FOUND
        reason = (
            f"Retrieved evidence mentions {', '.join(matched)}."
            if matched
            else "Retrieved evidence addresses this requirement."
        )
    elif coverage > 0:
        status = NEEDS_HUMAN_REVIEW
        reason = (
            f"Evidence mentions {', '.join(matched)} but not "
            f"{', '.join(missing)}; a person should confirm."
        )
    elif top_relevance >= limits.semantic_review:
        # Nothing matched literally, but a passage looks strongly related —
        # possibly a synonym or another language. Escalate rather than deny.
        status = NEEDS_HUMAN_REVIEW
        reason = (
            "No requirement term appears verbatim, but a passage is strongly "
            "related; a person should confirm."
        )
    else:
        status = NO_EVIDENCE_FOUND
        evidence = []
        reason = (
            f"No retrieved passage mentions {', '.join(missing) or requirement_text}."
        )

    return RequirementMappingResult(
        requirement_id=requirement_id,
        requirement_text=requirement_text,
        status=status,
        evidence=evidence,
        matched_terms=matched,
        missing_terms=missing,
        lexical_coverage=coverage,
        top_relevance=top_relevance,
        reason=reason,
    )


def _select_evidence(
    hits: list[EvidenceHit], matched: list[str], limit: int
) -> list[EvidenceHit]:
    """Prefers passages that actually contain a matched term.

    Retrieval order alone can put a topically-near passage above the one that
    names the technology; a human reading the citation wants the latter.
    """
    if not matched:
        return hits[:limit]

    supporting = [h for h in hits if any(_contains(h.text, t) for t in matched)]
    other = [h for h in hits if h not in supporting]
    return (supporting + other)[:limit]


def _top_relevance(hits: list[EvidenceHit]) -> float:
    if not hits:
        return 0.0
    scores = [
        h.rerankScore if h.rerankScore is not None else h.retrievalScore
        for h in hits
    ]
    return max(scores)

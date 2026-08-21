"""What a candidate can actually do, assembled from ALL of their evidence.

## Why this exists

Job matching used to represent a candidate as ONE 1600-character blob built
from their profile fields plus the first 8 chunks Qdrant happened to return —
scroll order, not relevance. For a job seeker whose real evidence is a 20-page
portfolio, that meant ~15% of what they had shown the system ever reached the
vector query, and the single embedding collapsed a genuinely full-stack person
to one point in space. Every match came back "Backend Engineer".

So a candidate is described here by SEVERAL things instead of one:

  * **probes** — a handful of texts, each embedded separately, so a person who
    is both a React developer and a Node developer is two points in vector
    space and matches both kinds of vacancy. One averaged vector is the average
    of their skills, which is nobody.
  * **skills** — normalized, so `Node`, `Node.js` and `NodeJS` stop behaving
    like three unrelated technologies.
  * **role families** — inferred from the evidence, so a "Full Stack Developer"
    is legitimately considered for Backend Engineer roles.
  * **provenance** — which source each capability came from, so nothing here is
    ungrounded and the report can say honestly which files contributed.

## What it is not

It does not call an LLM and it does not invent anything. Every skill it records
appears verbatim (or as a known alias) in text the candidate submitted. A
capability with no evidence behind it is a fabricated claim about a real
person, and this module has no code path that can produce one.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from app.common.logging import get_logger

logger = get_logger(__name__)

# How much text each probe carries. Sized to the embedder's window: longer text
# is truncated by the model anyway, and padding a probe with unrelated material
# is what blurred the original single-vector representation.
_PROBE_CHARS = 900

# Upper bound on probes per candidate. Each one is an embedding call, and past
# a handful they stop adding directions and start adding latency.
_MAX_PROBES = 6

# Chunks read from the personal collection. A 20-page portfolio is ~50 chunks;
# this reads all of them rather than the first 8.
MAX_EVIDENCE_CHUNKS = 400


@dataclass(frozen=True)
class SkillEvidence:
    """One normalized skill and where it was found."""

    skill: str
    #: Display form, as written in the evidence ("Node.js", not "node.js").
    label: str
    #: Source titles the skill appeared in, e.g. {"Portfolio.pdf", "GitHub"}.
    sources: frozenset[str]


@dataclass
class CandidateCapabilityProfile:
    """Everything matching is allowed to know about a candidate."""

    #: Texts to embed. The FIRST is the general one; the rest are role-focused.
    probes: list[str] = field(default_factory=list)
    #: Normalized skill keys, e.g. {"react", "node.js", "postgresql"}.
    skills: set[str] = field(default_factory=set)
    #: Skill key -> evidence, for provenance and for the diagnostics report.
    skill_evidence: dict[str, SkillEvidence] = field(default_factory=dict)
    #: Role families the evidence supports, e.g. {"frontend", "backend"}.
    role_families: set[str] = field(default_factory=set)
    #: Source title -> how many chunks it contributed. Honest reporting only.
    evidence_sources: dict[str, int] = field(default_factory=dict)
    #: Total characters of evidence considered.
    evidence_chars: int = 0

    def has_evidence(self) -> bool:
        return bool(self.evidence_sources) or bool(self.skills)


# ---------------------------------------------------------------------------
# Technology vocabulary
#
# A lexicon, not a matching rule. Its ONLY job is to decide that two spellings
# are the same technology; it never decides whether a candidate fits a job.
# Semantic similarity does that, and it keeps working for technologies that are
# not listed here — an unknown skill costs recall in the lexical signal, never
# eligibility.
# ---------------------------------------------------------------------------

_SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    # canonical key: every spelling that means it
    "javascript": ("javascript", "js", "es6", "ecmascript"),
    "typescript": ("typescript", "ts"),
    "react": ("react", "react.js", "reactjs"),
    "next.js": ("next.js", "nextjs", "next js"),
    "vue": ("vue", "vue.js", "vuejs"),
    "angular": ("angular", "angularjs"),
    "svelte": ("svelte", "sveltekit"),
    "html": ("html", "html5"),
    "css": ("css", "css3"),
    "tailwind": ("tailwind", "tailwindcss", "tailwind css"),
    "redux": ("redux", "redux toolkit", "rtk"),
    "react native": ("react native", "react-native"),
    "node.js": ("node.js", "nodejs", "node js", "node"),
    "nestjs": ("nestjs", "nest.js", "nest js"),
    "express": ("express", "express.js", "expressjs"),
    "django": ("django",),
    "flask": ("flask",),
    "fastapi": ("fastapi", "fast api"),
    "spring": ("spring", "spring boot", "springboot"),
    "laravel": ("laravel",),
    "rails": ("rails", "ruby on rails"),
    "dotnet": (".net", "dotnet", "asp.net"),
    "graphql": ("graphql", "graph ql"),
    "rest": ("rest", "rest api", "rest apis", "restful", "restful api"),
    "grpc": ("grpc",),
    "websocket": ("websocket", "websockets", "socket.io", "socketio"),
    "postgresql": ("postgresql", "postgres", "psql"),
    "mysql": ("mysql", "mariadb"),
    "mongodb": ("mongodb", "mongo", "mongoose"),
    "redis": ("redis",),
    "elasticsearch": ("elasticsearch", "elastic search", "opensearch"),
    "sqlite": ("sqlite",),
    "prisma": ("prisma",),
    "sql": ("sql",),
    "docker": ("docker", "dockerfile", "docker compose"),
    "kubernetes": ("kubernetes", "k8s"),
    "terraform": ("terraform",),
    "aws": ("aws", "amazon web services", "ec2", "s3", "lambda"),
    "gcp": ("gcp", "google cloud"),
    "azure": ("azure",),
    "ci/cd": ("ci/cd", "cicd", "ci cd", "github actions", "gitlab ci", "jenkins"),
    "nginx": ("nginx",),
    "linux": ("linux", "ubuntu", "bash", "shell scripting"),
    "git": ("git", "github", "gitlab", "bitbucket"),
    "python": ("python",),
    "java": ("java",),
    "kotlin": ("kotlin",),
    "swift": ("swift",),
    "go": ("golang", "go lang"),
    "rust": ("rust",),
    "php": ("php",),
    "c#": ("c#", "csharp"),
    "c++": ("c++", "cpp"),
    "ruby": ("ruby",),
    "flutter": ("flutter", "dart"),
    "android": ("android",),
    "ios": ("ios", "swiftui"),
    "figma": ("figma",),
    "jest": ("jest",),
    "cypress": ("cypress", "playwright"),
    "testing": ("unit testing", "integration testing", "e2e testing", "tdd"),
    "microservices": ("microservice", "microservices"),
    "kafka": ("kafka",),
    "rabbitmq": ("rabbitmq",),
    "websockets": ("webrtc",),
    "seo": ("seo",),
    "accessibility": ("accessibility", "a11y", "wcag"),
    "ui/ux": ("ui/ux", "ux design", "ui design", "responsive design"),
    "agile": ("agile", "scrum", "kanban"),
}

#: alias -> canonical key, built once.
_ALIAS_TO_SKILL: dict[str, str] = {
    alias: canonical
    for canonical, aliases in _SKILL_ALIASES.items()
    for alias in aliases
}

# ---------------------------------------------------------------------------
# Role families
#
# Which KIND of work a person does. Deliberately coarse: this widens the pool a
# vacancy is scored against, it never narrows it. A vacancy whose family does
# not match still gets scored and ranked — it simply scores lower on one of
# several signals.
# ---------------------------------------------------------------------------

ROLE_FAMILIES: dict[str, dict[str, tuple[str, ...]]] = {
    "frontend": {
        "titles": (
            "frontend", "front-end", "front end", "ui engineer", "web developer",
            "react developer", "next.js developer", "javascript developer",
            "ui developer", "web engineer",
        ),
        "skills": (
            "react", "next.js", "vue", "angular", "svelte", "html", "css",
            "tailwind", "redux", "javascript", "typescript", "ui/ux",
            "accessibility", "figma",
        ),
    },
    "backend": {
        "titles": (
            "backend", "back-end", "back end", "api developer", "api engineer",
            "server engineer", "node.js developer", "python developer",
            "java developer", "golang developer", "platform engineer",
        ),
        "skills": (
            "node.js", "nestjs", "express", "django", "flask", "fastapi",
            "spring", "laravel", "rails", "dotnet", "graphql", "rest", "grpc",
            "postgresql", "mysql", "mongodb", "redis", "sql", "prisma",
            "microservices", "kafka", "rabbitmq",
        ),
    },
    "fullstack": {
        "titles": (
            "full stack", "fullstack", "full-stack", "software engineer",
            "software developer", "web application developer",
        ),
        # Deliberately empty: full-stack is DERIVED from holding both frontend
        # and backend evidence, not from listing a magic skill.
        "skills": (),
    },
    "mobile": {
        "titles": (
            "mobile", "android developer", "ios developer",
            "react native developer", "flutter developer",
        ),
        "skills": ("react native", "flutter", "android", "ios", "kotlin", "swift"),
    },
    "devops": {
        "titles": (
            "devops", "sre", "site reliability", "infrastructure engineer",
            "cloud engineer", "platform engineer",
        ),
        "skills": (
            "docker", "kubernetes", "terraform", "aws", "gcp", "azure",
            "ci/cd", "nginx", "linux",
        ),
    },
    "data": {
        "titles": (
            "data engineer", "data scientist", "machine learning", "ml engineer",
            "analytics engineer",
        ),
        "skills": ("python", "sql", "elasticsearch", "kafka"),
    },
}

#: A family needs this many distinct skills before the evidence supports it.
_FAMILY_SKILL_THRESHOLD = 2


def normalize_skill(text: str) -> str | None:
    """Canonical key for one skill phrase, or None if it is not a known one."""
    cleaned = text.strip().lower().strip(".,;:()[]{}\"'")
    if not cleaned:
        return None
    return _ALIAS_TO_SKILL.get(cleaned)


def extract_skills(text: str) -> set[str]:
    """Every known technology mentioned in a passage.

    Word-boundary matched so `go` does not fire on "going" and `react` does not
    fire on "reaction". Multi-word aliases are matched before single words so
    "react native" is not double-counted as "react".
    """
    if not text:
        return set()
    lowered = text.lower()
    found: set[str] = set()

    for alias, canonical in _ALIAS_TO_SKILL.items():
        # `\b` is wrong for aliases ending in punctuation (`node.js`, `c++`),
        # so the boundary is asserted explicitly on both sides.
        pattern = r"(?<![a-z0-9+#.])" + re.escape(alias) + r"(?![a-z0-9+#])"
        if re.search(pattern, lowered):
            found.add(canonical)

    # "react native" implies react-native only; drop the accidental "react".
    if "react native" in found and not re.search(
        r"(?<![a-z0-9+#.])react(?![a-z0-9+#\s]*native)", lowered
    ):
        found.discard("react")
    return found


def infer_role_families(skills: set[str], titles: Iterable[str]) -> set[str]:
    """Which kinds of work the evidence supports.

    Two independent routes in, because both kinds of evidence are real: a
    stated title ("Backend Developer") and a demonstrated skill set (Node,
    Postgres, REST). Either is enough; neither is required.
    """
    families: set[str] = set()
    title_blob = " ".join(t.lower() for t in titles if t)

    for family, spec in ROLE_FAMILIES.items():
        if any(marker in title_blob for marker in spec["titles"]):
            families.add(family)
        overlap = skills & set(spec["skills"])
        if len(overlap) >= _FAMILY_SKILL_THRESHOLD:
            families.add(family)

    # Full-stack is a CONSEQUENCE of the other two, never a separate claim.
    if {"frontend", "backend"} <= families:
        families.add("fullstack")
    return families


def build_capability_profile(
    *,
    profile,
    chunks: list[dict],
) -> CandidateCapabilityProfile:
    """Assemble the capability profile from profile fields AND every chunk.

    `chunks` is the candidate's own indexed evidence — files and links alike,
    already authorized by the caller. Nothing is read from anywhere else.
    """
    result = CandidateCapabilityProfile()

    # --- profile fields ----------------------------------------------------
    profile_texts: list[str] = []
    titles: list[str] = []

    if getattr(profile, "headline", None):
        profile_texts.append(profile.headline)
        titles.append(profile.headline)
    if getattr(profile, "summary", None):
        profile_texts.append(profile.summary)
    for exp in getattr(profile, "experience", []) or []:
        titles.append(exp.title)
        line = exp.title + (f" at {exp.company}" if exp.company else "")
        if exp.description:
            line += f". {exp.description}"
        profile_texts.append(line)
    for edu in getattr(profile, "education", []) or []:
        profile_texts.append(
            " ".join(x for x in (edu.degree, edu.field, edu.institution) if x)
        )

    declared_skills = list(getattr(profile, "skills", []) or [])
    if declared_skills:
        profile_texts.append("Skills: " + ", ".join(declared_skills))

    _record(result, "Profile", " \n".join(profile_texts))
    for raw in declared_skills:
        key = normalize_skill(raw)
        if key:
            _add_skill(result, key, raw, "Profile")

    # --- indexed evidence: EVERY chunk, not the first eight ----------------
    by_source: dict[str, list[str]] = defaultdict(list)
    for chunk in chunks[:MAX_EVIDENCE_CHUNKS]:
        text = str(chunk.get("text", "")).strip()
        if not text:
            continue
        source = (
            chunk.get("sourceTitle")
            or chunk.get("fileName")
            or ("Professional link" if chunk.get("sourceType") == "URL" else "Document")
        )
        by_source[source].append(text)

    for source, texts in by_source.items():
        blob = "\n".join(texts)
        _record(result, source, blob)
        for key in extract_skills(blob):
            _add_skill(result, key, key, source)

    result.role_families = infer_role_families(result.skills, titles)
    result.probes = _build_probes(result, profile_texts, by_source, titles)

    logger.info(
        "Candidate capability profile built",
        extra={
            "stage": "capability",
            "sources": len(result.evidence_sources),
            "chunks": sum(result.evidence_sources.values()),
            "skills": len(result.skills),
            "roleFamilies": sorted(result.role_families),
            "probes": len(result.probes),
        },
    )
    return result


def _record(result: CandidateCapabilityProfile, source: str, text: str) -> None:
    if not text.strip():
        return
    result.evidence_sources[source] = result.evidence_sources.get(source, 0) + 1
    result.evidence_chars += len(text)


def _add_skill(
    result: CandidateCapabilityProfile, key: str, label: str, source: str
) -> None:
    result.skills.add(key)
    existing = result.skill_evidence.get(key)
    sources = (existing.sources if existing else frozenset()) | {source}
    result.skill_evidence[key] = SkillEvidence(
        skill=key,
        label=existing.label if existing else label,
        sources=sources,
    )


def _build_probes(
    result: CandidateCapabilityProfile,
    profile_texts: list[str],
    by_source: dict[str, list[str]],
    titles: list[str],
) -> list[str]:
    """One general probe plus one per role family the evidence supports.

    This is the fix for "every match was a Backend Engineer". A single vector
    for a full-stack candidate sits between frontend and backend and is a good
    match for neither; a probe per family sits squarely in each, so React roles
    and Node roles both retrieve strongly.

    Each family probe is built from the candidate's OWN words — their skills in
    that family plus evidence text mentioning them — never from a template, so
    a probe cannot assert something the evidence does not.
    """
    evidence_blob = "\n".join(
        text for texts in by_source.values() for text in texts
    )

    general_parts = [t for t in profile_texts if t.strip()]
    if result.skills:
        general_parts.append(
            "Technologies: "
            + ", ".join(sorted(s.label for s in result.skill_evidence.values()))
        )
    general_parts.append(evidence_blob)
    probes = [_clip("\n".join(general_parts))]

    for family in sorted(result.role_families):
        family_skills = sorted(result.skills & set(ROLE_FAMILIES[family]["skills"]))
        if not family_skills:
            continue  # e.g. "fullstack", which owns no skills of its own
        # Sentences from the candidate's evidence that actually mention them.
        relevant = [
            sentence
            for sentence in re.split(r"(?<=[.!?\n])\s+", evidence_blob)
            if any(skill.split(".")[0] in sentence.lower() for skill in family_skills)
        ]
        parts = [
            " ".join(titles[:2]),
            f"{family} engineering",
            ", ".join(family_skills),
            " ".join(relevant),
        ]
        probes.append(_clip("\n".join(p for p in parts if p.strip())))
        if len(probes) >= _MAX_PROBES:
            break

    return [p for p in probes if p.strip()]


def _clip(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    return collapsed[:_PROBE_CHARS]

"""Resume section detection.

Deliberately conservative. A heading is only accepted when a *short* line
matches a known section vocabulary — this is pattern matching over common
resume conventions, not inference. Text before any recognised heading, and all
text in a document where nothing matches, is labelled ``None`` rather than
guessed at.

``None`` means "section unknown", and callers must treat it that way. Inventing
a plausible-looking section would put a fabricated attribution behind a
citation a human is meant to trust.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Canonical section -> heading spellings that map onto it. Korean terms are
# included because the product expects multilingual resumes.
SECTION_KEYWORDS: dict[str, tuple[str, ...]] = {
    "summary": (
        "summary", "professional summary", "profile", "about", "about me",
        "objective", "career objective", "overview", "자기소개", "요약",
    ),
    "experience": (
        "experience", "work experience", "professional experience",
        "employment", "employment history", "work history", "career history",
        "경력", "경력사항", "업무경험",
    ),
    "projects": (
        "projects", "project experience", "selected projects", "portfolio",
        "프로젝트",
    ),
    "skills": (
        "skills", "technical skills", "core skills", "technologies",
        "tech stack", "competencies", "기술", "기술스택", "보유기술",
    ),
    "education": (
        "education", "academic background", "qualifications", "학력",
    ),
    "certifications": (
        "certifications", "certificates", "licenses", "accreditations",
        "자격증",
    ),
    "languages": (
        "languages", "language proficiency", "어학", "언어",
    ),
    "publications": (
        "publications", "papers", "research", "논문",
    ),
    "awards": (
        "awards", "honors", "honours", "achievements", "수상",
    ),
}

_LOOKUP: dict[str, str] = {
    spelling: section
    for section, spellings in SECTION_KEYWORDS.items()
    for spelling in spellings
}

# A heading is short; a sentence that merely mentions "experience" is not one.
_MAX_HEADING_WORDS = 5
_MAX_HEADING_CHARS = 60


@dataclass
class Section:
    """A contiguous run of text attributed to one section (or to none)."""

    name: str | None
    page_number: int
    text: str


def detect_section(line: str) -> str | None:
    """Returns the canonical section name if this line is a heading."""
    stripped = line.strip()
    if not stripped or len(stripped) > _MAX_HEADING_CHARS:
        return None
    if len(stripped.split()) > _MAX_HEADING_WORDS:
        return None

    # Tolerate decoration: "EXPERIENCE", "Experience:", "— Experience —".
    normalised = re.sub(r"[^\w\s가-힣]", " ", stripped.lower()).strip()
    normalised = re.sub(r"\s+", " ", normalised)
    if not normalised:
        return None

    return _LOOKUP.get(normalised)


def split_into_sections(pages) -> list[Section]:
    """Splits parsed pages into sections, preserving page numbers.

    Args:
        pages: an iterable of objects exposing ``page_number`` and ``text``.
    """
    sections: list[Section] = []
    current_name: str | None = None
    current_lines: list[str] = []
    current_page: int = 1

    def flush() -> None:
        text = "\n".join(current_lines).strip()
        if text:
            sections.append(
                Section(name=current_name, page_number=current_page, text=text)
            )
        current_lines.clear()

    for page in pages:
        for line in page.text.split("\n"):
            heading = detect_section(line)
            if heading is not None:
                flush()
                current_name = heading
                current_page = page.page_number
                continue

            if not current_lines:
                # First line of a new run fixes the page the run starts on.
                current_page = page.page_number
            current_lines.append(line)

    flush()
    return sections

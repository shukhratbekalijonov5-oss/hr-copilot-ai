"""Parsed-document representation shared by every parser."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ParsedPage:
    """One page of extracted text. DOCX has no real pages — see DocxParser."""

    page_number: int
    text: str


@dataclass
class ParsedDocument:
    page_count: int
    pages: list[ParsedPage] = field(default_factory=list)

    @property
    def full_text(self) -> str:
        return "\n".join(page.text for page in self.pages)

    @property
    def is_empty(self) -> bool:
        return not self.full_text.strip()

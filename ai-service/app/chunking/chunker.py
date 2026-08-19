"""Section-aware chunking.

Two properties matter for retrieval quality here:

  * A short section is kept whole. Splitting a compact skills list across two
    chunks makes both halves worse matches than the intact list.
  * A long section is split on paragraph and then sentence boundaries, with
    overlap, so a passage that straddles a boundary is still retrievable.

Every chunk keeps the tenant, candidate, document, section and page it came
from. That provenance is what lets the UI later cite "resume.pdf · page 2",
and it must survive every downstream step including reranking.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.parsers.sections import Section


@dataclass
class Chunk:
    organization_id: str
    candidate_id: str | None
    document_id: str
    section: str | None
    page_number: int | None
    chunk_index: int
    text: str
    # Carried so a retrieved passage can be cited without a second lookup.
    file_name: str | None = None
    document_type: str | None = None


_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")
# Sentence-ish boundary: terminator + whitespace. Also breaks on newlines so
# bullet lists split sensibly.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n")


def chunk_sections(
    sections: list[Section],
    *,
    organization_id: str,
    document_id: str,
    candidate_id: str | None,
    file_name: str | None = None,
    document_type: str | None = None,
    target_chars: int = 900,
    overlap_chars: int = 150,
    min_split_chars: int = 1200,
) -> list[Chunk]:
    """Turns parsed sections into indexable chunks."""
    chunks: list[Chunk] = []
    index = 0

    for section in sections:
        text = section.text.strip()
        if not text:
            continue

        pieces = (
            [text]
            if len(text) <= min_split_chars
            else _split_text(text, target_chars, overlap_chars)
        )

        for piece in pieces:
            piece = piece.strip()
            if not piece:
                continue
            chunks.append(
                Chunk(
                    organization_id=organization_id,
                    candidate_id=candidate_id,
                    document_id=document_id,
                    section=section.name,
                    page_number=section.page_number,
                    chunk_index=index,
                    text=piece,
                    file_name=file_name,
                    document_type=document_type,
                )
            )
            index += 1

    return chunks


def _split_text(text: str, target_chars: int, overlap_chars: int) -> list[str]:
    """Packs paragraphs into ~target_chars windows with trailing overlap."""
    units = [u.strip() for u in _PARAGRAPH_SPLIT.split(text) if u.strip()]

    # A paragraph longer than the window is broken down further.
    expanded: list[str] = []
    for unit in units:
        if len(unit) <= target_chars:
            expanded.append(unit)
        else:
            expanded.extend(_split_sentences(unit, target_chars))

    windows: list[str] = []
    current = ""

    for unit in expanded:
        candidate = f"{current}\n\n{unit}" if current else unit
        if len(candidate) <= target_chars or not current:
            current = candidate
            continue
        windows.append(current)
        current = f"{_tail(current, overlap_chars)}{unit}" if overlap_chars else unit

    if current:
        windows.append(current)

    return windows


def _split_sentences(paragraph: str, target_chars: int) -> list[str]:
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(paragraph) if s.strip()]
    out: list[str] = []
    current = ""

    for sentence in sentences:
        candidate = f"{current} {sentence}".strip()
        if len(candidate) <= target_chars or not current:
            current = candidate
            continue
        out.append(current)
        current = sentence

    if current:
        out.append(current)

    # A single sentence longer than the window (rare) is hard-cut so it can
    # still be embedded rather than dropped.
    result: list[str] = []
    for piece in out:
        while len(piece) > target_chars * 2:
            result.append(piece[: target_chars * 2])
            piece = piece[target_chars * 2 :]
        result.append(piece)
    return result


def _tail(text: str, overlap_chars: int) -> str:
    """Last `overlap_chars` of text, snapped to a word boundary."""
    if overlap_chars <= 0 or len(text) <= overlap_chars:
        return f"{text}\n\n" if text else ""
    tail = text[-overlap_chars:]
    space = tail.find(" ")
    if space != -1:
        tail = tail[space + 1 :]
    return f"{tail}\n\n"

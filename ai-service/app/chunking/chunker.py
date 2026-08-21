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
    """One indexable passage of ANY evidence source.

    Source-agnostic by design. ``document_id`` is the storage key of whatever
    the passage came from — an uploaded file, or a submitted professional link
    — and ``file_name`` is its human-readable title. The extra
    ``source_type``/``source_url`` fields say which kind it is and, for a link,
    which exact page, so a citation can read "Resume.pdf · page 2" or
    "Portfolio Website · Projects · portfolio.example.com/projects".

    The defaults are load-bearing: chunks indexed before links existed carry no
    source metadata, and they are files.
    """

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
    source_type: str = "FILE"
    # The exact page a URL passage came from. Always None for files, where
    # page_number plays the same "where exactly" role.
    source_url: str | None = None


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


@dataclass
class WebSection:
    """One normalized section of a fetched web page.

    Produced by the BACKEND (src/web-ingestion), which owns every outbound
    request. By the time a section reaches this service the page has already
    been fetched, size-bounded, stripped of chrome and turned into text — the
    AI service performs no network egress to candidate-supplied destinations,
    and this type is where that boundary lands.
    """

    name: str | None
    heading: str | None
    text: str
    url: str | None


def chunk_web_sections(
    sections: list[WebSection],
    *,
    organization_id: str,
    candidate_id: str | None,
    source_id: str,
    source_title: str,
    source_url: str,
    target_chars: int = 900,
    overlap_chars: int = 150,
    min_split_chars: int = 1200,
    max_chunks: int = 80,
) -> list[Chunk]:
    """Turns fetched web sections into indexable chunks.

    The same splitting rules as files, deliberately: after normalization a
    portfolio section and a resume section are the same kind of thing, and
    giving them different chunk shapes would make retrieval quality depend on
    where evidence happened to come from.

    Two things are specific to the web:

      * a section's ``url`` is the exact page it came from, which may be a
        subpage of the submitted link, so a citation can point at
        ``/projects`` rather than at the site's front door;
      * ``max_chunks`` caps one source. A long, repetitive site must not be
        able to occupy a candidate's entire evidence footprint — the retrieval
        layer also caps per source, and this is the ingestion-side half of the
        same rule.
    """
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
            if index >= max_chunks:
                return chunks
            chunks.append(
                Chunk(
                    organization_id=organization_id,
                    candidate_id=candidate_id,
                    document_id=source_id,
                    # The canonical name when the heading mapped to one,
                    # otherwise the heading as written. Never invented: a
                    # section with neither stays None.
                    section=section.name or section.heading,
                    page_number=None,
                    chunk_index=index,
                    text=piece,
                    file_name=source_title,
                    document_type="URL",
                    source_type="URL",
                    source_url=section.url or source_url,
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

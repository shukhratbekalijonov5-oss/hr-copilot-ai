"""Extraction-artefact cleanup shared by every PDF extraction strategy.

Two artefact classes are handled, both conservatively:

* Glyph-spaced lines — PDFs that position every glyph individually extract as
  ``R a k h m a t i l l o``. Such a line is collapsed back into words, but
  only when single characters evidently dominate the whole line; initials,
  acronyms and ordinary prose never qualify.
* Ragged whitespace — runs of spaces collapse to one, and a page keeps at
  most one blank line between paragraphs (the chunker treats a blank line as
  a paragraph boundary).

Nothing here splits merged words back apart: turning
``withtestinganddocumentation`` into words would require guessing, and
guessed text must never sit behind a citation. Merged runs are fixed
upstream by layout-aware extraction, not by rewriting evidence.

All rules are Unicode-aware, so glyph-spaced Hangul and Cyrillic collapse
exactly like Latin while normally written Korean and Russian text is left
untouched.
"""

from __future__ import annotations

import re

# Inside a glyph-spaced line the artefact encodes a real word boundary as a
# run of 2+ spaces and an intra-word gap as a single space.
_WORD_GAP = re.compile(r"[^\S\n]{2,}")
_MULTI_SPACE = re.compile(r"[^\S\n]{2,}")

# A line is treated as glyph-spaced only when BOTH hold: it carries at least
# this many single-character letter/digit tokens, and single-character tokens
# make up at least this share of all its tokens. "U S A", "George R R Martin"
# and prose ("I saw a dog") all fail one of the two gates.
_MIN_SINGLE_TOKENS = 5
_MIN_SINGLE_RATIO = 0.7

# Signals for degradation_score. Tokens longer than this that are purely
# alphabetic almost never occur in real text and indicate merged runs.
_MERGED_RUN_CHARS = 30


def normalise_page_text(text: str) -> str:
    """Cleans one page of extracted text without inventing content."""
    cleaned: list[str] = []
    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = collapse_glyph_spacing(raw_line.strip())
        line = _MULTI_SPACE.sub(" ", line).strip()
        if line:
            cleaned.append(line)
        elif cleaned and cleaned[-1] != "":
            cleaned.append("")
    while cleaned and cleaned[-1] == "":
        cleaned.pop()
    return "\n".join(cleaned)


def collapse_glyph_spacing(line: str) -> str:
    """Rejoins a glyph-spaced line: ``R a k h m a t i l l o`` -> ``Rakhmatillo``.

    Word boundaries (2+ spaces in the artefact) survive as single spaces;
    lines that do not look glyph-spaced are returned unchanged.
    """
    if not _is_glyph_spaced(line):
        return line
    groups = _WORD_GAP.split(line.strip())
    return " ".join("".join(group.split()) for group in groups if group.strip())


def _is_glyph_spaced(line: str) -> bool:
    tokens = line.split()
    if len(tokens) < _MIN_SINGLE_TOKENS:
        return False
    singles = [token for token in tokens if len(token) == 1]
    if sum(1 for token in singles if token.isalnum()) < _MIN_SINGLE_TOKENS:
        return False
    return len(singles) / len(tokens) >= _MIN_SINGLE_RATIO


def degradation_score(text: str) -> float:
    """How damaged extracted text looks; 0.0 is clean, higher is worse.

    Used only to pick between extraction strategies and to log parser
    quality — never to reject a document for unusual formatting.
    """
    tokens = text.split()
    if not tokens:
        return float("inf")
    glyph_spaced = sum(1 for t in tokens if len(t) == 1 and t.isalnum())
    merged_runs = sum(1 for t in tokens if len(t) > _MERGED_RUN_CHARS and t.isalpha())
    return (glyph_spaced + 3.0 * merged_runs) / len(tokens)

"""PDF text extraction.

Two strategies, tried in order:

* Primary — pdfminer.six layout analysis. It groups glyphs into words and
  lines from their positions on the page (``all_texts=True`` so text inside
  Form XObjects is analysed too), which keeps glyph-positioned PDFs
  ("R a k h m a t i l l o") and multi-column layouts readable. pypdf's own
  ``extraction_mode="layout"`` was evaluated instead and returns empty
  output for exactly the PDFs that need it, so it is not used.
* Fallback — pypdf's plain text-layer read, used when pdfminer fails or its
  output scores worse than pypdf's on the degradation signals.

Neither strategy OCRs: a scanned image-only PDF yields no text and is
reported as empty rather than silently producing nothing useful downstream.

Both outputs pass through the same conservative normalisation
(``app.parsers.text_cleanup``), so chunking sees one behaviour regardless of
which strategy produced the text.
"""

from __future__ import annotations

import logging
from io import BytesIO

from pypdf import PdfReader

from app.common.errors import CorruptDocumentError, EmptyDocumentError
from app.common.logging import get_logger
from app.parsers.base import ParsedDocument, ParsedPage
from app.parsers.text_cleanup import degradation_score, normalise_page_text

logger = get_logger(__name__)

# pdfminer logs a warning per glyph for fonts with incomplete descriptors —
# thousands of lines for one resume. Errors still surface as exceptions.
logging.getLogger("pdfminer").setLevel(logging.ERROR)

# Above this score the primary output is suspect enough to also try the
# fallback and keep whichever scores lower.
_DEGRADED_THRESHOLD = 0.25


def parse_pdf(data: bytes) -> ParsedDocument:
    miner_pages = _extract_pdfminer(data)
    miner_score = _score(miner_pages)

    if miner_pages is not None and miner_score < _DEGRADED_THRESHOLD:
        return _document("pdfminer", miner_pages, miner_score)

    try:
        pypdf_pages = _extract_pypdf(data)
    except CorruptDocumentError:
        if miner_pages is None:
            raise
        pypdf_pages = None
    pypdf_score = _score(pypdf_pages)

    if miner_pages is None and pypdf_pages is None:
        raise CorruptDocumentError("PDF could not be read by any extractor")

    # Both strategies produced the same page structure: choose PER PAGE. A
    # mixed-quality document (clean text pages next to glyph-positioned design
    # pages — the portfolio-PDF shape) then keeps each strategy's good pages
    # instead of accepting one strategy's bad ones everywhere. Whole-document
    # selection below stays the fallback when the structures disagree.
    if (
        miner_pages is not None
        and pypdf_pages is not None
        and len(miner_pages) == len(pypdf_pages)
    ):
        merged = [
            _better_page(miner, pypdf)
            for miner, pypdf in zip(miner_pages, pypdf_pages)
        ]
        return _document("per-page", merged, _score(merged))

    # Lower degradation wins; the layout-aware strategy wins ties. At least
    # one side is non-None here, and a None side scores infinity.
    if miner_pages is not None and miner_score <= pypdf_score:
        return _document("pdfminer", miner_pages, miner_score)
    return _document("pypdf", pypdf_pages or [], pypdf_score)


def _better_page(miner_text: str, pypdf_text: str) -> str:
    """The less-degraded of two extractions of the SAME page.

    An empty side loses to a non-empty side outright (degradation_score cannot
    rank nothing against something), and pdfminer's layout-aware output wins
    ties, matching the whole-document rule. One unreadable page can therefore
    never fail the document — it merely contributes whatever its best
    extraction found, possibly nothing.
    """
    if not miner_text.strip():
        return pypdf_text
    if not pypdf_text.strip():
        return miner_text
    if degradation_score(miner_text) <= degradation_score(pypdf_text):
        return miner_text
    return pypdf_text


def _document(strategy: str, pages: list[str], score: float) -> ParsedDocument:
    document = ParsedDocument(
        page_count=len(pages),
        pages=[
            ParsedPage(page_number=index, text=text)
            for index, text in enumerate(pages, start=1)
        ],
    )
    if document.is_empty:
        raise EmptyDocumentError(
            "PDF contains no extractable text (it may be a scan; OCR is not enabled)"
        )
    logger.info(
        "PDF text extracted",
        extra={
            "stage": "parsing",
            "strategy": strategy,
            "pageCount": document.page_count,
            "degradationScore": None if score == float("inf") else round(score, 3),
        },
    )
    return document


def _score(pages: list[str] | None) -> float:
    if pages is None:
        return float("inf")
    return degradation_score("\n".join(pages))


def _extract_pdfminer(data: bytes) -> list[str] | None:
    """Layout-aware extraction; returns None when pdfminer cannot cope."""
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams

    try:
        pages = [
            normalise_page_text(_layout_text(layout))
            for layout in extract_pages(
                BytesIO(data), laparams=LAParams(all_texts=True)
            )
        ]
    except Exception as exc:
        logger.warning(
            "pdfminer extraction failed; falling back to pypdf",
            extra={"stage": "parsing", "errorType": type(exc).__name__},
        )
        return None
    return pages or None


def _layout_text(container) -> str:
    """Collects text from a pdfminer layout tree in reading order.

    Text boxes are taken whole; figures (Form XObjects) are descended into
    because resume builders routinely wrap the entire page in one.
    """
    from pdfminer.layout import LTFigure, LTTextContainer

    parts: list[str] = []
    for element in container:
        if isinstance(element, LTTextContainer):
            parts.append(element.get_text())
        elif isinstance(element, LTFigure):
            nested = _layout_text(element)
            if nested:
                parts.append(nested)
    return "\n".join(parts)


def _extract_pypdf(data: bytes) -> list[str]:
    """Plain text-layer read; raises CorruptDocumentError when unreadable."""
    try:
        reader = PdfReader(BytesIO(data))
        raw_pages = reader.pages
        page_count = len(raw_pages)
    except Exception as exc:  # pypdf raises assorted types on malformed input
        raise CorruptDocumentError(f"PDF could not be read: {exc}") from exc

    pages: list[str] = []
    for index in range(page_count):
        try:
            text = raw_pages[index].extract_text() or ""
        except Exception:
            # One unreadable page must not discard the rest of the document.
            text = ""
        pages.append(normalise_page_text(text))
    return pages

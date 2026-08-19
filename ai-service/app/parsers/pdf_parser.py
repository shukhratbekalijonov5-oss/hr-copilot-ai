"""PDF text extraction.

Uses pypdf, which reads the text layer already present in the file. It does not
OCR: a scanned image-only PDF yields no text and is reported as empty rather
than silently producing nothing useful downstream.
"""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.common.errors import CorruptDocumentError, EmptyDocumentError
from app.parsers.base import ParsedDocument, ParsedPage


def parse_pdf(data: bytes) -> ParsedDocument:
    try:
        reader = PdfReader(BytesIO(data))
        raw_pages = reader.pages
    except (PdfReadError, OSError, ValueError) as exc:
        raise CorruptDocumentError(f"PDF could not be read: {exc}") from exc
    except Exception as exc:  # pypdf raises assorted types on malformed input
        raise CorruptDocumentError(f"PDF could not be read: {exc}") from exc

    pages: list[ParsedPage] = []
    for index, page in enumerate(raw_pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            # One unreadable page must not discard the rest of the document.
            text = ""
        pages.append(ParsedPage(page_number=index, text=_normalise(text)))

    document = ParsedDocument(page_count=len(pages), pages=pages)
    if document.is_empty:
        raise EmptyDocumentError(
            "PDF contains no extractable text (it may be a scan; OCR is not enabled)"
        )
    return document


def _normalise(text: str) -> str:
    """Collapses the ragged whitespace PDF extraction typically produces."""
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    return "\n".join(line for line in lines if line)

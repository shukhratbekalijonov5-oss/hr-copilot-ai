"""Document parsing: raw bytes -> text with page and section structure."""

from __future__ import annotations

from app.common.errors import UnsupportedFileTypeError
from app.parsers.base import ParsedDocument, ParsedPage
from app.parsers.docx_parser import parse_docx
from app.parsers.pdf_parser import parse_pdf
from app.parsers.sections import Section, detect_section, split_into_sections

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Leading bytes each accepted format must begin with. The declared content type
# and the filename are both caller-controlled, so content is what decides.
_MAGIC = {
    PDF_MIME: b"%PDF",
    DOCX_MIME: b"PK\x03\x04",
}


def detect_file_type(data: bytes, file_name: str) -> str:
    """Returns the MIME type implied by the file's own bytes.

    Raises UnsupportedFileTypeError when the content is neither PDF nor DOCX,
    or when it contradicts the extension.
    """
    for mime, magic in _MAGIC.items():
        if data.startswith(magic):
            detected = mime
            break
    else:
        raise UnsupportedFileTypeError(
            "Unsupported file type: only PDF and DOCX are accepted"
        )

    extension = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""
    expected = {"pdf": PDF_MIME, "docx": DOCX_MIME}.get(extension)
    if expected is not None and expected != detected:
        raise UnsupportedFileTypeError(
            f"File content does not match its .{extension} extension"
        )

    return detected


def parse_document(data: bytes, file_name: str) -> ParsedDocument:
    """Parses PDF or DOCX bytes into pages of text."""
    mime = detect_file_type(data, file_name)
    if mime == PDF_MIME:
        return parse_pdf(data)
    return parse_docx(data)


__all__ = [
    "DOCX_MIME",
    "PDF_MIME",
    "ParsedDocument",
    "ParsedPage",
    "Section",
    "detect_file_type",
    "detect_section",
    "parse_document",
    "parse_docx",
    "parse_pdf",
    "split_into_sections",
]

"""PDF/DOCX parsing and section detection."""

from __future__ import annotations

import pytest

from app.common.errors import (
    CorruptDocumentError,
    EmptyDocumentError,
    UnsupportedFileTypeError,
)
from app.parsers import (
    DOCX_MIME,
    PDF_MIME,
    detect_file_type,
    detect_section,
    parse_document,
    split_into_sections,
)
from tests.fixtures.resumes import (
    JIWOO_HAN_TEXT,
    MARCUS_OSEI_TEXT,
    build_corrupt_pdf,
    build_docx,
    build_empty_pdf,
    build_pdf,
)


class TestFileTypeDetection:
    def test_detects_pdf_from_magic_bytes(self):
        assert detect_file_type(build_pdf("hello"), "cv.pdf") == PDF_MIME

    def test_detects_docx_from_magic_bytes(self):
        assert detect_file_type(build_docx("hello"), "cv.docx") == DOCX_MIME

    def test_rejects_plain_text(self):
        with pytest.raises(UnsupportedFileTypeError):
            detect_file_type(b"just some text", "cv.txt")

    def test_rejects_an_executable_renamed_to_pdf(self):
        with pytest.raises(UnsupportedFileTypeError):
            detect_file_type(b"MZ\x90\x00" + b"\x00" * 50, "cv.pdf")

    def test_rejects_content_contradicting_the_extension(self):
        """A DOCX renamed .pdf must not be accepted as a PDF."""
        with pytest.raises(UnsupportedFileTypeError):
            detect_file_type(build_docx("hello"), "cv.pdf")


class TestPdfParsing:
    def test_extracts_real_text(self):
        parsed = parse_document(build_pdf(JIWOO_HAN_TEXT), "cv.pdf")
        assert "Ji-woo Han" in parsed.full_text
        assert "Kubernetes" in parsed.full_text
        assert parsed.page_count >= 1

    def test_preserves_page_numbers(self):
        parsed = parse_document(build_pdf(JIWOO_HAN_TEXT * 4), "cv.pdf")
        assert parsed.page_count > 1
        assert [p.page_number for p in parsed.pages] == list(
            range(1, parsed.page_count + 1)
        )

    def test_empty_pdf_is_reported_not_silently_accepted(self):
        with pytest.raises(EmptyDocumentError):
            parse_document(build_empty_pdf(), "scan.pdf")

    def test_corrupt_pdf_raises(self):
        with pytest.raises((CorruptDocumentError, EmptyDocumentError)):
            parse_document(build_corrupt_pdf(), "broken.pdf")


class TestDocxParsing:
    def test_extracts_paragraphs_and_tables(self):
        parsed = parse_document(build_docx(JIWOO_HAN_TEXT), "cv.docx")
        assert "Ji-woo Han" in parsed.full_text
        # The fixture's table content must survive.
        assert "Production, 3 years" in parsed.full_text

    def test_reports_a_single_page(self):
        """DOCX has no stored pagination; inventing page numbers would be a lie."""
        parsed = parse_document(build_docx(JIWOO_HAN_TEXT), "cv.docx")
        assert parsed.page_count == 1

    def test_corrupt_docx_raises(self):
        with pytest.raises(CorruptDocumentError):
            parse_document(b"PK\x03\x04" + b"\x00" * 100, "broken.docx")


class TestSectionDetection:
    @pytest.mark.parametrize(
        "line,expected",
        [
            ("Experience", "experience"),
            ("WORK EXPERIENCE", "experience"),
            ("Skills:", "skills"),
            ("— Education —", "education"),
            ("Languages", "languages"),
            ("경력", "experience"),
            ("기술스택", "skills"),
        ],
    )
    def test_recognises_headings(self, line, expected):
        assert detect_section(line) == expected

    @pytest.mark.parametrize(
        "line",
        [
            "I have eight years of experience building distributed services",
            "Led the migration to a production Kubernetes cluster",
            "",
            "Reduced p99 order placement latency from 820ms to 180ms",
        ],
    )
    def test_does_not_treat_prose_as_a_heading(self, line):
        """A sentence mentioning 'experience' is not a section heading."""
        assert detect_section(line) is None

    def test_splits_a_resume_into_expected_sections(self):
        parsed = parse_document(build_pdf(JIWOO_HAN_TEXT), "cv.pdf")
        sections = split_into_sections(parsed.pages)
        found = {s.name for s in sections if s.name}

        assert {"summary", "experience", "skills", "education"} <= found

    def test_unknown_text_is_labelled_none_not_guessed(self):
        parsed = parse_document(build_pdf("Some text with no headings at all."), "x.pdf")
        sections = split_into_sections(parsed.pages)

        assert sections
        assert all(s.name is None for s in sections)

    def test_sections_carry_page_numbers(self):
        parsed = parse_document(build_pdf(MARCUS_OSEI_TEXT), "cv.pdf")
        sections = split_into_sections(parsed.pages)

        assert all(s.page_number >= 1 for s in sections)

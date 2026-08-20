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
    CYRILLIC_LINES,
    JIWOO_HAN_TEXT,
    KOREAN_LINES,
    MARCUS_OSEI_TEXT,
    build_corrupt_pdf,
    build_cyrillic_pdf,
    build_docx,
    build_empty_pdf,
    build_korean_pdf,
    build_letter_spaced_pdf,
    build_multi_column_pdf,
    build_pdf,
    find_cyrillic_font,
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


class TestPdfExtractionQuality:
    """Layout-aware extraction plus conservative cleanup, end to end."""

    def test_glyph_spaced_pdf_comes_out_as_words(self):
        parsed = parse_document(build_letter_spaced_pdf(), "cv.pdf")
        text = parsed.full_text
        assert "Rakhmatillo" in text
        assert "Full Stack Developer" in text
        assert "andrew0331r@gmail.com" in text
        assert "+821056375426" in text
        assert "R a k h" not in text
        assert "F u l l" not in text

    def test_glyph_spaced_headings_become_detectable_sections(self):
        parsed = parse_document(build_letter_spaced_pdf(), "cv.pdf")
        sections = split_into_sections(parsed.pages)
        assert "skills" in {s.name for s in sections}

    def test_multi_column_pdf_does_not_interleave_columns(self):
        parsed = parse_document(build_multi_column_pdf(), "cv.pdf")
        text = parsed.full_text
        # Every phrase survives whole...
        assert "Work Experience" in text
        assert "Redis Pub/Sub" in text
        assert "Built the order orchestration platform" in text
        # ...and no extracted line mixes the two columns.
        for line in text.split("\n"):
            assert not ("Hanwool" in line and "Kubernetes" in line), line
            assert not ("Work Experience" in line and "Skills" in line), line

    def test_korean_pdf_with_mixed_english_is_preserved(self):
        parsed = parse_document(build_korean_pdf(), "cv.pdf")
        text = parsed.full_text
        for line in KOREAN_LINES:
            assert line in text
        assert "Backend Engineer, Seoul, South Korea" in text

    @pytest.mark.skipif(
        find_cyrillic_font() is None,
        reason="no Cyrillic-capable TTF on this host",
    )
    def test_cyrillic_pdf_is_preserved(self):
        font = find_cyrillic_font()
        assert font is not None
        parsed = parse_document(build_cyrillic_pdf(font), "cv.pdf")
        for line in CYRILLIC_LINES:
            assert line in parsed.full_text

    def test_page_content_stays_on_its_page(self):
        page_one = "ALPHA_MARKER opening line"
        filler = "\n".join(f"Filler line number {i}" for i in range(70))
        page_two_tail = "OMEGA_MARKER closing line"
        parsed = parse_document(
            build_pdf(f"{page_one}\n{filler}\n{page_two_tail}"), "cv.pdf"
        )
        assert parsed.page_count == 2
        assert "ALPHA_MARKER" in parsed.pages[0].text
        assert "OMEGA_MARKER" not in parsed.pages[0].text
        assert "OMEGA_MARKER" in parsed.pages[1].text

    def test_falls_back_to_pypdf_when_pdfminer_fails(self, monkeypatch):
        from app.parsers import pdf_parser

        monkeypatch.setattr(pdf_parser, "_extract_pdfminer", lambda data: None)
        parsed = parse_document(build_pdf(JIWOO_HAN_TEXT), "cv.pdf")
        assert "Ji-woo Han" in parsed.full_text
        assert "Kubernetes" in parsed.full_text

    def test_degraded_primary_output_loses_to_a_clean_fallback(self, monkeypatch):
        from app.parsers import pdf_parser

        # Primary "succeeds" but returns glyph-soup the cleanup gate cannot
        # rescue; the clean pypdf reading must win the comparison.
        monkeypatch.setattr(
            pdf_parser,
            "_extract_pdfminer",
            lambda data: ["x 1 q. 2 z- 3 w 4 v 5 b 6 n 7 m 8 k 9 j 0" * 3],
        )
        parsed = parse_document(build_pdf(JIWOO_HAN_TEXT), "cv.pdf")
        assert "Ji-woo Han" in parsed.full_text


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

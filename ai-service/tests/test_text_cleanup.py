"""Conservative extraction-artefact cleanup.

The de-letter-spacing rule must fix genuinely glyph-spaced lines while
leaving initials, acronyms, prose and every supported language untouched —
a wrong collapse would rewrite the evidence a citation points at.
"""

from __future__ import annotations

import pytest

from app.parsers.text_cleanup import (
    collapse_glyph_spacing,
    degradation_score,
    normalise_page_text,
)


class TestCollapseGlyphSpacing:
    @pytest.mark.parametrize(
        "line,expected",
        [
            ("R a k h m a t i l l o", "Rakhmatillo"),
            # Two spaces in the artefact is a real word boundary.
            ("F u l l  S t a c k  D e v e l o p e r", "Full Stack Developer"),
            ("S k i l l s", "Skills"),
            (
                "H T M L ,  C S S ,  S A S S ,  J a v a S c r i p t",
                "HTML, CSS, SASS, JavaScript",
            ),
            ("a n d r e w 0 3 3 1 r @ g m a i l . c o m", "andrew0331r@gmail.com"),
            ("+ 8 2 1 0 5 6 3 7 5 4 2 6", "+821056375426"),
            # Glyph-spaced Hangul and Cyrillic collapse the same way.
            (
                "서 울  종 로 구  우 정 국 로 2 길  3 5",
                "서울 종로구 우정국로2길 35",
            ),
            ("П р и в е т  м и р", "Привет мир"),
        ],
    )
    def test_collapses_glyph_spaced_lines(self, line, expected):
        assert collapse_glyph_spacing(line) == expected

    @pytest.mark.parametrize(
        "line",
        [
            "I saw a dog run by",
            "George R R Martin",
            "U S A",
            "J. K. Rowling",
            "Grade A in every course",
            # Mostly punctuation singles: not glyph spacing.
            "Python , Go , C , R",
            # Normally written Korean and Russian stay untouched.
            "저는 백엔드 엔지니어로 근무했습니다",
            "Опытный инженер по данным",
            "Reduced p99 latency from 820ms to 180ms",
        ],
    )
    def test_leaves_legitimate_text_unchanged(self, line):
        assert collapse_glyph_spacing(line) == line


class TestNormalisePageText:
    def test_collapses_justified_double_spaces(self):
        assert normalise_page_text("HTML,  CSS,  SASS") == "HTML, CSS, SASS"

    def test_keeps_at_most_one_blank_line_between_paragraphs(self):
        text = "First paragraph\n\n\n\nSecond paragraph"
        assert normalise_page_text(text) == "First paragraph\n\nSecond paragraph"

    def test_strips_leading_and_trailing_blank_lines(self):
        assert normalise_page_text("\n\nOnly line\n\n\n") == "Only line"

    def test_handles_crlf(self):
        assert normalise_page_text("one\r\ntwo") == "one\ntwo"

    def test_applies_glyph_collapse_per_line(self):
        text = "R a k h m a t i l l o\nNormal prose stays as it is"
        assert (
            normalise_page_text(text) == "Rakhmatillo\nNormal prose stays as it is"
        )

    def test_preserves_paragraph_boundaries_for_the_chunker(self):
        text = "Experience\n\nBuilt services.\n\nEducation"
        assert normalise_page_text(text) == text


class TestDegradationScore:
    def test_clean_prose_scores_low(self):
        clean = "Backend engineer with eight years building distributed services."
        assert degradation_score(clean) < 0.25

    def test_glyph_spaced_text_scores_high(self):
        assert degradation_score("R a k h m a t i l l o A n d r e w") > 0.9

    def test_merged_runs_score_worse_than_clean_text(self):
        merged = "worked withtestinganddocumentationofinternalprojects daily"
        clean = "worked with testing and documentation of internal projects daily"
        assert degradation_score(merged) > degradation_score(clean)

    def test_empty_text_is_worst(self):
        assert degradation_score("") == float("inf")
        assert degradation_score("   \n  ") == float("inf")

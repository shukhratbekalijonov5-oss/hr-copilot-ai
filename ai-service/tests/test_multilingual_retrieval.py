"""Multilingual retrieval across the four supported locales (§32).

Retrieval must work when the query language differs from the document
language — a Korean HR user asking about an English CV is a core product case.
These tests exercise the real embedding model, no LLM required.
"""

from __future__ import annotations

import uuid

import pytest

from app.config import get_settings
from app.retrieval import process_document, search_evidence
from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_docx, build_pdf

pytestmark = [pytest.mark.integration, pytest.mark.slow]

CAND = "cand-ml"

# Korean-language fictional resume, for the reverse direction.
KOREAN_RESUME = """한지우
백엔드 엔지니어
서울, 대한민국 | jiwoo.test@example.test

경력
한울물류 수석 백엔드 엔지니어 (2021 - 현재)
NestJS와 TypeScript로 주문 처리 플랫폼을 구축하고 운영했습니다.
Redis Pub/Sub 기반 이벤트 전파 계층을 설계했습니다.
프로덕션 쿠버네티스 클러스터로 플랫폼을 이전하는 작업을 주도했습니다.

기술
TypeScript, NestJS, Go, PostgreSQL, Redis, 쿠버네티스, Docker

학력
연세대학교 컴퓨터공학 학사 (2014 - 2018)

어학
한국어(모국어), 영어(업무 가능)
"""


@pytest.fixture()
def english_resume(store, embedder):
    org = f"org-{uuid.uuid4()}"
    doc = f"doc-{uuid.uuid4()}"
    process_document(
        data=build_pdf(JIWOO_HAN_TEXT), file_name="english-cv.pdf",
        document_id=doc, organization_id=org, candidate_id=CAND,
        settings=get_settings(), embedder=embedder, store=store,
    )
    yield org
    store.delete_document(org, doc)


@pytest.fixture()
def korean_resume(store, embedder):
    """Korean fixture is DOCX, deliberately.

    `build_pdf` renders with reportlab's built-in Helvetica, which has no
    Hangul glyphs — Korean text comes back as "■■■". That is a limitation of
    the *test helper*, not of the parser: a real Korean PDF embeds its own font
    and pypdf extracts it correctly. DOCX round-trips Korean exactly, so it is
    the honest way to exercise a non-Latin source document here.

    See `test_reportlab_cannot_render_hangul` below, which pins this so nobody
    "fixes" the fixture back to PDF and gets a silently meaningless test.
    """
    org = f"org-{uuid.uuid4()}"
    doc = f"doc-{uuid.uuid4()}"
    process_document(
        data=build_docx(KOREAN_RESUME), file_name="korean-cv.docx",
        document_id=doc, organization_id=org, candidate_id=CAND,
        settings=get_settings(), embedder=embedder, store=store,
    )
    yield org
    store.delete_document(org, doc)


def _search(store, embedder, org, query, limit=5):
    return search_evidence(
        organization_id=org, query=query, limit=limit, candidate_id=None,
        document_id=None, use_rerank=False, settings=get_settings(),
        embedder=embedder, store=store, reranker=None,
    )


class TestQueryLanguageVersusDocumentLanguage:
    @pytest.mark.parametrize(
        "locale,query",
        [
            ("en", "production Kubernetes experience"),
            ("ko", "프로덕션 쿠버네티스 운영 경험"),
            ("ru", "опыт эксплуатации Kubernetes в продакшене"),
            ("uz", "ishlab chiqarishda Kubernetes tajribasi"),
        ],
    )
    def test_all_four_locales_retrieve_from_an_english_cv(
        self, store, embedder, english_resume, locale, query
    ):
        response = _search(store, embedder, english_resume, query)

        assert response.hits, f"{locale} query retrieved nothing"
        combined = " ".join(h.text for h in response.hits).lower()
        assert "kubernetes" in combined

    def test_english_query_retrieves_from_a_korean_cv(
        self, store, embedder, korean_resume
    ):
        """The reverse direction: English query, Korean source document."""
        response = _search(store, embedder, korean_resume, "Kubernetes production experience")

        assert response.hits
        combined = " ".join(h.text for h in response.hits)
        assert "쿠버네티스" in combined or "Kubernetes" in combined

    def test_russian_query_retrieves_from_a_korean_cv(
        self, store, embedder, korean_resume
    ):
        response = _search(store, embedder, korean_resume, "опыт работы с Redis")

        assert response.hits
        assert "Redis" in " ".join(h.text for h in response.hits)


class TestMultilingualProvenance:
    def test_citations_from_a_korean_cv_stay_in_korean(
        self, store, embedder, korean_resume
    ):
        """Evidence text is verbatim source, never translated by retrieval."""
        response = _search(store, embedder, korean_resume, "Kubernetes experience")

        text = " ".join(h.text for h in response.hits)
        assert any(ord(ch) > 0x1100 for ch in text), "Korean source text was altered"

    def test_metadata_survives_across_languages(self, store, embedder, korean_resume):
        response = _search(store, embedder, korean_resume, "경력")

        for hit in response.hits:
            assert hit.chunkId
            assert hit.fileName == "korean-cv.docx"


class TestMultilingualTenantIsolation:
    def test_a_foreign_language_query_cannot_cross_tenants(
        self, store, embedder, english_resume
    ):
        other = f"org-other-{uuid.uuid4()}"
        response = _search(store, embedder, other, "프로덕션 쿠버네티스 운영 경험")

        assert response.hits == []


class TestFixtureLimitations:
    """Documents a test-helper constraint so it is not mistaken for a bug."""

    def test_reportlab_cannot_render_hangul(self):
        """build_pdf uses Helvetica, which has no Hangul glyphs.

        Korean therefore survives as "■". Real Korean PDFs embed a font and
        extract correctly — this pins the helper's limit, and is why the
        Korean fixture above is DOCX.
        """
        from app.parsers import parse_document

        parsed = parse_document(build_pdf("쿠버네티스 운영 경험"), "ko.pdf")

        assert "■" in parsed.full_text
        assert "쿠버네티스" not in parsed.full_text

    def test_docx_preserves_korean_exactly(self):
        from app.parsers import parse_document

        parsed = parse_document(build_docx("쿠버네티스 운영 경험"), "ko.docx")

        assert "쿠버네티스" in parsed.full_text

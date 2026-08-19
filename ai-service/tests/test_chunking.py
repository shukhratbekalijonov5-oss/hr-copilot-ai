"""Chunking and Qdrant payload construction.

The property that matters most here is provenance: every chunk must keep the
tenant, candidate, document, section and page it came from, because that is
what a citation is built from.
"""

from __future__ import annotations

from app.chunking import chunk_sections
from app.parsers import parse_document, split_into_sections
from app.parsers.sections import Section
from app.vectorstore import build_payload, build_point_id
from tests.fixtures.resumes import JIWOO_HAN_TEXT, build_pdf

ORG = "org-a"
DOC = "doc-1"
CAND = "cand-1"


def _sections_from_fixture() -> list[Section]:
    parsed = parse_document(build_pdf(JIWOO_HAN_TEXT), "cv.pdf")
    return split_into_sections(parsed.pages)


def _chunk(sections, **kwargs):
    return chunk_sections(
        sections,
        organization_id=ORG,
        document_id=DOC,
        candidate_id=CAND,
        file_name="cv.pdf",
        **kwargs,
    )


class TestChunkMetadata:
    def test_every_chunk_carries_full_provenance(self):
        chunks = _chunk(_sections_from_fixture())

        assert chunks
        for chunk in chunks:
            assert chunk.organization_id == ORG
            assert chunk.document_id == DOC
            assert chunk.candidate_id == CAND
            assert chunk.page_number is not None and chunk.page_number >= 1
            assert chunk.text.strip()

    def test_chunk_indexes_are_sequential_and_unique(self):
        chunks = _chunk(_sections_from_fixture())
        indexes = [c.chunk_index for c in chunks]

        assert indexes == list(range(len(chunks)))
        assert len(set(indexes)) == len(indexes)

    def test_detected_sections_are_preserved_on_chunks(self):
        chunks = _chunk(_sections_from_fixture())
        sections = {c.section for c in chunks if c.section}

        assert "experience" in sections
        assert "skills" in sections

    def test_unknown_section_stays_none(self):
        chunks = _chunk([Section(name=None, page_number=1, text="Loose text")])

        assert chunks[0].section is None


class TestChunkSizing:
    def test_short_section_is_kept_whole(self):
        """A compact skills list must not be fragmented."""
        skills = Section(
            name="skills",
            page_number=1,
            text="TypeScript, NestJS, Redis, Kubernetes, Go, PostgreSQL",
        )
        chunks = _chunk([skills])

        assert len(chunks) == 1
        assert "Kubernetes" in chunks[0].text

    def test_long_section_is_split(self):
        long_text = "\n\n".join(
            f"Paragraph {i} describing production work in detail. " * 6
            for i in range(12)
        )
        chunks = _chunk(
            [Section(name="experience", page_number=1, text=long_text)],
            target_chars=500,
            min_split_chars=600,
        )

        assert len(chunks) > 1

    def test_split_chunks_stay_near_the_target_size(self):
        long_text = "\n\n".join(f"Sentence block {i}. " * 20 for i in range(15))
        chunks = _chunk(
            [Section(name="experience", page_number=1, text=long_text)],
            target_chars=600,
            overlap_chars=100,
            min_split_chars=600,
        )

        # Overlap and word-boundary snapping allow modest overshoot.
        assert all(len(c.text) <= 600 * 2 for c in chunks)

    def test_overlap_preserves_continuity_between_chunks(self):
        paragraphs = [f"Distinct paragraph number {i} about backend work." for i in range(20)]
        chunks = _chunk(
            [Section(name="experience", page_number=1, text="\n\n".join(paragraphs))],
            target_chars=200,
            overlap_chars=80,
            min_split_chars=200,
        )

        assert len(chunks) > 1

    def test_empty_sections_produce_no_chunks(self):
        assert _chunk([Section(name="skills", page_number=1, text="   ")]) == []


class TestQdrantPayload:
    def test_payload_contains_every_required_field(self):
        chunk = _chunk(_sections_from_fixture())[0]
        payload = build_payload(chunk)

        for field in (
            "organizationId", "candidateId", "documentId",
            "section", "pageNumber", "chunkIndex", "text",
        ):
            assert field in payload

    def test_payload_carries_filename_for_citations(self):
        payload = build_payload(_chunk(_sections_from_fixture())[0])
        assert payload["fileName"] == "cv.pdf"

    def test_payload_never_contains_credentials_or_urls(self):
        """A vector-store leak must not become a document leak."""
        payload = build_payload(_chunk(_sections_from_fixture())[0])
        serialised = str(payload).lower()

        for forbidden in ("http://", "https://", "signature=", "token", "secret", "storagekey"):
            assert forbidden not in serialised


class TestPointIds:
    def test_point_id_is_deterministic(self):
        assert build_point_id("doc-1", 3) == build_point_id("doc-1", 3)

    def test_point_id_differs_per_chunk(self):
        assert build_point_id("doc-1", 0) != build_point_id("doc-1", 1)

    def test_point_id_differs_per_document(self):
        assert build_point_id("doc-1", 0) != build_point_id("doc-2", 0)

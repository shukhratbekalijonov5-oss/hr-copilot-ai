"""The AI service knows nothing about how a candidate entered the product.

HR-side candidate creation and HR-side file upload were removed from the
product: every organization document is now the apply-time snapshot of a
resume its owner submitted. That change belongs entirely to the backend, and
these tests pin the reason why — the AI service never modelled document
provenance, candidate "source", or who uploaded a file, so there is nothing
here that could still assume a recruiter-uploaded corpus.

The authorization boundary lives OUTSIDE this service by design: the backend
decides which candidates an HR user may reach (owned vacancy + a real
application) and only then asks a question about them. These tests assert that
the contracts stay that shape, so the boundary cannot quietly migrate here.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    CandidateSummaryRequest,
    EvidenceMapRequest,
    InterviewQuestionsRequest,
    ProcessDocumentRequest,
    RagRequest,
    SearchRequest,
)

PROVENANCE_FIELDS = {
    "source",
    "applicationSource",
    "uploadedBy",
    "uploadedById",
    "isManual",
    "manual",
    "candidateAccountId",
}


class TestNoDocumentProvenance:
    def test_ingestion_carries_no_uploader_or_source_field(self):
        fields = set(ProcessDocumentRequest.model_fields)
        assert fields & PROVENANCE_FIELDS == set()
        # Only the identifiers the backend derived from its own tenancy.
        assert {"documentId", "organizationId", "candidateId"} <= fields

    def test_ingestion_rejects_a_smuggled_provenance_field(self):
        # extra="forbid": a caller cannot start labelling documents by origin
        # without a deliberate contract change here.
        with pytest.raises(ValidationError):
            ProcessDocumentRequest(
                documentId="doc-1",
                organizationId="org-1",
                fileName="resume.pdf",
                source="MANUAL_UPLOAD",
            )

    def test_search_filters_by_tenancy_and_ids_only(self):
        fields = set(SearchRequest.model_fields)
        assert fields & PROVENANCE_FIELDS == set()
        assert "organizationId" in fields


class TestAuthorizationStaysInTheBackend:
    """Every recruiter-facing request names its subject explicitly.

    The service answers about exactly the candidate/vacancy it is given. It
    receives no membership, role or application data with which it could decide
    access — which is precisely why the backend must (and does) resolve the
    owned vacancy and the applicant association first.
    """

    def test_summary_is_candidate_scoped_and_vacancy_aware(self):
        fields = set(CandidateSummaryRequest.model_fields)
        assert {"organizationId", "candidateId"} <= fields
        # Vacancy grounding survives the cleanup untouched.
        assert "vacancy" in fields

    def test_interview_questions_require_the_vacancy_context(self):
        fields = set(InterviewQuestionsRequest.model_fields)
        assert {
            "organizationId",
            "candidateId",
            "vacancyId",
            "requirements",
        } <= fields

    def test_evidence_mapping_is_per_candidate_and_vacancy(self):
        fields = set(EvidenceMapRequest.model_fields)
        assert {"organizationId", "candidateId", "vacancyId", "requirements"} <= fields

    def test_ask_carries_no_authorization_input(self):
        fields = set(RagRequest.model_fields)
        assert {"organizationId", "candidateId", "vacancyId", "vacancy"} <= fields
        # No role, membership or ownership claim is accepted from the caller.
        assert fields & {"role", "userId", "memberships", "createdById"} == set()

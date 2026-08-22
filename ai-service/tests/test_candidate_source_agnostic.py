"""The AI service knows nothing about how a candidate entered the product.

HR-side candidate creation and HR-side file upload were removed from the
product, and so were the application-time evidence SNAPSHOTS that used to copy
a candidate's files and links into org-owned rows. Recruiter retrieval now
reads the candidate's own personal collection, scoped to an authorized list of
candidate ACCOUNT ids. Those changes belong entirely to the backend, and these
tests pin the reason why — the AI service never modelled document provenance,
candidate "source", or who uploaded a file, so there is nothing here that could
still assume a recruiter-uploaded corpus.

The authorization boundary lives OUTSIDE this service by design: the backend
decides which candidate accounts an HR user may reach (owned vacancy + a real
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

#: Fields that would describe WHERE a document came from or WHO put it there.
#: None of them has ever existed on any contract, and none may appear now.
PROVENANCE_FIELDS = {
    "source",
    "applicationSource",
    "uploadedBy",
    "uploadedById",
    "isManual",
    "manual",
}


class TestNoDocumentProvenance:
    def test_ingestion_carries_no_uploader_or_source_field(self):
        fields = set(ProcessDocumentRequest.model_fields)
        assert fields & PROVENANCE_FIELDS == set()
        # Only the identifiers the backend derived from its own tenancy.
        assert {"documentId", "organizationId", "candidateId"} <= fields
        # And ingestion stays org-scoped: it writes the recruiter collection,
        # never the personal one, so it must not take an account key.
        assert "candidateAccountId" not in fields

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

    def test_search_filters_by_authorized_accounts_and_ids_only(self):
        fields = set(SearchRequest.model_fields)
        assert fields & PROVENANCE_FIELDS == set()
        # The retrieval universe, resolved by the backend from the caller's own
        # vacancies' applicant relationships.
        assert "candidateAccountIds" in fields
        # The tenant key is GONE: recruiter retrieval reads the candidate's
        # personal collection, which carries no organizationId at all, so a
        # tenant filter would have nothing to match against.
        assert "organizationId" not in fields
        assert "candidateId" not in fields

    def test_search_rejects_a_smuggled_organization_id(self):
        """extra="forbid" makes the removal enforceable, not just documented.

        A backend still sending the old tenant key fails loudly instead of
        having it silently ignored while retrieval quietly reads everything.
        """
        with pytest.raises(ValidationError):
            SearchRequest(
                candidateAccountIds=["acct-1"],
                query="kubernetes",
                organizationId="org-1",
            )


class TestAuthorizationStaysInTheBackend:
    """Every recruiter-facing request names its subject explicitly.

    The service answers about exactly the account(s)/vacancy it is given. It
    receives no membership, role or application data with which it could decide
    access — which is precisely why the backend must (and does) resolve the
    owned vacancy and the applicant association first.
    """

    def test_summary_is_account_scoped_and_vacancy_aware(self):
        fields = set(CandidateSummaryRequest.model_fields)
        assert "candidateAccountId" in fields
        assert "organizationId" not in fields
        # Vacancy grounding survives the cleanup untouched.
        assert "vacancy" in fields

    def test_interview_questions_require_the_vacancy_context(self):
        fields = set(InterviewQuestionsRequest.model_fields)
        assert {
            "candidateAccountId",
            "vacancyId",
            "requirements",
        } <= fields
        assert "organizationId" not in fields

    def test_evidence_mapping_is_per_account_and_vacancy(self):
        fields = set(EvidenceMapRequest.model_fields)
        assert {"candidateAccountId", "vacancyId", "requirements"} <= fields
        assert "organizationId" not in fields

    def test_ask_carries_no_authorization_input(self):
        fields = set(RagRequest.model_fields)
        assert {"candidateAccountIds", "vacancyId", "vacancy"} <= fields
        assert "organizationId" not in fields
        # No role, membership or ownership claim is accepted from the caller.
        assert fields & {"role", "userId", "memberships", "createdById"} == set()

    def test_the_authorized_universe_is_a_plain_list_of_account_ids(self):
        """It is an ANSWER, not a question.

        The backend resolves who the caller may read about and sends the
        result. Nothing in this payload lets the service widen that list, and
        an empty list is a valid answer meaning "nobody" — which is why it is
        not rejected as a validation error.
        """
        request = SearchRequest(candidateAccountIds=[], query="kubernetes")
        assert request.candidateAccountIds == []

"""The external-job index text: what goes into a vector, and what must not.

No Qdrant and no model — these are assertions about a pure function, because
the interesting decisions all live there. What a job's vector is BUILT from
determines what the semantic search can be influenced by, and the two things
that must never influence it (provenance, and anything a model guessed) are
absences that only a test can keep true.
"""

from __future__ import annotations

from app.candidate.external_jobs import build_index_text
from app.models.schemas import ExternalJobInput


def job(**over) -> ExternalJobInput:
    payload = {
        "externalJobId": "job-1",
        "status": "ACTIVE",
        "title": "Backend Engineer",
        "companyName": "Acme",
        "description": "Build and operate the services behind the product.",
        "countryCode": "KR",
        "region": None,
        "city": "Seoul",
        "workMode": "HYBRID",
        "employmentType": "FULL_TIME",
        "seniorityLevel": None,
    }
    payload.update(over)
    return ExternalJobInput(**payload)


class TestWhatTheVectorIsBuiltFrom:
    def test_title_comes_first(self):
        # The model truncates, so the most defining part has to survive.
        assert build_index_text(job()).startswith("Backend Engineer")

    def test_includes_company_place_and_stated_facts(self):
        text = build_index_text(job())
        assert "Acme" in text
        assert "Seoul" in text
        assert "KR" in text
        assert "hybrid" in text
        assert "full time" in text
        assert "services behind the product" in text

    def test_omits_what_the_employer_did_not_state(self):
        """A null is silence, and silence is written as nothing at all.

        The alternative — emitting "seniority: unknown" — would put the word
        into the vector and make every unstated job slightly similar to every
        query mentioning seniority.
        """
        text = build_index_text(
            job(seniorityLevel=None, workMode=None, employmentType=None)
        )
        assert "none" not in text.lower()
        assert "unknown" not in text.lower()
        assert "null" not in text.lower()

    def test_truncates_a_long_description(self):
        # Two bounds, both deliberate: the schema refuses anything over 20k
        # characters at the boundary, and the indexer keeps only the first
        # 1,200 of what it accepts — past the model's own token limit a longer
        # text is the same vector computed more slowly.
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            job(description="word " * 5000)

        text = build_index_text(job(description="word " * 4000))
        assert len(text) < 1500


class TestWhatIsDeliberatelyAbsent:
    def test_the_payload_cannot_carry_provenance(self):
        """Provider, trust and source count are not fields on the input.

        A job is not a better answer to a query because the company happens to
        use one ATS rather than another, or because this product observed it
        twice. The surest way to keep that true is for the index to be unable
        to know.
        """
        fields = set(ExternalJobInput.model_fields)
        for forbidden in (
            "provider",
            "sourceCount",
            "sourceTrust",
            "accessMethod",
            "canonicalUrl",
            "sourceKey",
        ):
            assert forbidden not in fields

    def test_rejects_an_unknown_field_outright(self):
        # extra="forbid" on the base model: a caller cannot smuggle a ranking
        # signal in by adding a key.
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ExternalJobInput(
                externalJobId="j",
                status="ACTIVE",
                title="Backend Engineer",
                provider="GREENHOUSE",
            )


class TestUnicode:
    def test_korean_stays_korean(self):
        """No transliteration step exists, and none should.

        The model is multilingual, so a Korean title is embedded as Korean and
        stays findable by a Korean query. Romanizing it here would produce a
        vector for a string no employer wrote and no candidate will type.
        """
        text = build_index_text(
            job(title="백엔드 개발자", city="서울", description="백엔드 서비스를 만듭니다.")
        )
        assert "백엔드 개발자" in text
        assert "서울" in text
        assert "baekend" not in text.lower()

    def test_handles_other_scripts_without_special_casing(self):
        for title in ["Développeur Full Stack", "財務担当", "Инженер-программист"]:
            assert title in build_index_text(job(title=title))


class TestDeterminism:
    def test_the_same_job_always_produces_the_same_text(self):
        # A vector that changed between two indexing passes would make search
        # results drift for no reason anybody could trace.
        assert build_index_text(job()) == build_index_text(job())

    def test_an_empty_optional_does_not_leave_a_dangling_separator(self):
        text = build_index_text(
            job(companyName=None, city=None, countryCode=None, region=None)
        )
        assert "\n\n" not in text
        assert not text.endswith("\n")

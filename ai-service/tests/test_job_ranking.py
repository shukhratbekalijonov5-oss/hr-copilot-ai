"""Every eligible vacancy gets ranked — the property the old design broke.

The pipeline this replaced asked the index for the top 32 chunks, grouped them
into ~30 vacancies, and truncated to 5. With 153 open vacancies, 148 were never
compared to the candidate at all, and "why is this job missing?" had no answer
because it had never been scored.

So these tests are mostly about COUNTS and ORDER rather than about any single
match being correct:

  * every eligible vacancy appears in the result;
  * ordering is strongest-first and stable enough to paginate;
  * a weak match stays in the list instead of being filtered away;
  * an exact title is not required for a job to rank;
  * only genuine eligibility removes a vacancy.

Everything is faked except the scoring itself: no vector store, no model.
"""

from __future__ import annotations

import pytest

from app.candidate.capability import (
    build_capability_profile,
    extract_skills,
    infer_role_families,
    normalize_skill,
)
from app.candidate.job_match import match_jobs
from app.candidate.ranking import (
    VacancyCandidate,
    rank_vacancies,
    tier_for,
)
from app.config import get_settings
from app.mapping.requirement_mapping import MappingThresholds
from app.models.schemas import (
    CandidateProfileInput,
    EvidenceHit,
    JobMatchRequest,
    ProfileExperienceInput,
)
from app.vectorstore.qdrant_store import SearchHit
from tests.fixtures.embedding import FakeEmbedder, embed


# --- fakes --------------------------------------------------------------------


class FakeResumeStore:
    def __init__(self, chunks: list[dict]):
        self.chunks = chunks
        self.list_chunk_limits: list[int] = []

    def search(self, *, candidate_account_id, query_vector, limit, allowed_source_ids=None):
        return [SearchHit(score=0.05, payload=c) for c in self.chunks[:limit]]

    def list_chunks(
        self, candidate_account_id, limit=12, allowed_source_ids=None, with_vectors=False
    ):
        self.list_chunk_limits.append(limit)
        chunks = self.chunks[:limit]
        if not with_vectors:
            return chunks
        return [{**c, "_vector": embed(c.get("text", ""))} for c in chunks]


class FakeVacancyStore:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.requested_ids: list[str] | None = None

    def search_open(self, *, query_vector, limit):
        return [SearchHit(score=0.5, payload=r) for r in self.rows[:limit]]

    def fetch_vacancies(self, vacancy_ids, *, with_vectors=True):
        self.requested_ids = list(vacancy_ids)
        wanted = set(vacancy_ids)
        out = []
        for row in self.rows:
            if row["vacancyId"] not in wanted:
                continue
            copy = dict(row)
            if with_vectors:
                copy["_vector"] = embed(
                    f"{copy.get('title', '')} {copy.get('text', '')}"
                )
            out.append(copy)
        return out


def chunk(text: str, index: int = 0, source: str = "resume.pdf", kind: str = "FILE") -> dict:
    return {
        "chunkId": f"c-{index}",
        "documentId": "doc-1" if kind == "FILE" else "link-1",
        "fileName": source,
        "sourceTitle": source,
        "sourceType": kind,
        "section": "experience",
        "pageNumber": 1,
        "chunkIndex": index,
        "text": text,
    }


def vacancy_row(vacancy_id: str, title: str, text: str, requirements=None) -> dict:
    return {
        "vacancyId": vacancy_id,
        "organizationId": "org-x",
        "status": "OPEN",
        "title": title,
        "text": text,
        "chunkIndex": 0,
        "requirements": requirements or [],
    }


def hits_for(text: str) -> list[EvidenceHit]:
    """Stand-in for the candidate's retrieved evidence."""
    return [
        EvidenceHit(
            chunkId="c-1",
            candidateId=None,
            documentId="doc-1",
            fileName="resume.pdf",
            section="experience",
            pageNumber=1,
            chunkIndex=0,
            text=text,
            retrievalScore=0.1,
        )
    ]


# --- candidate capability -----------------------------------------------------


class TestSkillNormalization:
    def test_node_and_node_js_are_the_same_technology(self):
        # The specific case named in the brief: these must not behave like two
        # unrelated skills.
        assert normalize_skill("Node") == normalize_skill("Node.js")
        assert normalize_skill("NodeJS") == "node.js"

    @pytest.mark.parametrize(
        "written,expected",
        [
            ("React.js", "react"),
            ("TypeScript", "typescript"),
            ("Postgres", "postgresql"),
            ("k8s", "kubernetes"),
            ("GitHub Actions", "ci/cd"),
            ("Next JS", "next.js"),
        ],
    )
    def test_common_spellings_normalize(self, written, expected):
        assert normalize_skill(written) == expected

    def test_an_unknown_technology_is_simply_unknown(self):
        # It costs recall in the lexical signal and nothing else. It must never
        # be guessed at — an invented skill is a false claim about a person.
        assert normalize_skill("Blorpscript") is None

    def test_word_boundaries_are_respected(self):
        assert "go" not in extract_skills("We are going to build something")
        assert "react" not in extract_skills("A chemical reaction occurred")

    def test_react_native_does_not_double_count_as_react(self):
        found = extract_skills("Built mobile apps with React Native.")
        assert "react native" in found
        assert "react" not in found


class TestRoleFamilies:
    def test_frontend_evidence_yields_frontend(self):
        families = infer_role_families({"react", "typescript", "css"}, [])
        assert "frontend" in families

    def test_backend_evidence_yields_backend(self):
        families = infer_role_families({"node.js", "postgresql", "rest"}, [])
        assert "backend" in families

    def test_both_yields_fullstack_as_a_CONSEQUENCE(self):
        families = infer_role_families(
            {"react", "typescript", "node.js", "postgresql"}, []
        )
        assert {"frontend", "backend", "fullstack"} <= families

    def test_a_stated_title_counts_even_without_matching_skills(self):
        families = infer_role_families(set(), ["Backend Developer"])
        assert "backend" in families

    def test_one_skill_is_not_enough_to_claim_a_family(self):
        # A passing mention of React does not make somebody a frontend
        # developer, and claiming it would be an invented capability.
        assert "frontend" not in infer_role_families({"react"}, [])


class TestCapabilityProfile:
    def test_reads_EVERY_chunk_not_just_the_first_few(self):
        chunks = [chunk(f"Worked with technology number {i}", i) for i in range(60)]
        chunks.append(chunk("Deployed with Kubernetes and Terraform.", 99))
        profile = build_capability_profile(
            profile=CandidateProfileInput(), chunks=chunks
        )
        # The Kubernetes mention is chunk 61 — beyond the old 8-chunk window.
        assert "kubernetes" in profile.skills

    def test_a_portfolio_adds_evidence_the_resume_never_had(self):
        resume = [chunk("Frontend work in React and TypeScript.", 0, "resume.pdf")]
        portfolio = [
            chunk("Ran Kubernetes clusters, wrote Helm charts.", 1, "portfolio.pdf")
        ]
        resume_only = build_capability_profile(
            profile=CandidateProfileInput(), chunks=resume
        )
        both = build_capability_profile(
            profile=CandidateProfileInput(), chunks=resume + portfolio
        )
        assert "kubernetes" not in resume_only.skills
        assert "kubernetes" in both.skills

    def test_every_skill_names_the_source_it_came_from(self):
        profile = build_capability_profile(
            profile=CandidateProfileInput(),
            chunks=[chunk("Built APIs with NestJS.", 0, "portfolio.pdf")],
        )
        assert profile.skill_evidence["nestjs"].sources == frozenset(
            {"portfolio.pdf"}
        )

    def test_a_full_stack_candidate_gets_a_probe_per_family(self):
        chunks = [
            chunk("React and Next.js interfaces with TypeScript.", 0),
            chunk("Node.js and NestJS services over PostgreSQL.", 1),
        ]
        profile = build_capability_profile(
            profile=CandidateProfileInput(headline="Full Stack Developer"),
            chunks=chunks,
        )
        # One general probe plus a frontend and a backend one. A SINGLE vector
        # for this person sits between the two and matches neither well — which
        # is what made every result come back "Backend Engineer".
        assert len(profile.probes) >= 3
        joined = " ".join(profile.probes).lower()
        assert "react" in joined
        assert "node.js" in joined

    def test_nothing_is_invented_from_an_empty_profile(self):
        profile = build_capability_profile(
            profile=CandidateProfileInput(), chunks=[]
        )
        assert profile.skills == set()
        assert profile.role_families == set()


# --- ranking ------------------------------------------------------------------


def rank(vacancies, capability, evidence_text="React Node.js PostgreSQL Docker"):
    return rank_vacancies(
        capability=capability,
        vacancies=vacancies,
        evidence_hits_for=lambda text: hits_for(evidence_text),
        thresholds=MappingThresholds(),
        max_requirements=12,
    )


def fullstack_capability():
    return build_capability_profile(
        profile=CandidateProfileInput(headline="Full Stack Developer"),
        chunks=[
            chunk("React, Next.js and TypeScript interfaces.", 0),
            chunk("Node.js, NestJS, GraphQL and PostgreSQL services.", 1),
        ],
    )


class TestRankingCoversEverything:
    def test_every_vacancy_receives_a_rank(self):
        vacancies = [
            VacancyCandidate(f"v{i}", "org", f"Role {i}", texts=["work"])
            for i in range(50)
        ]
        ranked = rank(vacancies, fullstack_capability())
        assert len(ranked) == 50
        assert {r.vacancy.vacancy_id for r in ranked} == {
            f"v{i}" for i in range(50)
        }

    def test_a_weak_match_stays_in_the_list(self):
        strong = VacancyCandidate(
            "v-strong", "org", "React Developer",
            texts=["React, Next.js, TypeScript"],
            requirements=[{"text": "React", "required": True}],
        )
        weak = VacancyCandidate(
            "v-weak", "org", "Veterinary Nurse",
            texts=["Animal care, surgical assistance"],
            requirements=[{"text": "Veterinary nursing diploma", "required": True}],
        )
        ranked = rank([strong, weak], fullstack_capability())

        ids = [r.vacancy.vacancy_id for r in ranked]
        assert ids == ["v-strong", "v-weak"]      # ordered strongest first
        assert "v-weak" in ids                     # and NOT filtered away
        assert ranked[-1].tier == "WEAK"

    def test_stronger_sorts_above_weaker(self):
        ranked = rank(
            [
                VacancyCandidate("v-far", "org", "Chef", texts=["Menu planning"]),
                VacancyCandidate(
                    "v-near", "org", "Backend Engineer",
                    texts=["Node.js, NestJS, PostgreSQL, GraphQL"],
                ),
            ],
            fullstack_capability(),
        )
        assert ranked[0].vacancy.vacancy_id == "v-near"
        assert ranked[0].score > ranked[-1].score

    def test_an_exact_title_is_not_required_to_rank_well(self):
        # The brief's case: a Full Stack Developer must still be evaluated
        # highly for Frontend and Backend roles whose titles say neither.
        capability = fullstack_capability()
        ranked = rank(
            [
                VacancyCandidate(
                    "v-fe", "org", "React Developer",
                    texts=["React, Next.js, TypeScript, Redux"],
                ),
                VacancyCandidate(
                    "v-be", "org", "Node.js Developer",
                    texts=["Node.js, NestJS, PostgreSQL, GraphQL"],
                ),
                VacancyCandidate(
                    "v-none", "org", "Warehouse Supervisor",
                    texts=["Stock control and forklift operation"],
                ),
            ],
            capability,
        )
        by_id = {r.vacancy.vacancy_id: r for r in ranked}
        assert by_id["v-fe"].score > by_id["v-none"].score
        assert by_id["v-be"].score > by_id["v-none"].score

    def test_a_different_title_never_removes_a_vacancy(self):
        ranked = rank(
            [VacancyCandidate("v1", "org", "Backend Engineer", texts=["Node.js"])],
            build_capability_profile(
                profile=CandidateProfileInput(headline="Full Stack Developer"),
                chunks=[chunk("React and Node.js work.", 0)],
            ),
        )
        assert len(ranked) == 1
        assert ranked[0].signals["roleFamily"] > 0

    def test_skill_overlap_moves_the_ranking(self):
        capability = fullstack_capability()
        overlapping = VacancyCandidate(
            "v-overlap", "org", "Engineer",
            texts=["React, Node.js, PostgreSQL, GraphQL, TypeScript"],
        )
        disjoint = VacancyCandidate(
            "v-disjoint", "org", "Engineer",
            texts=["COBOL, Fortran, mainframe batch processing"],
        )
        ranked = {r.vacancy.vacancy_id: r for r in rank(
            [overlapping, disjoint], capability
        )}
        assert ranked["v-overlap"].signals["skills"] > ranked["v-disjoint"].signals["skills"]
        assert ranked["v-overlap"].score > ranked["v-disjoint"].score


class TestOrderingIsStable:
    def test_ties_break_deterministically(self):
        # Pagination slices this list, so two vacancies on the same score must
        # not swap places between page 1 and page 2.
        vacancies = [
            VacancyCandidate(f"v{i:02d}", "org", "Identical Role", texts=["same"])
            for i in range(20)
        ]
        first = [r.vacancy.vacancy_id for r in rank(vacancies, fullstack_capability())]
        second = [
            r.vacancy.vacancy_id
            for r in rank(list(reversed(vacancies)), fullstack_capability())
        ]
        assert first == second
        assert first == sorted(first)  # the tiebreak is the vacancy id

    def test_scores_never_leave_the_scale(self):
        ranked = rank(
            [VacancyCandidate("v1", "org", "Role", texts=["x"])],
            fullstack_capability(),
        )
        assert 0 <= ranked[0].score <= 100
        assert ranked[0].tier == tier_for(ranked[0].score) or ranked[0].tier == "WEAK"


# --- the whole pipeline -------------------------------------------------------


class TestPipelineReturnsEverything:
    def test_fifty_eligible_vacancies_all_come_back_ranked(self):
        """The headline requirement: 50 eligible in, 50 ranked out."""
        rows = [
            vacancy_row(
                f"v{i:03d}",
                "Backend Engineer" if i % 2 else "Frontend Engineer",
                "Node.js and React work",
                [{"text": "JavaScript", "required": True}],
            )
            for i in range(50)
        ]
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Full Stack Developer"),
                eligibleVacancyIds=[r["vacancyId"] for r in rows],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore(
                [chunk("React, Node.js, TypeScript and PostgreSQL.", 0)]
            ),
            vacancy_store=FakeVacancyStore(rows),
            reranker=None,
            generator=None,
        )
        assert len(response.matches) == 50
        assert response.eligibleConsidered == 50
        # Ranks are 1..50 with no gaps and no repeats.
        assert [m.rank for m in response.matches] == list(range(1, 51))

    def test_no_hidden_top_k_between_eligible_and_ranked(self):
        rows = [vacancy_row(f"v{i:03d}", "Engineer", "work") for i in range(120)]
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                eligibleVacancyIds=[r["vacancyId"] for r in rows],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("Node.js work.", 0)]),
            vacancy_store=FakeVacancyStore(rows),
            reranker=None,
            generator=None,
        )
        assert len(response.matches) == 120

    def test_the_caller_decides_the_universe_not_a_vector_search(self):
        rows = [vacancy_row(f"v{i}", "Engineer", "work") for i in range(10)]
        store = FakeVacancyStore(rows)
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                # Only three are eligible. The other seven are indexed and must
                # NOT appear — the index is not the authority on what exists.
                eligibleVacancyIds=["v1", "v3", "v5"],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("Node.js work.", 0)]),
            vacancy_store=store,
            reranker=None,
            generator=None,
        )
        assert store.requested_ids == ["v1", "v3", "v5"]
        assert {m.vacancyId for m in response.matches} == {"v1", "v3", "v5"}

    def test_reads_the_whole_evidence_set_not_a_window(self):
        store = FakeResumeStore([chunk(f"text {i}", i) for i in range(60)])
        match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                eligibleVacancyIds=["v1"],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=store,
            vacancy_store=FakeVacancyStore([vacancy_row("v1", "Engineer", "work")]),
            reranker=None,
            generator=None,
        )
        # The old pipeline asked for 8. Anything that small silently discards
        # most of a portfolio.
        assert store.list_chunk_limits[0] >= 100

    def test_capability_is_reported_for_honest_diagnostics(self):
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Full Stack Developer"),
                eligibleVacancyIds=["v1"],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore(
                [chunk("React and Node.js.", 0, "portfolio.pdf")]
            ),
            vacancy_store=FakeVacancyStore([vacancy_row("v1", "Engineer", "work")]),
            reranker=None,
            generator=None,
        )
        capability = response.capability
        assert "portfolio.pdf" in capability["evidenceSources"]
        assert "react" in capability["skills"]

    def test_an_eligible_vacancy_missing_from_the_index_is_not_an_error(self):
        # The index lags the database: a vacancy created seconds ago is not
        # indexed yet. It is absent from the ranking, and the counts say so.
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                eligibleVacancyIds=["v1", "v-not-indexed"],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("Node.js work.", 0)]),
            vacancy_store=FakeVacancyStore([vacancy_row("v1", "Engineer", "work")]),
            reranker=None,
            generator=None,
        )
        assert len(response.matches) == 1
        assert response.eligibleConsidered == 2
        assert response.vacanciesConsidered == 1


class TestGenerationCannotTruncate:
    def test_ranking_is_complete_even_with_no_generator(self):
        rows = [vacancy_row(f"v{i:03d}", "Engineer", "work") for i in range(30)]
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                eligibleVacancyIds=[r["vacancyId"] for r in rows],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("Node.js work.", 0)]),
            vacancy_store=FakeVacancyStore(rows),
            reranker=None,
            generator=None,
        )
        assert len(response.matches) == 30
        assert response.generated is False

    def test_explaining_a_window_does_not_shorten_the_list(self):
        """The model writes prose for a page; it does not decide the count."""

        class WindowGenerator:
            enabled = True

            def generate_match_explanations(self, *, context, vacancy_ids, locale):
                # Deliberately answers about fewer jobs than it was asked about.
                return {vacancy_ids[0]: "only one"}

        rows = [vacancy_row(f"v{i:03d}", "Engineer", "work") for i in range(30)]
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Engineer"),
                eligibleVacancyIds=[r["vacancyId"] for r in rows],
                explainLimit=5,
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("Node.js work.", 0)]),
            vacancy_store=FakeVacancyStore(rows),
            reranker=None,
            generator=WindowGenerator(),
        )
        assert len(response.matches) == 30          # all of them, still
        explained = [m for m in response.matches if m.explanation]
        assert len(explained) == 1                   # only the model's answer
        assert all(m.rank for m in response.matches)


class TestEvidenceGate:
    def test_no_surviving_evidence_ranks_nothing(self):
        response = match_jobs(
            request=JobMatchRequest(
                candidateAccountId="acct-1",
                profile=CandidateProfileInput(headline="Senior Engineer"),
                eligibleVacancyIds=["v1"],
                allowedSourceIds=[],
            ),
            settings=get_settings(),
            embedder=FakeEmbedder(),
            resume_store=FakeResumeStore([chunk("React work.", 0)]),
            vacancy_store=FakeVacancyStore([vacancy_row("v1", "Engineer", "work")]),
            reranker=None,
            generator=None,
        )
        assert response.matches == []

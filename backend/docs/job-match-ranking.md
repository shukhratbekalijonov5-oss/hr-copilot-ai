# Candidate AI Job Search — ranking every eligible vacancy

## The failure this design replaced

A candidate with 153 open vacancies available to them received **about two
matches**. Measured, stage by stage, before any code changed:

| stage | count |
|---|---|
| eligible vacancies (`status = OPEN`) | **153** |
| indexed as OPEN in `vacancy_chunks_v1` | 391 — of which **238 were stale ghosts** |
| retrieval: `search_open(limit = match_vacancy_pool = 32)` | 32 **chunks** |
| grouped into vacancies | 30 |
| after rerank | 30 |
| `top = ordered[:request.limit]` (default 5, schema max 10) | **5** |
| backend re-verified `status = OPEN` | **3 of 5** survived |
| observed in the product | **~2** |

Four separate defects, each sufficient on its own:

1. **A top-K search decided the universe.** 148 of 153 vacancies were never
   compared to the candidate at all. "Why is this job missing?" had no answer,
   because it had never been scored.
2. **`limit` truncated before ranking.** The schema capped it at 10. The result
   count was a property of a vector search, not a decision the application made.
3. **The index was the authority, and it drifts.** A cascade-deleted
   organization leaves its vacancies' points behind, so 60% of the top 5 were
   vacancies that no longer existed — and they were dropped *after* occupying
   the only slots available.
4. **The candidate was one 1600-character blob**, built from their profile plus
   the first 8 chunks Qdrant happened to return. For a job seeker whose real
   evidence is a 20-page portfolio, ~15% of what they had shown the system ever
   reached the query — and one averaged vector put a genuinely full-stack person
   between frontend and backend, matching neither well. Every single result came
   back titled "Backend Engineer".

## The pipeline now

```
candidate profile + ALL indexed personal evidence
        → capability profile   (skills, role families, several probe texts)
        → one embedding per probe
        → EVERY eligible vacancy, fetched by id from the backend's list
        → five-signal scoring of all of them
        → deterministic ranking, strongest to weakest
        → stored snapshot
        → the application pages through it
```

After, for the same candidate:

| stage | count |
|---|---|
| eligible (`status = OPEN`) | 153 |
| fetched from the index and scored | 153 |
| **ranked and returned** | **153** |
| retrievable by the UI across 8 pages | 153 |

Warm ranking of 153 vacancies takes **~2 s**; cold (first request after a
restart) ~13 s.

---

## 1. The candidate capability profile

`ai-service/app/candidate/capability.py`. Built from the profile fields **and
every indexed chunk** — files and links alike.

* **probes** — several texts, each embedded separately. One general probe plus
  one per role family the evidence supports. This is the fix for "every match
  was a Backend Engineer": a single vector for a full-stack candidate sits
  between frontend and backend and matches neither, while a probe per family
  sits squarely in each.
* **skills** — normalized through an alias lexicon, so `Node`, `Node.js` and
  `NodeJS` stop behaving like three unrelated technologies.
* **role families** — frontend / backend / fullstack / mobile / devops / data,
  inferred from a stated title OR from ≥2 demonstrated skills. `fullstack` is
  derived from holding both frontend and backend evidence; it is never a claim
  of its own.
* **provenance** — every skill records which source it was found in.

**Nothing is invented.** Every skill appears verbatim (or as a known alias) in
text the candidate submitted. There is no code path that produces a capability
without evidence behind it, and no LLM is involved in extraction.

An unknown technology is simply unknown: it costs recall in the lexical signal
and nothing else. Guessing would be a false claim about a real person.

## 2. The eligible universe

`JobMatchRankingService.eligibleVacancyIds()` — every `status = OPEN` vacancy,
**from the database**. The ids are sent to the AI service, which fetches and
scores exactly those.

The vector index is an accelerator and never the authority. That is what makes
a stale point unreachable rather than merely unlikely.

`fetch_vacancies` is a **scroll, not a search**: "give me exactly these", not
"which look closest?".

### Self-healing

An eligible vacancy missing from the index cannot be ranked. Rather than drop it
silently, the run logs the gap and queues a re-index (bounded to 25 per run), so
the next ranking includes it. Observed live: **148 → 153 of 153** on the
following run.

## 3. Scoring

`ai-service/app/candidate/ranking.py`. Five weighted signals, each reading a
different view of the evidence so nothing is counted twice:

| signal | weight | answers |
|---|---|---|
| `semantic` | 0.34 | does the evidence read like this job, as a whole? |
| `required` | 0.26 | are the MUST-have requirements demonstrated? |
| `preferred` | 0.10 | are the nice-to-haves demonstrated? |
| `skills` | 0.18 | do the concrete technologies overlap? |
| `roleFamily` | 0.12 | is this the kind of work the candidate does? |

`semantic` is the best cosine against **any** probe, not the average — averaging
a frontend probe against a backend probe drags both down and is what made a
full-stack candidate look mediocre at everything.

**Score is 0–100 and exists to ORDER the list.** It is not a probability of
being hired, not a percentage of the job the person can do, and must never be
presented as either.

### Tiers

`STRONG` / `PARTIAL` / `WEAK` — the three labels the product already ships and
localizes, rather than a new four-label vocabulary that would need new copy in
four languages. The tier is **derived from the score**, so the two cannot
disagree, with one override:

* **The coverage floor.** A vacancy states requirements and the evidence
  demonstrates *none* of them → `WEAK`, however similar the text reads. The job
  still ranks and still appears; it is the label that is held honest.

### Hard filters vs ranking signals

The **only** thing that removes a vacancy is eligibility (`status = OPEN`).
Title wording, partial skill overlap, seniority and role family are all ranking
signals — a family mismatch costs at most 0.12 of the score and can never
delete a job. This is the specific rule that used to lose a "Full Stack
Developer" their Backend Engineer matches.

## 4. Ranking, storage and pagination

Ordering is `(-score, vacancyId)`. The tiebreak is load-bearing: pagination
slices this list, so two vacancies on the same score must not swap places
between page 1 and page 2.

The full ranking is stored — `CandidateJobMatchRun` + `CandidateJobMatchEntry`
— and pages are `LIMIT/OFFSET` over it. **Pagination means "the next slice of
the ranking you already have"**, never a fresh search: recomputing per page
could move a vacancy across a boundary and show it twice or not at all.

Verified live: 153 ranked, 8 pages of 20, ranks 1…153 with no gaps and no
repeats, and re-reading a page returns the identical slice.

## 5. Recomputation

A stored ranking is reused only while **both** inputs are unchanged:

| input | how it is detected |
|---|---|
| candidate evidence | `CandidateAccount.evidenceRevision` (files, links, refreshes) |
| vacancy catalogue | `vacancyFingerprint` = count of OPEN + latest `updatedAt` |
| candidate profile | explicit `ranking.invalidate()` on profile update |

No event wiring is needed for vacancies: opening, editing or closing one moves
the fingerprint.

## 6. Where generation is, and is not

Gemini writes **explanation prose and nothing else**. It is told the label; it
is never asked how many jobs exist. The application owns the count.

* The initial run explains the first page inside the ranking call.
* A later page calls `/internal/candidate/match-explanations` — the facts only,
  no documents — and **does not block on it**. One batched call for twenty
  matches measured 11–44 s live, and a "show more" click that stalls that long
  is worse than a card showing its deterministic reason immediately. The page
  is served after a short wait, prose is written in the background, and a
  revisit has it (measured: 3.1 s first visit → **0.1 s with 20/20 prose** on
  revisit).
* `explanationsPending` distinguishes "still being written" from
  "unavailable" — they look identical on a card and mean opposite things.

Explanations are stored **per locale on one ranking row**
(`{ "en": …, "ko": … }`), never as four parallel rankings: the ranking compares
evidence to requirements and is locale-independent, so four copies could only
drift apart.

## 7. Performance

Ranking 153 vacancies involves 182 distinct requirements. The obvious
implementation — embed each and run a Qdrant search per requirement — measured
**350 seconds**, most of it a cross-encoder pass over a handful of passages.

The candidate's whole evidence set is ~50 vectors, so it is loaded once (with
vectors) and every requirement is embedded in **one batched call** and compared
in process. Exact, and orders of magnitude cheaper: **350 s → ~2 s**.

One subtlety that cost a real bug: `classify_requirement` compares a hit's
retrieval score against `mapping_semantic_review` (0.30), a threshold
calibrated against Qdrant's **raw** cosine. Rescaling to [0, 1] with
`(cos + 1) / 2` — which looks harmless — puts every non-opposite pair above 0.5
and escalates essentially every requirement to `NEEDS_HUMAN_REVIEW`, quietly
inflating every score. Raw cosine is used for evidence scores; the rescale
happens only where a 0–1 weighting scale is genuinely needed.

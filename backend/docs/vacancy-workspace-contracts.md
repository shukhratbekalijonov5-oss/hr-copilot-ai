# Vacancy-Scoped HR Workspace — API contracts for the frontend

Written for the frontend session so the backend never has to be reverse
engineered. Everything below is live behaviour, covered by unit + e2e tests.
Base path: `/api`. Candidate-side behaviour is UNCHANGED unless explicitly
noted.

## 0. The product rule

HR users work inside vacancies **they personally created**:

    SELECT ONE OF MY VACANCIES FIRST → THEN WORK INSIDE THAT VACANCY.

Backend-enforced, on every request (never trust the client selection):

    vacancy.organizationId === active organization   (else 404 — nondisclosure)
    vacancy.createdById    === authenticated user    (else 403 VACANCY_NOT_OWNED)

- There is **no server-side "selected vacancy" state**: the client passes
  `vacancyId` explicitly wherever it matters and the backend re-validates it
  every time. Switching vacancy = simply sending the other id; nothing is
  cached across vacancies server-side (the only persisted derived artifact,
  the JD evidence map, is keyed by `(candidate, vacancy, requirement)`).
- The org-wide vacancy CATALOG (`GET /vacancies`, `GET /vacancies/:id`,
  `GET /vacancies/:id/requirements`) stays readable by every member; only
  *working inside* a vacancy is creator-scoped.
- There is **no vacancy-count cap** — an HR user may create unlimited
  vacancies (only generic request throttling applies).

### Error codes (localize on `code`, like AUTH_* / document codes)

| Code | Status | When |
|---|---|---|
| `VACANCY_NOT_OWNED` | 403 | Same-org vacancy created by another HR user. |
| `CANDIDATE_NOT_IN_VACANCY` | 403 | Candidate not associated with the selected vacancy (Compare/JD-evidence/Summary/Questions/Ask). |
| plain 404 | 404 | Foreign-org / unknown vacancy; ANY conversation not owned (conversations were never org-browsable, so a colleague's conversation id is indistinguishable from a non-existent one). |

## 1. My Vacancies — the selector source

```
GET /vacancies/mine?page&limit&status&search
→ { data: [{ id, title, status, createdAt,
             candidateCount, requirementCount }], meta }
```

Only the caller's own vacancies in the active org, newest first. Slim rows —
render the selector directly from this. Candidate accounts get 403.

The vacancy list page should render each row as
`[ Select ] Vacancy Title …` / selected: `[ ✓ Selected ] Vacancy Title …`;
the selected id then drives Candidates, Candidate Detail, Compare, AI
Search, Processing filtering and HR Interview Chats. Keep the selected id in
client state (URL/query param recommended); the backend re-validates it on
every call, so a stale selection degrades to 403/404, never to wrong data.

## 2. Vacancy mutations (BREAKING: creator-only)

`PATCH /vacancies/:id`, `PATCH /vacancies/:id/close`,
`PATCH /vacancies/:id/archive`, `DELETE /vacancies/:id`, and all
requirement mutations (`POST/PATCH/DELETE /vacancies/:id/requirements*`)
now require the caller to be the creator → 403 `VACANCY_NOT_OWNED` for a
same-org colleague's vacancy. Hide edit/close/delete controls on vacancies
not in `/vacancies/mine`.

### Bulk delete

```
POST /vacancies/bulk-delete   { vacancyIds: string[] }   (1..50 ids)
→ 200 { deletedIds: string[], deletedCount: number }
```

- ALL-OR-NOTHING: one foreign id → 404, one colleague-owned id → 403, and
  **nothing** is deleted.
- Frontend confirmation is a plain No/Yes dialog ("Are you sure you want to
  delete the selected vacancy/vacancies?"); send the request only on Yes.
  Single delete may use `DELETE /vacancies/:id` or a one-element bulk call.
- Delete ≠ close. CLOSE keeps the record and purges chats; DELETE removes
  the vacancy and everything hanging off it. Both purge every conversation +
  message of the vacancy in the same transaction (chat lifecycle preserved).

## 3. Candidates — vacancy-scoped

### List (the Candidates page under a selection)

```
GET /vacancies/:vacancyId/candidates?page&limit&search&status
→ { data: [{
     candidate: { id, fullName, email, phone, location, currentTitle,
                  totalExperienceYears, documentCount, evidenceCount },
     application: { id, status, createdAt }
   }], meta }
```

- Owned vacancy required (403/404 as above).
- These are the vacancy's **applicants** — people who applied to it
  themselves. There is no source or account label because there is no
  variation left to label. `application.status` is the stage **within this
  vacancy**; the same person can apply to several vacancies and carry
  independent stages in each.
- `GET /candidates` / `GET /candidates/:id` remain org-wide for
  candidate-GLOBAL data (profile fields, documents list), filtered to
  applicants. Candidate Detail should load global data from there and
  everything vacancy-dependent with the selected vacancyId (see §5).

### Adding candidates: REMOVED

`POST /candidates` and `POST /applications` **no longer exist** (404). HR
cannot create a candidate, and cannot attach an existing one to a vacancy.
The only way a person enters a pipeline is by applying:

```
POST /public/jobs/:publicSlug/apply     (authenticated CandidateAccount)
→ 201 { id, status, source: "DIRECT", ... }   already applied → 409
```

Application status changes / invite / delete remain creator-only
(`PATCH /applications/:id/status`, `POST /applications/:id/invite-interview`,
`DELETE /applications/:id`), and every one of them resolves the application
under the applicant scope — a historical recruiter-made association answers
404 like any unknown id.

## 4. Compare

Compare keeps its composition (vacancy + candidates + evidence maps) but is
now vacancy-first end to end:

1. Pick the vacancy from `GET /vacancies/mine`.
2. Get the compare-eligible set from `GET /vacancies/:id/candidates`
   (its applicants; do NOT use the org-wide `GET /candidates` list as the
   picker).
3. Per candidate: `GET|POST /candidates/:candidateId/vacancies/:vacancyId/evidence-map`
   — both now require the OWNED vacancy and the candidate to be IN it
   (403 `CANDIDATE_NOT_IN_VACANCY` otherwise).

Evidence stays organization-scoped (`resume_chunks`); candidates' private
personal indexes are physically separate and unreachable from every
recruiter surface.

## 5. Candidate Detail

Split state in two:

- **Candidate-global** (loads independently of selection, stable across
  vacancy switches): `GET /candidates/:id` (profile, documents,
  applications list), document preview/download.
- **Vacancy-dependent** (require the selected OWNED `vacancyId`; clear and
  re-fetch exactly these when the selection changes):

| Surface | Call | Notes |
|---|---|---|
| Overview (stage in THIS vacancy) | `GET /vacancies/:vacancyId/candidates` row, or `GET /applications?vacancyId&candidateId` | `application.status/source` are per-vacancy. |
| JD Evidence | `GET/POST /candidates/:cid/vacancies/:vid/evidence-map` | Stored per (candidate, vacancy, requirement) — A's map is never served under B. |
| AI Summary (BREAKING) | `POST /ai/candidates/:cid/summary` body `{ vacancyId, locale? }` | `vacancyId` now REQUIRED; the summary answers "how does the evidence relate to THIS vacancy" and is grounded in its title+requirements. |
| Interview Questions | `POST /ai/candidates/:cid/vacancies/:vid/interview-questions` | Unchanged route; now creator+association-checked. |
| Ask (BREAKING) | `POST /ai/answer` `{ query, candidateId, vacancyId, locale?, limit? }` | `vacancyId` REQUIRED whenever `candidateId` is present; the selected vacancy's title/requirements are added to the generation context. |

Locale precedence is unchanged (explicit → preferredLocale → 'en'); vacancy
selection never changes language. Nothing AI-generated is cached
server-side, so switching A→B cannot serve stale content; the frontend only
needs to clear its own client-side caches keyed WITHOUT vacancyId (key all
vacancy-dependent queries by `[candidateId, vacancyId, locale]`).

## 6. AI Search

- `POST /search/evidence` accepts optional `vacancyId` (must be OWNED):
  results are then restricted to candidates associated with that vacancy.
  Omitting it keeps today's org-wide search.
- `POST /ai/answer` without `candidateId`: `vacancyId` optional; when
  present it must be owned and is used as generation context.
- Results only ever contain the organization's own APPLICANTS: every
  org-side document is an apply-time snapshot, and hits whose candidate is
  not an applicant are dropped. There is no "add to pipeline" action — a
  result already belongs to somebody who applied.

## 7. Processing

`GET /processing-jobs?vacancyId=...` (owned) filters to jobs whose DOCUMENT
belongs to a candidate associated with the selected vacancy. Notes:

- Processing stays document-centric: one document = one job, shared by every
  vacancy its candidate joins — the filter selects, never duplicates.
- Jobs for documents with no candidate link are only visible in the
  unfiltered org view; keep an "All (organization)" mode for lawful
  monitoring. There is no upload entry point anywhere in the HR product;
  every document being processed is an applicant's own submission, so
  Processing is monitoring only.

## 8. HR Interview Chats (BREAKING for same-org visibility)

- `GET /conversations` now returns ONLY conversations of vacancies the
  caller created — with or without the `vacancyId` filter. Passing
  `vacancyId` additionally validates ownership (403/404) so the UI gets an
  honest error instead of an empty list.
- `GET /conversations/:id(/messages)`, `POST /conversations/:id/messages`
  and the socket `conversation.join`/`message.send` all require the caller
  to be the vacancy's creator; anyone else — INCLUDING same-org members —
  gets 404 / NOT_FOUND acks.
- Recommended flow: select My Vacancy → `GET /conversations?vacancyId=…` →
  changing the selection clears the open conversation panel.
- There is no unread counter in the API today (nothing changed there).

**Candidate side is unchanged**: `GET /candidate-account/me/conversations`
lists the candidate's own chats directly, each row carrying
`vacancy: { publicSlug, title, status, organization: { name } }` for the
card — no vacancy selector, ever.

Lifecycle guarantees are untouched and extend to bulk delete: reject →
that pair's conversation purged; application delete → same; close/archive →
all of the vacancy's conversations purged in the same transaction; delete
(single or bulk) → same purge through the same service.

## 9. Interview invites

`POST /applications/:id/invite-interview` requires the vacancy's creator
(403 otherwise) and always returns a `conversation`: every applicant owns
the CandidateAccount they applied with, so the old
`chatAvailable`/`chatUnavailableReason: "NO_CANDIDATE_ACCOUNT"` fields are
gone with the accountless candidates they described.

## 10. What did NOT change

- Candidate Job Match, personal documents (3-file/50MB policy), public job
  board, applying, saved jobs, auth/identity — untouched.
- Recruiter evidence isolation: org collection only, personal collection
  never queried recruiter-side.
- `GET /applications*` reads stay org-scoped (pipeline visibility for
  colleagues); only MUTATIONS are creator-scoped.

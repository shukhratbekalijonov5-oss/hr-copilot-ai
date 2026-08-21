# Identity & Candidate Platform — API contracts for the frontend

Written for the frontend session so the backend never has to be reverse
engineered. Everything below is live behaviour, covered by unit + e2e tests.
Base path: `/api`. Auth stays bearer-token based (the Next.js layer keeps
storing tokens in httpOnly cookies and forwarding the access token as
`Authorization: Bearer`); the contract is transport-neutral so a future
mobile app can store the same credentials in secure storage.

## 0. Sessions & refresh tokens (NEW — action required in the web layer)

Access tokens now live **15 minutes**; a login/registration additionally
returns a **refresh token** backed by a server-side session (30-day absolute
lifetime). The web layer must store BOTH (separate httpOnly cookies) and
refresh when the access token expires.

```
POST /auth/login | /auth/register   -> { accessToken, refreshToken, user{...} }
POST /auth/refresh {refreshToken}   -> { accessToken, refreshToken, user{...} }   (rotated!)
POST /auth/logout                    (bearer) -> revokes THIS session only
POST /auth/logout-all                (bearer) -> revokes every session
GET  /auth/sessions                  (bearer) -> [{id, createdAt, lastUsedAt,
                                                  expiresAt, userAgent,
                                                  deviceName, current}]
DELETE /auth/sessions/:id            (bearer) -> remote sign-out of one OWN
                                                 session (foreign ids: 404)
```

Rules the client MUST follow:

- **Every refresh rotates the token.** Persist the returned `refreshToken`
  and discard the old one. Reusing an old refresh token is treated as theft:
  the whole session is revoked (`401 AUTH_REFRESH_TOKEN_REUSED`) and the user
  must log in again. **Serialize refreshes** — never fire two concurrent
  refreshes with the same token.
- Rotation never extends the 30-day session lifetime; after it, re-login.
- `POST /auth/switch-organization` does NOT touch the refresh token. It
  persists the workspace on the session, so tokens minted by later refreshes
  keep pointing at the switched organization.
- If the active organization's membership was revoked, refresh still succeeds
  but degrades to an organization-less token (`user.role: null`) — show the
  workspace picker.
- Login/register/refresh accept optional `deviceName` (login/register body)
  and record the `User-Agent` for the sessions list.
- Auth failures carry stable machine-readable codes for localization
  (en/ko/ru/uz): `AUTH_INVALID_REFRESH_TOKEN`, `AUTH_REFRESH_TOKEN_EXPIRED`,
  `AUTH_REFRESH_TOKEN_REUSED`, `AUTH_SESSION_REVOKED`,
  `AUTH_SESSION_NOT_FOUND`. Localize on `code`, never on `message`.

## 1. The identity model — two EXCLUSIVE account types

```
User (email, fullName, preferredLocale, accountType: CANDIDATE | ORGANIZATION)
├── if CANDIDATE:    CandidateAccount (exactly 1, created at signup)
└── if ORGANIZATION: OrganizationMember (1..n) — one row per organization,
                     each with its own role
```

- **One email is exactly one account type, forever.** A CANDIDATE can never
  hold an organization membership; an ORGANIZATION account can never own a
  candidate profile. There is no workspace switching between the two sides —
  the old dual-identity model (one user as both) is gone. Multi-organization
  membership REMAINS fully supported within the ORGANIZATION type.
- The invariant is enforced centrally in the backend (registration, candidate
  account creation, invitations, and both scoped guards re-check the live
  `accountType` row), not by frontend routing.
- Roles (`OWNER | HR_ADMIN | RECRUITER | INTERVIEWER`) exist ONLY on
  memberships. There is no global role, no CANDIDATE role, no EMPLOYEE role.
- The JWT is unchanged: it identifies the user and carries an `org` claim
  naming the ACTIVE organization. It never carries a role **or the account
  type** — both are re-derived from the database on every scoped request, so a
  removed/demoted member (or an invariant breach) changes behaviour on the
  next request even with an old token. Response BODIES carry `accountType`
  for client-side routing.
- `preferredLocale` is one of `en | ko | ru | uz` (default `en`).

### Account-type error codes

| Code | Status | When |
|---|---|---|
| `AUTH_EMAIL_ALREADY_REGISTERED` | 409 | Registration with an email that already has an account of the SAME type. |
| `AUTH_ACCOUNT_TYPE_CONFLICT` | 409 | Registration or invitation touching an email that belongs to the OTHER type. |
| `AUTH_ACCOUNT_TYPE_MISMATCH` | 403 | Correct credentials through the wrong sign-in door, or an authenticated request hitting the other side's endpoints. Never returned before password verification — login with bad credentials stays a flat 401. |

## 2. Breaking / changed contracts (delta from the dual-identity backend)

| Endpoint | What changed |
|---|---|
| `POST /auth/register` | **REMOVED.** Replaced by the two type-explicit endpoints below (§5). |
| `POST /auth/register/candidate` | NEW. `{fullName, email, password, preferredLocale?, deviceName?}` → User (CANDIDATE) **+ CandidateAccount**, in one transaction. Never creates an organization or membership. |
| `POST /auth/register/organization` | NEW. `{organizationName, organizationSlug, fullName, email, password, preferredLocale?, deviceName?}` (org fields REQUIRED) → User (ORGANIZATION) + Organization + OWNER membership. Never creates a CandidateAccount. |
| `POST /auth/login` | Optional `accountType: "CANDIDATE" \| "ORGANIZATION"` — the sign-in door. Mismatch (after password verification) is `403 AUTH_ACCOUNT_TYPE_MISMATCH`. Omitted → signs in as whatever the account is. Response `user` now includes `accountType`. |
| `GET /auth/me` | Adds `accountType` (top level and inside `user`). Legacy flat fields kept: `id,email,fullName,role,organizationId,organization` (nullable). |
| `POST /auth/users` (invite) | An existing ORGANIZATION email is added as a membership (multi-org, unchanged); an existing **CANDIDATE email is refused with 409 `AUTH_ACCOUNT_TYPE_CONFLICT`** — no conversion, no dual identity. A NEW email creates an ORGANIZATION account + membership. |
| `POST /candidate-account` | Now `@CandidateScoped`: 403 for ORGANIZATION accounts. Mostly vestigial — candidate registration already creates the profile (`409` if it exists). |
| Candidate routes (`/candidate-account/**`, `POST /public/jobs/:slug/apply`) | Require `accountType == CANDIDATE` (live DB check): ORGANIZATION accounts get `403 AUTH_ACCOUNT_TYPE_MISMATCH`. |
| Org-scoped routes | Additionally verify the membership belongs to an ORGANIZATION account (defence in depth on top of the live membership check). |
| `GET /users`, `GET /users/:id` | Team rows are memberships flattened to the old user shape, plus `membershipId` and `joinedAt`. `:id` is still the user id. |
| `DELETE /users/:id` | Removes the MEMBERSHIP (account survives). Response unchanged `{id, deleted:true}`. |
| `PATCH /users/:id` | `role` updates the membership role; `fullName` still edits the account name. Same invariants (no self-role-change, last-OWNER protected). |
| Vacancy responses | Now include `publicSlug` (stable share link id). |
| Application responses | Now include `source` and `submittedDocumentId` (nullable). New rows are always `DIRECT`; `MANUAL_UPLOAD` survives only on historical rows from the removed recruiter-created-candidate feature. |
| WebSocket `/processing` | Connection now also requires a live membership for the token's org claim; candidate-only tokens are disconnected. |

Recruiter flows keep working with an unmodified frontend as long as it stores
the newest `accessToken` (login already returns an org-activated token).

## 3. Session — `GET /auth/me`

```json
{
  "id": "…", "email": "…", "fullName": "…", "preferredLocale": "ko",
  "accountType": "CANDIDATE" | "ORGANIZATION",
  "role": "RECRUITER" | null,            // legacy-flat (active org)
  "organizationId": "…" | null,          // legacy-flat (active org)
  "organization": {"id","name","slug"} | null,

  "user": { "id", "email", "fullName", "accountType", "preferredLocale" },
  "candidateAccount": { "exists": true },
  "activeOrganization": { "id", "name", "slug", "role" } | null,
  "memberships": [
    { "organization": {"id","name","slug"}, "role": "RECRUITER", "joinedAt": "…" }
  ]
}
```

Route on `accountType`. For CANDIDATE accounts `memberships` is always `[]`
and `activeOrganization` always `null`; `candidateAccount.exists` is kept for
compatibility (true from signup). For ORGANIZATION accounts
`activeOrganization: null` means a missing/stale org claim — show the
workspace picker and call switch-organization.

## 4. Organization switching — `POST /auth/switch-organization`

Body `{ "organizationId": "<uuid>" }` → `200`:

```json
{ "accessToken": "…", "user": { …with new role/organizationId… },
  "activeOrganization": { "id", "name", "slug", "role" } }
```

- REPLACE the stored token with `accessToken` (re-set the cookie).
- `404` when the caller has no membership there (also for forged ids — no
  information leak). CANDIDATE accounts have no memberships by invariant, so
  they always get `404` here — there is no candidate ↔ organization
  switching, only organization ↔ organization for ORGANIZATION accounts.
- Works with tokens that have no or a stale org claim.

## 5. Registration — two type-explicit endpoints (public, 5/min each)

- `POST /auth/register/candidate` — `{ fullName, email, password,
  preferredLocale?, deviceName? }` → User (CANDIDATE) **plus their
  CandidateAccount**, one transaction, then a normal login session. Never an
  organization, never a membership.
- `POST /auth/register/organization` — `{ organizationName, organizationSlug,
  fullName, email, password, preferredLocale?, deviceName? }` (org fields
  REQUIRED by the DTO) → User (ORGANIZATION) + Organization + OWNER
  membership, one transaction, then a normal login session. Never a
  CandidateAccount.
- Email exclusivity is global and cross-type: same-type duplicate → 409
  `AUTH_EMAIL_ALREADY_REGISTERED`; other-type email → 409
  `AUTH_ACCOUNT_TYPE_CONFLICT` (registration has always disclosed address
  existence; the distinct code lets the UI point at the right sign-in).

## 5b. Login isolation

`POST /auth/login` accepts optional `accountType`. The candidate sign-in page
sends `"CANDIDATE"`, the organization sign-in sends `"ORGANIZATION"`; a
credential set of the other type is refused with `403
AUTH_ACCOUNT_TYPE_MISMATCH` — only AFTER the password verified, so
unauthenticated probes still get the flat 401. Regardless of the flag, a
CANDIDATE session never carries organization context and an ORGANIZATION
session never reaches candidate endpoints — the flag improves UX, the guards
enforce the boundary.

## 6. Candidate account (authenticated, CANDIDATE accounts only)

Every route below requires `accountType == CANDIDATE` (checked live per
request) — an ORGANIZATION account gets `403 AUTH_ACCOUNT_TYPE_MISMATCH`.

| Route | Notes |
|---|---|
| `POST /candidate-account` | Mostly vestigial: registration already creates the profile. `409` if it exists, `403` for ORGANIZATION accounts. |
| `GET /candidate-account/me` | `404` until created. Includes `resumeDocument` (id, originalFileName, mimeType, fileSize, createdAt) or `null`. |
| `PATCH /candidate-account/me` | Partial update, same fields as create. |
| `POST /candidate-account/me/resume` | multipart `file` (PDF/DOCX ≤50MB). LEGACY replace flow: swaps the current PRIMARY resume (old bytes/row/vectors removed). The REPLACED file's submitted copies are withdrawn from the organizations that received them — a replaced file is a deleted source. New UI should use `me/documents` below. |
| `GET /candidate-account/me/resume` | `{ url, originalFileName }` (short-lived signed URL for the primary). `404` when none. |

### 6b. Personal document collection (NEW — max 3 files, 50 MB each)

A CandidateAccount owns at most **3 personal files** (PDF/DOCX, ≤50 MB per
file). Every existing file counts toward the limit whatever its processing
status (FAILED files hold their slot until deleted); deleting one frees the
slot immediately. The **newest upload is the primary resume** — the document
snapshotted at apply time — and Candidate AI Job Match draws on ALL indexed
personal files, not just the primary.

| Route | Notes |
|---|---|
| `GET /candidate-account/me/documents` | `{ data: [{id, originalFileName, mimeType, fileSize, status, createdAt}], limit: 3, remaining, primaryDocumentId }`, newest first. |
| `POST /candidate-account/me/documents` | multipart `file`. Adds a file; at the cap → `409` code `PERSONAL_DOCUMENT_LIMIT_REACHED`. Concurrency-safe: two racing uploads can never end at 4 files. **The 50 MB per-file limit is enforced HERE and only here** — Multer's `limits.fileSize`, then `validateUploadedFile` (size, MIME, extension, magic number). Anything in front of this is a courtesy, not a control. |
| `GET /candidate-account/me/documents/:id/download-url` | `{ url, originalFileName }` (short-lived signed URL). Foreign/org ids: `404`. |
| `DELETE /candidate-account/me/documents/:id` | PERMANENT and CASCADING: the stored bytes, the row, the candidate-index vectors, **every organization copy derived from it** (`Document.sourceCandidateDocumentId`), those copies' vectors and bytes, their citations, and the requirement verdicts built on them. The applications themselves survive with no current evidence. If the primary was deleted the pointer moves to the newest survivor. Foreign ids and org-side copies are `404`. |
| `GET /candidate-account/me/evidence` | `{ hasAccount, files, links, total, evidenceRevision, canRunJobMatch }`. The evidence gate's input: `canRunJobMatch` is `total > 0`, the same condition `POST me/job-matches` enforces. |

**How the browser reaches it.** The Next frontend posts multipart to its own
Route Handler (`app/api/candidate-account/documents/route.ts`), which streams
the body straight through to this endpoint. It is deliberately NOT a Server
Action: an action's arguments are serialised into one POST body capped at 1 MB
(`serverActions.bodySizeLimit`), so every upload above that died with
"Body exceeded 1 MB limit" against a 50 MB product limit. Raising that limit was
rejected — it is global, so it would let every action on every screen accept
50 MB bodies, and the file would still be encoded into an action payload and
buffered in the Next process.

The route relays at most `MAX_UPLOAD_REQUEST_BYTES` (50 MB + 2 MB, because a
multipart envelope wraps the file) and rejects a larger `content-length` with
the same `FILE_TOO_LARGE` code, so the UI localizes it identically. That ceiling
bounds what the Next process will relay; it does not replace the rule above.

Upload/limit error codes (localize on `code`, like the AUTH_* codes):

| Code | Status | When |
|---|---|---|
| `FILE_TOO_LARGE` | 413 | File over 50 MB (`MAX_FILE_SIZE_BYTES`, default 52428800) — whichever layer rejects it. |
| `UNSUPPORTED_FILE_TYPE` | 400 | Not PDF/DOCX by MIME, extension or magic-number content check. |
| `PERSONAL_DOCUMENT_LIMIT_REACHED` | 409 | 4th personal file. |

### 6c. HR upload policy: there is none — HR cannot upload (BREAKING)

`POST /documents` **was removed** (404). Recruiters cannot upload a
candidate document at all; the only upload surface in the product is the
candidate's own `POST /candidate-account/me/documents`. Organization
documents are written in exactly one place — the apply flow's org-scoped
snapshot of the resume the candidate submitted — so recruiter-visible
evidence always originates from a file the person chose to send.
Processing MONITORING endpoints (`GET /processing-jobs*`) are unchanged.

Profile fields: `headline?, location?, phone?, summary?, skills: string[],
languages: string[], experience: [{title, company?, startDate?, endDate?,
description?}], education: [{institution, degree?, field?, startYear?,
endYear?}], profileVisibility: "PRIVATE"|"PUBLIC"` (default PRIVATE; nothing is
publicly exposed yet). All text is UTF-8 safe (ko/ru/uz tested).

## 7. Public job board (no auth)

- `GET /public/jobs?page&limit&search&location` — OPEN vacancies only.
  Rows: `publicSlug, title, department, location, employmentType,
  experienceLevel, createdAt, organization: { name }`. Paginated
  `{data, meta:{total,page,limit,totalPages}}`.
- `GET /public/jobs/:slug` — same fields + `description` +
  `requirements: [{text, type, required}]`. `404` for unknown/non-OPEN slugs.

## 8. Applying and my applications (authenticated candidate)

| Route | Notes |
|---|---|
| `POST /public/jobs/:slug/apply` | CANDIDATE accounts only (`403` otherwise) and needs an uploaded resume (`422`). `201` → `{id, status:"NEW", source:"DIRECT", createdAt, vacancy:{publicSlug,title,organization:{name}}}`. Duplicate apply to the same job: `409` (one application per job per account, ever — including after withdrawing). |
| `GET /candidate-account/me/applications?page&limit` | Own DIRECT applications only. Row: `{id, status, source, createdAt, updatedAt, vacancy:{publicSlug,title,location,employmentType,organization:{name}}, submittedDocument:{originalFileName}}`. No recruiter data, ever. |
| `GET /candidate-account/me/applications/:id` | Same shape; foreign/guessed ids are `404`. |
| `POST /candidate-account/me/applications/:id/withdraw` | The ONLY candidate status mutation. Allowed from NEW/REVIEWING/INTERVIEW/OFFER → `WITHDRAWN`; `409` from HIRED/REJECTED/WITHDRAWN. |

Statuses shown to candidates are the same enum the recruiter side uses
(`NEW REVIEWING INTERVIEW OFFER HIRED REJECTED WITHDRAWN`); translate labels in
the frontend.

## 9. Saved jobs (authenticated candidate)

- `POST /candidate-account/me/saved-jobs/:slug` → `{saved:true, savedAt}`
  (idempotent; only OPEN jobs, otherwise `404`).
- `DELETE /candidate-account/me/saved-jobs/:slug` → `{saved:false}` (idempotent).
- `GET /candidate-account/me/saved-jobs?page&limit` → rows
  `{savedAt, job:{publicSlug,title,location,employmentType,status,organization:{name}}}`
  (`status` included so a closed job can be flagged).

## 10. Error semantics

- `401` bad/expired token · `403` no active organization, not a member, or
  insufficient role · `404` cross-tenant or foreign resource (indistinguishable
  from non-existent, by design) · `409` duplicates/invalid transitions ·
  `422` apply without resume · `429` throttled · `503` AI service unreachable
  (mapped; no longer a generic 500).

## 10b. Migration rule (dual identities)

`users.accountType` was introduced by migration
`20260821000000_account_type_exclusivity`, which backfills membership-holders
as ORGANIZATION and everyone else as CANDIDATE — and **refuses to run** (with
the offending emails in the error) while any user still holds both a
CandidateAccount and memberships. Deciding which side of a person's data
survives is never guessed: resolve each dual user explicitly with
`scripts/resolve-dual-identity.ts` (`--email … --keep CANDIDATE|ORGANIZATION
--apply`; keeping CANDIDATE deletes only the membership rows, keeping
ORGANIZATION deletes the candidate profile with its saved jobs and personal
documents), then re-run the migration. The dev database's two historical dual
users were both resolved to CANDIDATE on 2026-08-21 (the `mit` demo
organization is intentionally member-less as a result; its tenant data was
preserved).

## 11. Mobile note (future)

The API is plain bearer-token over HTTP — nothing is cookie-bound server-side.
A React Native / Expo client uses exactly the endpoints in §0: store the
refresh token in SecureStore/Keychain, keep the access token in memory,
refresh on 401/expiry (serialized), pass `deviceName` at login so the user
recognizes the device in `GET /auth/sessions`, and call `DELETE
/auth/sessions/:id` for remote sign-out. Nothing else is needed server-side.

## 12. Candidate AI Job Match (NEW)

`POST /candidate-account/me/job-matches` — authenticated candidate, **no
organization required or used**. Body (both optional):
`{ "locale": "en|ko|ru|uz", "page": 1.., "limit": 1..50, "refresh": bool }` —
locale defaults to the user's `preferredLocale`, page to 1, limit to 20.

**Every eligible vacancy is ranked, and the response is a PAGE of that
ranking.** `total` is the full ranked count (153 in the dev dataset, not 5), so
a client pages to the end. `page`/`limit` are transport: page 3 returns results
41–60 of the same list, never a fresh search with a different order.

`refresh: true` re-ranks — the candidate's explicit "Refresh matches". Ordinary
paging must NOT set it, or the list reshuffles under the reader. A stored
ranking is reused until the candidate's evidence, their profile, or the vacancy
catalogue changes.

Latency: the first (ranking) call is ~2–15s plus one generation call for page 1.
Later pages are served in ~2.5s and fill their prose in the background — see
`explanationsPending`. Full design in `job-match-ranking.md`.

**Evidence gate.** `422` with `code: "NO_CANDIDATE_EVIDENCE"` when the account
has **0 files and 0 links**. Matching is evidence-grounded, so a profile
headline and a skills list are not a substitute — no Gemini call is made.
Files and links count equally and independently: one professional link is
enough. This is deliberately NOT the same rule as applying, which still
requires a resume.

```json
{
  "matches": [{
    "vacancy": { "slug", "title", "organizationName", "location",
                 "employmentType", "status" },
    "match": "STRONG" | "PARTIAL" | "WEAK",
    "explanation": "…in the requested locale, or null…",
    "supportedRequirements":   [{ "text", "required", "reason" }],
    "unsupportedRequirements": [{ "text", "required", "reason" }],
    "unclearRequirements":     [{ "text", "required", "reason" }],
    "evidence": [{ "fileName", "pageNumber", "section", "text" }],
    "saved": false,
    "applicationState": "NEW" | … | null
  }],
  "locale": "uz", "generated": true, "generatedAt": "…",
  "evidenceRevision": 7,
  "stale": false,
  "explanationsPending": false,
  "page": 1, "limit": 20,
  "total": 153, "totalPages": 8, "hasMore": true,
  "totalEligible": 153,
  "capability": { "skills": […], "roleFamilies": […], "evidenceSources": {…} }
}
```

Each match also carries `rank` (1-based, stable for one ranking), `score`
(0–100), `signals` (the per-signal breakdown), `matchedSkills` and
`missingSkills`.

`score` **orders the list and nothing else** — it is not a probability of being
hired and not a percentage of the role the candidate can do. `match`
(STRONG/PARTIAL/WEAK) is derived from it, so the two cannot disagree.

`explanationsPending: true` means prose for this page is still being written in
the background — distinct from `generated: false`, which means generation is
unavailable. A card must not say "unavailable" about text that is merely not
here yet.

`capability` reports which of the candidate's sources actually contributed, so
a report can state honestly what was used instead of assuming.

`evidenceRevision` is the revision this analysis was computed FROM.
`stale: true` means the candidate's evidence changed while it was being
generated. Clients must also compare `evidenceRevision` against
`GET me/evidence` before presenting a stored result as current — the ordinary
case is a deletion made after the result was rendered.

Semantics the UI must respect:

- `match` is a **deterministic evidence-coverage label** (computed from how
  many required requirements the candidate's documents support / miss / leave
  unclear). It is NOT a hiring recommendation, rating or percentage — never
  render it as a score.
- Matches are ordered by retrieval relevance, not by label.
- `evidence.fileName` is either the personal resume file or `"Profile"` (a
  profile field; `pageNumber` null).
- `explanation` may be `null` (`generated: false`) when the LLM was
  unavailable — the labels and requirement lists are still valid; render them.
- Vacancies are addressed by public `slug` (works with `/public/jobs/:slug`,
  save and apply). `saved`/`applicationState` let the UI show bookmark/apply
  state inline.
- The match uses ONLY the personal profile + personal resume. Uploading or
  replacing the resume re-indexes automatically (allow a few seconds after
  upload before matching reflects it).

## 13. AI generation locale precedence (updated)

For `POST /ai/answer`, `POST /ai/candidates/:id/summary` and interview
questions, `locale` is now optional with a documented precedence:

    explicit request locale → the user's preferredLocale → 'en'

Sending the UI locale explicitly is still recommended (it always wins). The
backend also guarantees answer/citation consistency: any inline citation
marker in `answer` corresponds to an entry in `citations` (markers are
`[<chunkId>]`, which the existing `segmentAnswer` renderer already converts to
numbered references) — an answer can never show source markers while
`citations` is empty, in ANY status.

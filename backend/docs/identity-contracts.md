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

## 1. The identity model

```
User (account identity: email, fullName, preferredLocale)
├── CandidateAccount (0..1) — personal job-seeker profile, owned by the user
└── OrganizationMember (0..n) — one row per organization, each with its own role
```

- Roles (`OWNER | HR_ADMIN | RECRUITER | INTERVIEWER`) exist ONLY on
  memberships. There is no global role, no CANDIDATE role, no EMPLOYEE role.
- The JWT identifies the user and carries an `org` claim naming the ACTIVE
  organization. It never carries a role. Every org-scoped request re-validates
  the membership row in the database, so a removed/demoted member changes
  behaviour on their next request even with an old token.
- `preferredLocale` is one of `en | ko | ru | uz` (default `en`).

## 2. Breaking / changed contracts (delta from the single-org backend)

| Endpoint | What changed |
|---|---|
| `POST /auth/register` | `organizationName`/`organizationSlug` now OPTIONAL — omit both to register a job seeker. Optional `preferredLocale`. Response `user.role` / `user.organizationId` are now `null` for users without an active organization. |
| `POST /auth/login` | Same response shape; `role`/`organizationId` describe the DEFAULT active org (oldest membership) or are `null`. Token must be replaced when switching organization. |
| `GET /auth/me` | Superset shape (see §3). Legacy flat fields kept: `id,email,fullName,role,organizationId,organization` (now nullable). |
| `POST /auth/users` (invite) | Inviting an EXISTING email now adds a membership instead of erroring; response adds `membershipId`; existing accounts keep their password/name (submitted ones are ignored). |
| `GET /users`, `GET /users/:id` | Team rows are memberships flattened to the old user shape, plus `membershipId` and `joinedAt`. `:id` is still the user id. |
| `DELETE /users/:id` | Removes the MEMBERSHIP (account survives). Response unchanged `{id, deleted:true}`. |
| `PATCH /users/:id` | `role` updates the membership role; `fullName` still edits the account name. Same invariants (no self-role-change, last-OWNER protected). |
| Vacancy responses | Now include `publicSlug` (stable share link id). |
| Application responses | Now include `source` (`DIRECT`/`MANUAL_UPLOAD`/… ) and `submittedDocumentId` (nullable). |
| WebSocket `/processing` | Connection now also requires a live membership for the token's org claim; candidate-only tokens are disconnected. |

Recruiter flows keep working with an unmodified frontend as long as it stores
the newest `accessToken` (login already returns an org-activated token).

## 3. Session — `GET /auth/me`

```json
{
  "id": "…", "email": "…", "fullName": "…", "preferredLocale": "ko",
  "role": "RECRUITER" | null,            // legacy-flat (active org)
  "organizationId": "…" | null,          // legacy-flat (active org)
  "organization": {"id","name","slug"} | null,

  "user": { "id", "email", "fullName", "preferredLocale" },
  "candidateAccount": { "exists": true },
  "activeOrganization": { "id", "name", "slug", "role" } | null,
  "memberships": [
    { "organization": {"id","name","slug"}, "role": "RECRUITER", "joinedAt": "…" }
  ]
}
```

`activeOrganization` is `null` when the token has no/stale org claim — show the
workspace picker and call switch-organization.

## 4. Organization switching — `POST /auth/switch-organization`

Body `{ "organizationId": "<uuid>" }` → `200`:

```json
{ "accessToken": "…", "user": { …with new role/organizationId… },
  "activeOrganization": { "id", "name", "slug", "role" } }
```

- REPLACE the stored token with `accessToken` (re-set the cookie).
- `404` when the caller has no membership there (also for forged ids — no
  information leak).
- Works with tokens that have no or a stale org claim.

## 5. Registration — `POST /auth/register` (public, 5/min)

- Hiring: `{ organizationName, organizationSlug, fullName, email, password,
  preferredLocale? }` → creates org + OWNER membership.
- Job seeker: `{ fullName, email, password, preferredLocale? }` → bare user;
  create the candidate profile afterwards (§6). Providing only one org field is
  a `400`.

## 6. Candidate account (authenticated; no org context needed)

| Route | Notes |
|---|---|
| `POST /candidate-account` | Create own profile; all fields optional. `409` if it exists. |
| `GET /candidate-account/me` | `404` until created. Includes `resumeDocument` (id, originalFileName, mimeType, fileSize, createdAt) or `null`. |
| `PATCH /candidate-account/me` | Partial update, same fields as create. |
| `POST /candidate-account/me/resume` | multipart `file` (PDF/DOCX ≤10MB). Replaces the profile resume; old applications keep their submitted snapshot. |
| `GET /candidate-account/me/resume` | `{ url, originalFileName }` (short-lived signed URL). `404` when none. |

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
| `POST /public/jobs/:slug/apply` | Needs a candidate account (`400`) and an uploaded resume (`422`). `201` → `{id, status:"NEW", source:"DIRECT", createdAt, vacancy:{publicSlug,title,organization:{name}}}`. Duplicate apply to the same job: `409` (one application per job per account, ever — including after withdrawing). |
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
`{ "locale": "en|ko|ru|uz", "limit": 1..10 }` — locale defaults to the user's
`preferredLocale`, limit to 5. `422` when the account has neither a resume nor
any profile content. Latency is generation-bound (~15–30s) — show a progress
state, don't set short client timeouts.

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
  "locale": "uz", "generated": true, "generatedAt": "…"
}
```

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

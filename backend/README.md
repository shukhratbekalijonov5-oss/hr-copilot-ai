# HR Copilot AI — Backend

NestJS + TypeScript API for HR Copilot AI, an AI-assisted recruitment
**intelligence** platform.

The product flow is: HR creates a vacancy → uploads resumes → files are stored →
an asynchronous processing job is created → the AI service parses and indexes
the documents → candidate evidence becomes searchable → **a human reviews the
evidence and makes the hiring decision**.

> The system never hires or rejects a candidate automatically. Application
> status is changed only by an explicit request from a signed-in user.

---

## Ports

| Service            | Port   | Notes                                            |
| ------------------ | ------ | ------------------------------------------------ |
| Frontend (Next.js) | `3000` | Owned by the frontend. The backend never binds it. |
| **Backend (this)** | `3001` | Default. Override with `PORT`.                    |
| AI service (Python)| `8000` | See `ai-service/`                                 |
| PostgreSQL         | `5432` | Local default                                    |
| Redis              | `6379` | Local default                                    |
| Qdrant             | `6333` | Vector store used by the AI service               |

The port is resolved in [`src/config/configuration.ts`](src/config/configuration.ts)
(`PORT`, defaulting to `3001`) and read via `ConfigService` in
[`src/main.ts`](src/main.ts). No port is hardcoded anywhere else.

```bash
PORT=4000 yarn start:dev   # runs on 4000 instead
```

---

## Requirements

- **Node.js 22.12+** — see [`.nvmrc`](.nvmrc); run `nvm use`.
  Prisma 7 requires Node 20.19+/22.12+/24+, and its CLI requires 22+.
- **Yarn** (Yarn 1.x). This project does **not** use npm — there is no
  `package-lock.json` and one should not be created.
- PostgreSQL 14+ and Redis 6+ for full functionality.

---

## Getting started

```bash
nvm use            # Node 22
yarn               # install dependencies (also runs `prisma generate`)
cp .env.example .env
# edit .env — at minimum set DATABASE_URL and a real SECRET_TOKEN
yarn db:migrate    # create the schema
yarn db:seed       # optional: fictional development data
yarn start:dev
```

The API is then at `http://localhost:3001`, and startup logs:

```
HR Copilot API listening on port 3001
```

### Local PostgreSQL and Redis

If you do not already run them locally:

```bash
docker run -d --name hrcopilot-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hr_copilot \
  postgres:16-alpine

docker run -d --name hrcopilot-redis -p 6379:6379 redis:7-alpine
```

---

## Commands

All commands use Yarn.

```bash
yarn                 # install dependencies
yarn start:dev       # watch mode (http://localhost:3001)
yarn start           # run once
yarn start:prod      # run the compiled build (node dist/main)
yarn build           # compile to dist/
yarn lint            # eslint --fix
yarn format          # prettier
yarn test            # unit tests
yarn test:cov        # unit tests with coverage
yarn test:e2e        # end-to-end tests
```

Database:

```bash
yarn prisma:generate    # regenerate the Prisma client
yarn db:migrate         # create + apply a migration (development)
yarn db:migrate:deploy  # apply existing migrations (CI / production)
yarn db:seed            # fictional development seed data
yarn db:studio          # Prisma Studio
```

---

## Environment

Every variable is documented in [`.env.example`](.env.example), which contains
**placeholders only**. `.env` is gitignored and must never be committed.

| Variable                                                          | Purpose                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `PORT`                                                            | Backend HTTP port. Default `3001`.                          |
| `FRONTEND_URL`                                                    | Allowed CORS origin. Default `http://localhost:3000`.       |
| `API_PREFIX`                                                      | REST path prefix. Default `api`. Health routes sit outside. |
| `DATABASE_URL`                                                    | PostgreSQL connection string. **Required.**                 |
| `REDIS_URL`                                                       | Redis connection string.                                    |
| `SECRET_TOKEN`                                                    | Backend auth signing secret, min 32 chars. **Required.**    |
| `TOKEN_TTL`, `BCRYPT_ROUNDS`                                      | Token lifetime and password hashing cost.                   |
| `STORAGE_DRIVER`                                                  | `local` (default) or `r2`.                                  |
| `STORAGE_LOCAL_ROOT`, `MAX_FILE_SIZE_BYTES`, `SIGNED_URL_TTL_SECONDS` | Storage tuning.                                        |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Required when `STORAGE_DRIVER=r2`.                |
| `AI_SERVICE_URL`                                                  | Python AI service, e.g. `http://localhost:8000`. Empty disables AI. |
| `INTERNAL_SERVICE_TOKEN`                                          | Shared backend↔AI service credential. Required when `AI_SERVICE_URL` is set. |
| `THROTTLE_TTL_MS`, `THROTTLE_LIMIT`                               | Rate limiting.                                              |

Configuration is validated at boot ([`src/config/env.validation.ts`](src/config/env.validation.ts)).
A bad environment fails fast, and error messages name the offending **variable**
without printing its value.

There is a single auth secret, `SECRET_TOKEN`. Do not add a second `JWT_SECRET`.

**Never logged:** passwords, tokens, `DATABASE_URL`, `REDIS_URL`, R2 credentials.

---

## Architecture

```
src/
  main.ts                 bootstrap: port, CORS, global validation pipe
  app.module.ts           module wiring + global guards
  config/                 typed configuration and env validation
  common/
    guards/               JwtAuthGuard, RolesGuard (both registered globally)
    decorators/           @CurrentUser, @Roles, @Public
    tenant/               TenantService — multi-tenancy primitives
    filters/              AllExceptionsFilter — stops internals leaking in 500s
    errors/               describeError — actionable driver diagnostics
    dto/                  shared pagination
  prisma/                 PrismaService (driver-adapter connection)
  redis/                  shared Redis connection + health ping
  auth/                   register, login, current user, invite teammate
  search/                 HR-facing semantic evidence search
  users/                  team directory, role changes (org-scoped)
  organizations/          the caller's own organization + dashboard counters
  vacancies/              vacancies + job requirements
  candidates/             candidates + metadata search
  applications/           candidate ↔ vacancy links, human stage changes
  documents/              upload, validation, signed URLs
  storage/                StorageService abstraction (local | R2)
  queue/                  BullMQ producer + processor
  processing/             lifecycle state machine, progress API, WebSocket
  evidence/               candidate evidence storage and retrieval
  ai/                     AiServiceClient — boundary to the Python service
  health/                 liveness and readiness probes
  generated/prisma/       generated Prisma client (gitignored)
```

### Identity model

```
User (account: email, fullName, preferredLocale en|ko|ru|uz)
├── CandidateAccount   0..1   personal job-seeker profile — NOT a role,
│                             belongs to no organization
└── OrganizationMember 0..n   one row per organization, each with its own
                              role (OWNER | HR_ADMIN | RECRUITER | INTERVIEWER)
```

The same person may simultaneously be a job seeker, a RECRUITER in one
organization and an INTERVIEWER in another. There is no global role and no
CANDIDATE/EMPLOYEE role. Recruiter-side `Candidate` rows are organization
records; they optionally link to a `CandidateAccount` when the person applied
through HR Copilot directly (manual/imported candidates have no account, which
is correct). Full API contracts: `docs/identity-contracts.md`.

### Multi-tenancy

This is the most important invariant in the codebase.

- The JWT identifies the **user** and carries an active-organization pointer
  (`org` claim) — never a role. On routes marked `@OrgScoped()`,
  `OrgContextGuard` validates a LIVE `OrganizationMember` row on every request
  and only then fills `organizationId` and `role`; a removed or demoted member
  changes behaviour on their next request, whatever their token says.
  `POST /auth/switch-organization` re-points the claim after re-verifying the
  membership.
- `organizationId` is therefore taken **only** from the validated membership
  context, surfaced as `@CurrentUser('organizationId')`. It is never read from
  a request body, query string or header.
- No DTO declares an `organizationId` field, and the global `ValidationPipe`
  runs with `forbidNonWhitelisted: true` — a client that tries to send one gets
  a `400`, not silent acceptance.
- Every org-scoped query spreads `TenantService.scope(organizationId)` into its
  Prisma `where`.
- Rows that inherit tenancy through a parent (job requirements via vacancy,
  applications via both vacancy and candidate) are filtered through that
  relation.
- A cross-tenant read returns **404, not 403** — a 403 would confirm the id
  exists in some other organization, which is itself a leak.

### Authentication and roles

JWT bearer tokens signed with `SECRET_TOKEN`; passwords hashed with bcrypt.
`JwtAuthGuard`, `OrgContextGuard` and `RolesGuard` are registered globally (in
that order), so routes are private by default and must opt out with
`@Public()`; recruiter routes additionally opt IN to organization context with
`@OrgScoped()`.

Roles (organization-scoped, on the membership row): `OWNER`, `HR_ADMIN`,
`RECRUITER`, `INTERVIEWER`. A CandidateAccount grants no organization access of
any kind.

### Sessions and refresh tokens

Authentication is a two-token system, transport-neutral (web cookies today, a
React Native client later — both are just bearer credentials to the API):

- **Access token** — JWT `{sub, email, org?, sid}`, **15 minutes**
  (`TOKEN_TTL`). Deliberately carries no role and no membership list; it is an
  identity + pointers, and org-scoped authorization is re-derived from the
  live `OrganizationMember` row on every request. `sid` names the session it
  was minted under.
- **Refresh token** — opaque `<sessionId>.<256-bit random secret>`, backed by
  an `auth_sessions` row with a **30-day absolute lifetime**
  (`REFRESH_TOKEN_TTL_DAYS`). The database stores **only the SHA-256 hash** of
  the secret (high-entropy secrets need no key-stretching, and the hash is
  checked on every refresh); the raw token exists only in the client.

Lifecycle rules, all enforced in `AuthSessionService`:

- **Rotation**: every `POST /auth/refresh` replaces the secret; the previous
  hash is retained. Rotation never extends `expiresAt`.
- **Reuse = theft**: presenting the immediately superseded token revokes the
  whole session (`AUTH_REFRESH_TOKEN_REUSED`) — fail-secure for both the thief
  and the victim, who simply logs in again. A *wrong* secret is a plain 401
  and changes nothing, so session ids cannot be revoke-DoS'ed by guessing.
  Clients must serialize refreshes.
- **Logout** revokes only the current session (`sid`); **logout-all** revokes
  every session of the user. `GET /auth/sessions` lists live sessions (safe
  fields only, current one flagged); `DELETE /auth/sessions/:id` is remote
  sign-out — foreign/unknown ids are a uniform 404.
- **Organization switching** never rotates the refresh token: a session
  authenticates the user/device, while the active organization is per-session
  CONTEXT (`activeOrganizationId`), persisted so later refreshes keep minting
  tokens for the switched workspace. If that membership disappears, refresh
  degrades to an organization-less token instead of failing — the person may
  still be a job seeker or belong to other organizations.
- **Cleanup**: live queries exclude revoked/expired rows via indexed columns;
  `AuthSessionService.pruneExpired()` exists for a future scheduled job. No
  background subsystem was added.
- Auth failures carry stable codes (`AUTH_INVALID_REFRESH_TOKEN`,
  `AUTH_REFRESH_TOKEN_EXPIRED`, `AUTH_REFRESH_TOKEN_REUSED`,
  `AUTH_SESSION_REVOKED`, `AUTH_SESSION_NOT_FOUND`) so the four product
  locales localize on `code`, never on the English `message`.

Known property (documented tradeoff): revocation stops **refresh** instantly,
while an already-issued access token stays cryptographically valid for its
remaining ≤15 minutes on non-org routes; org-scoped routes hit the live
membership check regardless. Raw tokens and hashes never appear in logs or
responses.

### Storage

`StorageService` is an abstract class with `upload()`, `delete()`,
`getSignedUrl()` and `exists()`. Two drivers:

- **`local`** (default) — writes under `STORAGE_LOCAL_ROOT`. Signed URLs point
  at this backend and carry an HMAC signature plus expiry, mirroring the R2
  contract so calling code is identical.
- **`r2`** — Cloudflare R2 over the S3 API, returning presigned URLs.

Object keys are namespaced per tenant: `org/{organizationId}/documents/{id}.{ext}`.
Storage credentials never leave the backend; the frontend only ever receives a
short-lived signed URL.

### Redis and BullMQ

Queue `resume-processing`, job `PROCESS_DOCUMENT`. Payloads carry
**identifiers only** — `{ documentId, organizationId, candidateId }` — never
file contents or signed URLs. The worker re-reads what it needs.

Job options: 3 attempts, exponential backoff from 5s, completed jobs retained
24h/1000, failed jobs 7d/5000.

No AI work happens in an HTTP handler. Upload returns as soon as the job is
enqueued.

### Processing lifecycle

```
UPLOADED → QUEUED → PARSING → CHUNKING → EMBEDDING → INDEXING → COMPLETED
                                                              ↘ FAILED
```

`ProcessingJob` tracks `status`, `progress`, `attempts` and `errorMessage`.
Progress is exposed at `GET /api/processing-jobs` and pushed over a WebSocket
(`/processing` namespace, one room per organization, JWT-authenticated) as
`processing.progress`, `processing.completed` and `processing.failed`.

---

## AI service integration

The Python AI service (`ai-service/`, port 8000) is **wired up and working**.

```
upload → Document row → BullMQ PROCESS_DOCUMENT → worker
       → streams the file to the AI service over the internal channel
       → parse → chunk → embed (PyTorch) → index (Qdrant)
       → COMPLETED
```

### Internal authentication

Backend↔AI traffic uses `INTERNAL_SERVICE_TOKEN` in the `X-Internal-Service-Token`
header — a dedicated **service** credential, deliberately separate from
`SECRET_TOKEN`. A recruiter's JWT is never forwarded to the AI service, and the
same token guards the backend's own `/api/internal/*` callback route. Both
sides fail closed when it is unset.

### File access

The worker reads the document from `StorageService` and streams the bytes to
the AI service. No public URL and no signed URL is ever minted for
machine-to-machine access, and none is stored in Qdrant. The same path works
for the local-disk driver and for R2.

### Progress

Document status is **observed, not guessed**. The backend cannot see inside a
single processing call, so writing PARSING → CHUNKING → EMBEDDING → INDEXING
around it would be inventing progress. Instead the AI service reports each
stage to `POST /api/internal/processing/progress` as it genuinely completes,
and that drives both the `Document` row and the existing WebSocket gateway.

The queue worker still owns orchestration and the terminal states
(COMPLETED / FAILED) — it remains the source of truth for whether a job
succeeded, and refuses to mark a document COMPLETED if nothing was indexed.

### Retry

`POST /api/documents/:id/reprocess` requeues a failed document without a
re-upload. It is deliberately per-document rather than a blanket retry: a file
that is genuinely corrupt would just fail again. Re-indexing is safe because
the AI service replaces a document's vectors rather than appending.

The route also recovers a document stranded in an in-flight status with no live
BullMQ job (a dead worker), by asking the queue what actually exists rather
than trusting the row.

### Not implemented: RAG

No LLM is called anywhere. The pipeline is retrieval only — parse, chunk,
embed, index, search, rerank, cite. Grounded answer generation is future work.

## Candidate evidence

Evidence rows are passages extracted from documents, each pointing back at its
document and page so a human can verify it. There is deliberately **no score,
confidence or rating field** — evidence is something a person reads and judges,
not a machine verdict.

---

## Health endpoints

Both are public, unprefixed and exempt from rate limiting.

| Endpoint        | Meaning                                                         |
| --------------- | --------------------------------------------------------------- |
| `GET /health/live`  | `200` whenever the process is alive. Touches no dependency. |
| `GET /health/ready` | `200` when PostgreSQL **and** Redis answer; `503` otherwise. |

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

```jsonc
// ready, everything up
{ "status": "ok", "checks": { "database": { "status": "up" }, "redis": { "status": "up" } } }

// ready, database down -> HTTP 503
{ "status": "error", "checks": { "database": { "status": "down", "error": "ECONNREFUSED: ..." }, "redis": { "status": "up" } } }
```

---

## CORS

A single explicit origin from `FRONTEND_URL` (default `http://localhost:3000`),
with `credentials: true`. `origin: '*'` is never used — it is unsafe alongside
credentials and rejected by browsers. The WebSocket gateway applies the same
policy via `ProcessingIoAdapter`.

---

## API overview

All routes are under `/api` except the health probes, and all require a bearer
token except those marked public.

| Method | Path                                                | Notes                     |
| ------ | --------------------------------------------------- | ------------------------- |
| POST   | `/api/auth/register`                                | public — hiring (org + OWNER membership) or job seeker (no org fields) |
| POST   | `/api/auth/login`                                   | public                    |
| POST   | `/api/auth/refresh`                                 | public — rotates the refresh token |
| POST   | `/api/auth/logout`                                  | revokes the CURRENT session |
| POST   | `/api/auth/logout-all`                              | revokes every session of the caller |
| GET    | `/api/auth/sessions`                                | own live sessions, current flagged |
| DELETE | `/api/auth/sessions/:id`                            | remote sign-out (own sessions only) |
| GET    | `/api/auth/me`                                      | session contract (memberships, active org, candidate flag) |
| POST   | `/api/auth/switch-organization`                     | activates one of the caller's memberships |
| POST   | `/api/auth/users`                                   | OWNER, HR_ADMIN — existing emails become members |
| GET    | `/api/users`, `/api/users/:id`                      | own organization only     |
| PATCH  | `/api/users/:id`                                    | OWNER, HR_ADMIN           |
| DELETE | `/api/users/:id`                                    | OWNER                     |
| GET    | `/api/organizations/current`                        | own organization only     |
| GET    | `/api/organizations/current/stats`                  | dashboard counters        |
| PATCH  | `/api/organizations/current`                        | OWNER, HR_ADMIN           |
| GET/POST | `/api/vacancies`                                  | pagination + filtering    |
| GET/PATCH/DELETE | `/api/vacancies/:id`                      |                           |
| PATCH  | `/api/vacancies/:id/close`, `/archive`              |                           |
| GET/POST | `/api/vacancies/:id/requirements`                 |                           |
| PATCH/DELETE | `/api/vacancies/:id/requirements/:requirementId` |                     |
| GET/POST | `/api/candidates`                                 | pagination + search       |
| GET/PATCH/DELETE | `/api/candidates/:id`                     |                           |
| GET/POST | `/api/applications`                               |                           |
| GET/DELETE | `/api/applications/:id`                         |                           |
| PATCH  | `/api/applications/:id/status`                      | **human-controlled only** |
| POST   | `/api/documents`                                    | multipart upload          |
| GET    | `/api/documents`, `/api/documents/:id`              |                           |
| GET    | `/api/documents/:id/download-url`                   | short-lived signed URL    |
| GET    | `/api/documents/download`                           | signature-authorised (local driver) |
| GET/POST | `/api/evidence`                                   |                           |
| GET    | `/api/evidence/by-candidate/:candidateId`           |                           |
| GET    | `/api/evidence/by-requirement/:requirementId`       |                           |
| POST   | `/api/documents/:id/reprocess`                      | requeue a failed document |
| POST   | `/api/search/evidence`                              | semantic evidence search  |
| GET    | `/api/processing-jobs`, `/api/processing-jobs/:id`  |                           |
| GET    | `/api/public/jobs`, `/api/public/jobs/:slug`        | public — OPEN vacancies, safe fields only |
| POST   | `/api/public/jobs/:slug/apply`                      | candidate account required — direct application |
| POST   | `/api/candidate-account`                            | create own job-seeker profile |
| GET/PATCH | `/api/candidate-account/me`                      | own profile only          |
| POST/GET | `/api/candidate-account/me/resume`                | personal resume (upload / signed URL) |
| GET    | `/api/candidate-account/me/applications(/:id)`      | own DIRECT applications   |
| POST   | `/api/candidate-account/me/applications/:id/withdraw` | only candidate status mutation |
| GET/POST/DELETE | `/api/candidate-account/me/saved-jobs(/:slug)` | bookmarks (OPEN jobs)  |
| POST   | `/api/internal/processing/progress`                 | AI service only (service token) |
| GET    | `/health/live`, `/health/ready`                     | public                    |

---

## Database

PostgreSQL via Prisma 7. The schema is [`prisma/schema.prisma`](prisma/schema.prisma).

Prisma 7 connects through a **driver adapter** rather than a `url` in the
schema: the runtime connection is built from `ConfigService` in
[`src/prisma/prisma.service.ts`](src/prisma/prisma.service.ts), and the CLI
reads `DATABASE_URL` via [`prisma.config.ts`](prisma.config.ts).

Models: `Organization`, `User`, `Vacancy`, `JobRequirement`, `Candidate`,
`Application`, `Document`, `CandidateEvidence`, `ProcessingJob`.

The generated client is written to `src/generated/prisma` and is **gitignored**
— `yarn` regenerates it via `postinstall`.

---

## Security

- DTO validation on every endpoint; unknown properties rejected (`400`).
- Upload validation checks declared MIME type, file extension **and magic
  bytes** — the first two are attacker-controlled, so content is what decides.
  PDF and DOCX only, size-capped.
- bcrypt password hashing; login is timing-equalised for unknown accounts.
- Global auth and role guards; rate limiting via `@nestjs/throttler`, tightened
  on `/auth/login` and `/auth/register`.
- Tenant isolation as described above.
- Signed local-storage URLs are HMAC-verified, expiring, and reject path
  traversal.
- `AllExceptionsFilter` converts any unexpected error into a flat `500`; driver
  messages (which can carry a connection string) go to the server log only, and
  the log redacts query strings so signed-URL signatures are never written down.
- Organization integrity: nobody can change their own role, and the last `OWNER`
  cannot be demoted or removed.

---

## Seed data

`yarn db:seed` creates entirely fictional data: two organizations (the second
exists so tenant isolation can be exercised by hand), an owner and a recruiter,
one vacancy with six requirements, and five invented candidates using `.test`
email addresses.

**No real candidate or applicant data may ever be added to the seed file** — it
is committed and shared with every contributor.

Development login: `recruiter@northwind-labs.test` / `DevPassword123!`

No documents, evidence or processing jobs are seeded: those only exist as the
result of a real upload, and faking them would misrepresent a pipeline that has
not run.

---

## Tests

```bash
yarn test        # unit
yarn test:e2e    # end-to-end
```

Coverage is focused on the parts where a mistake is expensive: **tenant
isolation** (every service asserts cross-organization access fails), auth and
token handling, role guards, upload validation including magic-byte spoofing,
queue job creation and payload shape, the processing lifecycle, the AI boundary
refusing to fabricate output, and the health probes.

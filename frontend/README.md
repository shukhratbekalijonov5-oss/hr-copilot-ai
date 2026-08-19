# HR Copilot AI — Frontend

Next.js App Router frontend for HR Copilot AI, an evidence-first recruitment
intelligence tool. The app helps a hiring team read resumes against the
requirements of a vacancy, search a pipeline in plain language, and compare
candidates — while every shortlist, rejection and hire stays a human decision.

## Requirements

- Node.js 20.9+ (see `.nvmrc`)
- Yarn (this project uses Yarn — **do not use npm or pnpm**)
- The NestJS API running on port 3001

## Getting started

```bash
cp .env.example .env.local   # then set NEXT_PUBLIC_API_BASE_URL
yarn
yarn dev
```

The dev server runs on [http://localhost:3000](http://localhost:3000); the API is
expected at `http://localhost:3001`.

## Scripts

```bash
yarn dev      # start the dev server on port 3000
yarn build    # production build
yarn start    # serve the production build
yarn lint      # eslint
yarn typecheck # tsc --noEmit
yarn test      # vitest (unit tests for adapters, error mapping, validation)
```

> Use the Node version in `.nvmrc` (20.20.2). On Node 21 the toolchain is
> degraded: `yarn install` needs the `--ignore-engines` bypass in `.yarnrc`, and
> Vitest fails to start because `util.styleText` there does not accept an array.

## Architecture

```
app/
  (auth)/          login, register — public shell
  (app)/           authenticated shell (sidebar + topbar)
components/
  layout/          AppShell, Sidebar, Header, PageHeader
  ui/              primitives: Button, Card, Field, DataTable, Badge, Tabs, …
  candidates/      candidate list, detail workspace, document viewer
  vacancies/       vacancy list, card, create form
  evidence/        EvidenceCard, CitationLink
  upload/          ResumeUploader, UploadPanel
  processing/      ProcessingProgress, ProcessingView
  search/ compare/ settings/
lib/
  types.ts         domain types (User, Vacancy, Candidate, Evidence, …)
  constants.ts     enum label maps and limits
  utils.ts         formatting and pipeline helpers
  api/             service layer — the only place that talks to a backend
  mock/            seed data + derived store behind the service layer
```

### Data layer

Components never call `fetch` directly. Everything goes through `lib/api`, which
runs **server-side only** (`lib/api/http.ts` imports `server-only`):

```ts
import { api } from "@/lib/api";

const vacancies = await api.getAllVacancies();
```

- `lib/api/contracts.ts` — the wire shapes NestJS returns.
- `lib/api/adapters.ts` — the single place those are mapped to domain types.
- `lib/api/errors.ts` — every backend failure becomes one `ApiError` shape.

Client components never import `lib/api`. They call **server actions**
(`lib/auth/actions.ts`, `app/(app)/**/actions.ts`) or the route handlers under
`app/api`, so the backend JWT never enters browser JavaScript.

### Authentication

The API issues a bearer JWT. It is stored in an **httpOnly cookie** written by a
server action, and attached to backend calls server-side. `proxy.ts` does a cheap
cookie-presence check to keep signed-out users off application routes; the real
check is `requireSession()` in the authenticated layout, which verifies the token
against `GET /auth/me`.

Known limitation: the API has no token-revocation endpoint, so signing out clears
the cookie but the underlying token stays valid until it expires.

### Realtime processing

`app/api/processing/stream` holds a socket.io connection to the backend's
processing gateway server-side and forwards `processing.progress`,
`processing.completed` and `processing.failed` to the browser as SSE. The token
stays on the server, and the client gets EventSource reconnection. After a
reconnect the page re-reads state over HTTP rather than showing stale progress.

### Uploads

`Browser → Next (app/api/uploads) → NestJS → storage → BullMQ`. The frontend
holds no storage credential and never contacts the Python AI service or Qdrant.

## Two-sided platform, and what the API still needs

The product is a candidate platform *and* a recruiter workspace over one
account. The frontend models that today:

- `lib/workspace/` derives the workspaces a person can be in and the navigation
  each one gets. Roles are read from the membership, never as a global
  "user role".
- `app/(app)/` is the recruiting workspace, `app/(candidate)/` is the personal
  one. They share the shell and nothing else.
- Sidebar visibility is filtered by organization role (an interviewer does not
  see vacancies, compare, processing or settings). **This is usability only** —
  every route is independently authorized by the backend.

### Required backend migration

The API still models identity the old way, and the job-seeker side cannot work
until that changes:

| Concept | API today | Needed |
| --- | --- | --- |
| Identity | `User.organizationId` + `User.role` columns | `OrganizationMember(userId, organizationId, role)` |
| Job seeker | none — `Candidate` is a recruiter-owned record | `CandidateAccount(userId, …)` owned by the user |
| Multi-org | one organization per user | membership rows, and a JWT that can carry the active one |
| Public jobs | every vacancy route is org-scoped | a public endpoint returning OPEN vacancies only |
| Direct apply | `POST /applications` needs a recruiter role | a route letting a job seeker apply for themselves |
| Saved jobs | none | a saved-jobs collection on the account |
| Provenance | `Application` has no `source` | a `source` column using the agreed enum |

Every screen that depends on one of these renders an `UnavailableState` naming
the missing contract. `lib/capabilities.ts` holds one flag per gap — flip it
when the endpoint lands and delete the unavailable branch. No screen falls back
to sample data.

## Product principles

The UI never presents an automated hiring outcome. Requirement checks resolve to
`Evidence found`, `No evidence found` or `Needs human review`, always with the
document and page the passage came from. There is no opaque candidate score, no
automatic rejection, and no filtering on protected attributes.

Features whose backend route does not exist yet (semantic search, grounded
summaries, interview questions) render an explicit "not available" state. They
are never backed by mock content — a fake analysis is worse than a missing one.
`lib/capabilities.ts` is the single switch that turns each on.

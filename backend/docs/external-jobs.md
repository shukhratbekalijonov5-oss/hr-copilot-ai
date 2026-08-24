# External jobs

The foundation (Task 4A) and four real providers: Greenhouse (4B.1),
Lever (4B.2), Ashby (4B.3) and Ninehire (4B.4).

## The shape

```
provider API/feed   greenhouse · lever · ashby · ninehire providers
      ↓             (all four through the shared provider-http.ts)
NormalizedExternalJobInput          external-job.contract.ts
      ↓  validation of untrusted input
normalize.ts / external-job.limits.ts
      ↓  identity + merge decision
dedupe.ts
      ↓  upsert, provenance, conflict resolution
external-ingestion.service.ts / field-merge.ts / external-sync.service.ts
      ↓  Postgres: ExternalJob + ExternalJobSource
      ↓
externalJobFeatures()               external-job-features.ts
      ↓
NormalizedJobFeatures  ←── the SAME shape a Vacancy maps into
      ↓
existing matching: hard constraints · intent alignment · FX salary · ranking
```

Internal `Vacancy` and `ExternalJob` never meet before
`NormalizedJobFeatures`. Nothing downstream of that point can tell them apart,
and nothing may try.

## What each layer owns

| Layer | Owns | Must never |
| --- | --- | --- |
| Provider | Talking to one source; mapping its payload | Know about ranking, FX, dedupe |
| `normalize.ts` | Type/bounds/URL/HTML safety | Guess a value the source omitted |
| `dedupe.ts` | Whether two sightings are one job | Consult a model |
| `field-merge.ts` | Which source's claim wins | Discard the losing claim |
| `lifecycle.ts` | ACTIVE/STALE/CLOSED/EXPIRED/UNAVAILABLE | Treat a fetch failure as a closure |
| Ingestion | Upsert, provenance, counters | Fail a run over one bad posting |
| Features | Mapping to the matcher's shape | Take a provider argument |

## Invariants

- **Postgres owns the external universe.** `status IN (ACTIVE, STALE)` is what
  currently exists. Qdrant, when external indexing is added, is a retrieval
  accelerator: a top-K result is a *candidate set*, never the set of jobs that
  exist. This is the same rule internal matching already follows.
- **Salary stays in the source currency.** Providers supply
  `salaryMin/salaryMax/currency/payPeriod` and nothing else. Conversion happens
  once, later, in the Task 3B FX pipeline. There is no external FX code and
  there must never be.
- **Unknown stays unknown.** Work authorization, seniority, work mode and
  remote-country eligibility are stored only when the source states them.
  `remoteCountriesAllowed: []` is unknown geography, never worldwide.
- **A false merge is worse than a duplicate.** Only `EXACT` and `HIGH`
  confidence merge automatically. `POSSIBLE` stays two rows.
- **Gemini decides nothing here.** Not existence, not dedupe, not lifecycle,
  not score.

## Legal / access boundary

`ExternalAccessMethod` has four members — `OFFICIAL_API`, `PUBLIC_FEED`,
`PUBLIC_ENDPOINT`, `PARTNER_INTEGRATION` — and deliberately no value for
scraping behind authentication, anti-bot measures, CAPTCHAs or robots
restrictions. A provider declares its method and its `allowedHosts`, and
`ExternalProviderRegistry` refuses to register one with an empty allowlist:
server-side fetching with an open host list is an SSRF primitive on a
scheduler.

For any new provider, verify **current** official access and terms before
writing code. Availability is not assumed by this design.

## Adding a provider (the whole checklist)

1. Verify official/public access and its legal terms. Stop if unclear.
2. Implement `ExternalJobProvider`: a descriptor (hosts, concurrency, request
   interval, staleness window, whether absence implies closure) and
   `fetchPage()` returning `NormalizedExternalJobInput[]`, `scopeKey`, and a
   `complete` flag it can actually justify.
3. Add it to `EXTERNAL_JOB_PROVIDERS` in the module. Nothing else changes — no
   ranking, no schema, no FX, no processor.
4. Tests: normalization against captured real payload shapes, plus the failure
   modes (429, 5xx, timeout, invalid JSON, malformed record, redirect).

`GreenhouseProvider` is the worked example for all four steps.

If step 2 needs a field the contract lacks, extend the contract — never leak a
vendor field past it.

## Ninehire

A first-class provider by construction: `ExternalProvider.NINEHIRE` exists, and
`normalizeNinehire` in `testing/fake-providers.ts` proves the most
structurally-different shape in the test suite (Korean field names, KRW annual
salary, a closing date, a career level) reaches the same contract with no
special-casing anywhere downstream. Its KRW salary is compared against a
candidate's USD range by the same matcher that handles internal vacancies.

Endpoints are deliberately not guessed. Implementation waits on verified
official access.

## Greenhouse (Task 4B.1)

The first real provider. Public job-board data only.

### The endpoints, verified live

```
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
      ?content=true&pay_transparency=true
GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{id}
```

No credential. No pagination — the whole board comes back in one response
alongside `meta.total`, which is what makes completeness CHECKABLE rather than
assumed: the provider claims a listing is complete only when the array length
equals the total the API itself reported.

The Harvest API — private candidate and recruiting data, behind a key — is a
different product and is not used, not configured, and has nowhere to be
configured. Greenhouse is a job SOURCE here: no applicants, no stages, no
offers, and no applications submitted back.

### Boards are configured, never discovered

`EXTERNAL_GREENHOUSE_BOARDS=token[:Label],...`. Board tokens are mostly company
names and would be trivial to enumerate; a sweep that guessed them would be
crawling other people's tenants because the URLs happen to resolve. The parser
refuses anything that is not a plain slug, since these values become part of a
request path.

Scheduled sweeps are OFF unless `EXTERNAL_SYNC_ENABLED=true` — a schedule is a
standing commitment to call someone else's servers. `npm run external:sync --
GREENHOUSE` runs one on demand. When the flag is off, boot also REMOVES any
repeatable a previous boot registered: a repeatable lives in Redis, not in the
process, and would otherwise outlive the decision to stop.

### What Greenhouse states, and what it does not

Stated, so mapped: title, company name, description, offices, free-text
location, application deadline, and — when the board enables pay transparency —
a salary range in **minor units** (`min_cents`).

Not stated, so left null: employment type, work arrangement, seniority, visa
sponsorship, languages, skills. `location.name` reads "Hybrid - London" and
"Remote, Italy"; deriving `HYBRID` or `REMOTE` from that is reading a
recruiter's label as a schema. `metadata` is per-board custom configuration —
across the boards this was built against it holds "Career Site Categories" and
"Quota Coverage Type", nothing an enum could read. Null means "the source did
not say", which costs a ranking signal and hides nothing.

The one derived value is the country, because Greenhouse writes it as a NAME
("United Kingdom") and `common/vacancy/country-names.ts` is an explicit
dictionary, not a guess. Unknown names stay null.

### Source identity is `board:postId`

A Greenhouse job id is unique within a board; the `(provider, sourceKey)`
constraint is global. Two boards colliding on an id would silently overwrite
one real job with another. `internal_job_id` is deliberately NOT used —
live data shows two differently-titled posts sharing one.

### The dedupe rule Greenhouse forced

Figma publishes seven separate requisitions that all fold to "account executive
enterprise"; GitLab publishes "Director, Support (Bengaluru)" beside "Director,
Support (EMEA)". Bracketed asides are folded out of titles and neither posting
states an office, so the fingerprint matches all of them.

But the provider already answered the question by issuing two ids. `assessMerge`
therefore refuses to merge a sighting whose provider already contributed a
source under a DIFFERENT key: a source that distinguishes two postings is
stating they are two postings, and that outranks any similarity we can compute.
Cross-provider dedupe is untouched.

### Absence, scoped and gated

A posting missing from a listing retires only when BOTH hold: the run
succeeded, and the provider proved the listing complete. Absence is judged per
BOARD (`ExternalJobSource.sourceScope`) — sweeping one board says nothing about
another, and a global diff would empty the catalogue the first time one board
was synced alone. Sources are marked GONE, never deleted, so a posting that
comes back goes live again.

## Lever (Task 4B.2)

The second real provider, and the proof the abstraction is real: adding it
changed no shared behaviour, no schema, no ranking and no FX. Two classes and
two entries in the module's providers array.

### The endpoints, verified live

```
GET https://api.lever.co/v0/postings/{site}?mode=json&skip=&limit=
GET https://api.lever.co/v0/postings/{site}/{id}?mode=json
```

No credential — verified live against three sites. Only the `POST .../{id}?key=`
apply endpoint takes a key, and this product never posts. The authenticated
Lever API (candidates, opportunities, requisitions, stages, internal and draft
postings) is a different product and is not used. The public API returns
published postings only, so "public" is enforced by Lever rather than filtered
by us.

### Pagination, and what it costs

Lever pages with `skip`/`limit` — OFFSET pagination over a live list. Delete a
posting between page 1 and page 3 and everything after it shifts up by one, so
a posting is never returned. It would then look absent, and absence is what
retires a job.

So **a listing is complete only when the whole site arrived in ONE request**.
That response is an atomic snapshot and its absences are real. A site that
needed a second page reports `complete: false`; its postings are still ingested
and refreshed, nothing is ever retired from it, and anything that truly vanishes
ages to STALE. Live, that splits the configured sites cleanly: two single-page
sites can retire, one 811-posting site cannot.

### What Lever states that Greenhouse does not

`country` (already ISO alpha-2), `workplaceType`, `categories.commitment` and
`salaryRange{min,max,currency,interval}`. All mapped, because mapping a STATED
field is not a guess. The line is unchanged — a structured field is read, prose
never is — it just falls in a different place.

Two things Lever's own vocabulary cannot decide:

- **`commitment` is tenant free text, not a vendor enum.** Live values across
  three sites: `Full-time`, `Full Time`, `Temp Full-time`, `Fixed Term`,
  `Apprenticeship`, `Full Time/Part Time`. The shared dictionary in
  `vocabulary.ts` maps what it recognizes and returns null for the rest. A
  value with two answers in it gets no answer — mapping `Full Time/Part Time`
  to FULL_TIME would hide the job from everyone filtering for part-time work.
- **`interval` includes periods the enum cannot express** (`bi-week-salary`).
  The amounts are kept and the period is null. Annualising by 26 would turn a
  stated fact into a derived one and store it as the employer's word.

### Salary units differ per provider, deliberately

Greenhouse sends `min_cents`; Lever sends major units. The shared schema stores
one meaning and each provider is responsible for producing it. That is the
clearest argument for provider-owned mapping there is.

### Location

The country comes from Lever's own field. The city is refused in two cases:
a posting open in several places (`allLocations` > 1 — the schema holds one
city and picking the first invents certainty) and a label carrying an
alternative ("New York, NY or Remote", "London / Berlin", "EMEA"). Precision is
lost; nothing false is stored.

## Cross-provider dedupe

Both providers write into one identity space, and a job seen through both
produces one `ExternalJob` with two `ExternalJobSource` rows — when the
evidence reaches EXACT or HIGH. Nothing is lowered to make that happen.

Against the live catalogue the honest answer is **zero natural cross-provider
merges**: no configured company publishes on both ATSs. What the data does show
is the value of refusing weak evidence — three folded titles
("senior backend engineer", "data engineer", "director data science") appear
across both providers at DIFFERENT companies, and a title-based rule would have
merged four unrelated jobs into one.

## Ashby (Task 4B.3)

The third provider, and the one that made refusing data harder than accepting
it.

### The endpoint, verified live

```
GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
```

No credential — verified live against seven boards. No pagination: the whole
board arrives in one response, so a well-formed response IS a complete
snapshot. Ashby's authenticated RPC API (`jobPosting.list`, candidates,
applications, offers) is a different product and is not used.

Two things differ from the published docs, both found by reading real
responses: **`id` exists on every posting** (584/584) though the documented
shape omits it — which is what makes a stable source identity possible without
parsing URLs — and **`descriptionPlain` is not reliably plain** (13 of 584
contained angle brackets), so it goes through the same extractor as the HTML.

### `isListed` — the rule that makes Ashby different

Greenhouse and Lever return only what is published. Ashby returns postings with
an `isListed` flag, where `false` means "reachable by direct link but not to be
shown in a public listing". Those are dropped at the PROVIDER boundary and
never reach ingestion.

That placement is the design. A delisted posting simply stops appearing in a
complete snapshot, so the existing absence rule retires its source as **GONE**
and the job becomes **UNAVAILABLE** — never CLOSED, which would claim the
employer ended a role they may still be quietly hiring for. No Ashby-only
status was needed, nothing is deleted, and a re-listed posting goes ACTIVE
again.

### Compensation — only a salary is a salary

Live boards return five component types: `Salary`, `Bonus`, `Commission`,
`EquityPercentage` and `EquityCashValue`. Only `Salary` may populate the salary
columns. The clearest argument for that rule is a real posting whose
`EquityPercentage` maximum is **0.16** — allowed into the salary column, that
job would advertise a salary of sixteen pence.

`summaryComponents` is Ashby's own roll-up across market tiers and holds at
most one `Salary` entry (313 of 584 have exactly one, 271 have none, never
two). Reading it is reading a figure Ashby publishes on the posting itself.

**But multi-currency tiers produce no salary at all.** 98 live postings carry
several market tiers, 97 with different ranges and 30 with different
currencies. When a posting says "CAD in Toronto, USD in New York", the roll-up
keeps one currency and drops the other — fine as a headline beside the tiers,
wrong as the single band this schema stores, because a Canadian candidate would
then be matched against a US figure with nothing to show it had happened.

Live outcome across four boards: 221 salaries kept, 113 refused — 82 stating no
salary component, 30 spanning several currencies, 1 in a currency this product
cannot compare.

### Work mode: `workplaceType` decides, `isRemote` never does

`isRemote: true` sits beside `workplaceType: "Hybrid"` on **231 of 584** live
postings, so the boolean plainly does not mean "fully remote". The documented
structured field is authoritative and the boolean is never consulted. No
warning is logged for the disagreement: at 40% of the catalogue that would be
noise, not a signal.

### Multi-location

Ashby is the first provider with structured `secondaryLocations`, on 248 of 584
postings. The canonical columns hold one city, so `ExternalJob.additionalLocations`
(additive, provider-neutral, JSON) keeps the rest — a posting open in Portugal
plus eleven other countries stores all twelve rather than pretending it is only
in the first.

Nothing queries it yet. It exists so Task 4C can, rather than discovering the
data was discarded three tasks ago: a location filter built on the primary city
alone would silently exclude candidates the employer would have hired.

Address parsing refuses three things live data contains: an empty-string
locality (119 postings), a country that is not one ("European Union", 22), and
a locality that merely repeats the country (5).

## Ninehire (Task 4B.4)

The fourth provider, and the first that is **authenticated**.

### The endpoints, verified against the official documentation

```
GET https://api.ninehire.com/api/v1/jobs?page=&countPerPage=
GET https://api.ninehire.com/api/v1/jobs/{jobId}
Authorization: Bearer {API_KEY}
```

The key is issued **per workspace** (설정 → 외부 서비스 연동 → 데이터 → API) and
the feature is on the Enterprise plan. There is no public read path — an
unauthenticated call returns `401 {"message":"authentication must be exist"}`,
which is the only request this repository has ever made against the host.

**Rate limit: 60 requests per minute per key, aggregated across every
endpoint** — list and detail come out of the same budget. No rate-limit headers
and no usage endpoint exist, so the provider stays under it by construction: a
separate HTTP client per credential at one request per second.

### Access is authorization, not configuration

Greenhouse, Lever and Ashby read public boards; the only question is which. A
Ninehire workspace is readable only when an operator entitled to it supplies
its key, so there is no discovery, no enumeration, no public fallback and no
scraping of `career.ninehire.com`. A workspace with no configured credential
does not exist as far as this code is concerned.

`EXTERNAL_NINEHIRE_SOURCES=acme:NINEHIRE_KEY_ACME` names an **environment
variable**, never a secret. The value is read at request time, attached to one
Authorization header, and never stored on the client, in a queue payload, in
the database, in `.env.example` or in a log line — enforced by
`credential-safety.spec.ts`, which reads the source tree rather than trusting
a convention. A source whose variable is unset is **dropped at construction**:
a source that can only ever 401 is worse than no source, because it fails on a
schedule forever and teaches whoever reads the logs to ignore them.

### The first explicit closure any provider has given

`status` has four documented values, and the distinction they allow is one the
other three providers simply cannot express:

| status | meaning | handling |
| --- | --- | --- |
| `in_progress` | 모집 중 — recruiting | ingested, candidate-listable |
| `closed` | 채용 마감됨 — hiring closed | ingested, `closedAtSource: true` → **CLOSED** |
| `disabled` | 모집 중단 — paused, hiring continues | not ingested → absence → UNAVAILABLE |
| `archived` | 보관됨 — archived | not ingested → absence → UNAVAILABLE |

`disabled` and `archived` are dropped rather than flagged, because neither is a
closure: the employer stopped SHOWING the role, not ended it. Private postings
are never even requested (`includePrivate=false`) — not asking is a stronger
guarantee than filtering, since unauthorized data is never received.

### `deadline` → `expiresAt`, and a bug it exposed

Ninehire is the first provider to populate `expiresAt`, and doing so surfaced a
latent defect in the Task 4A ingestion layer: `createJob` wrote a provisional
ACTIVE/CLOSED and only the UPDATE path reconciled status, so a posting whose
deadline had already passed was stored ACTIVE and stayed there until some later
sweep touched it. Newly-created jobs are now reconciled too, so
`resolveJobStatus` owns the status in one place.

**Precedence:** a passed deadline yields EXPIRED even when `status` still says
`in_progress`. A date is a specific commitment the employer published; a status
flag is a default they may simply not have updated. Both outcomes are outside
the current universe, so the candidate-facing effect is identical — but EXPIRED
is the honest reading.

### Korean data

Titles, descriptions, regions and cities are stored verbatim as Unicode.
Nothing is translated, romanized or forced through an English taxonomy.
`common/vacancy/korean-address.ts` is a provider-neutral prefix table over the
seventeen 시/도: a match at the START of an address proves the country, and the
city is the next token only when it ends in 시/군/구. "부산지사" (Busan *branch*)
is a site label and never becomes a city.

**Canonical language:** the workspace's own default (Korean). `language=english`
would return a different representation of the SAME posting, not a second job,
so it is not requested — one canonical language rather than a multilingual
description model no other provider needs.

### What is deliberately not mapped

- **Salary.** The API exposes no compensation field on either endpoint,
  verified against both official field tables. Every Ninehire job competes
  without a pay signal, which is neutral rather than disqualifying. (The Task
  4A fixture that suggested otherwise was a structural stand-in.)
- **Seniority.** `career` is irrelevant/experienced/newcomer and `careerRange`
  is a span of years. "experienced" means prior experience is *required*, not
  that the role is senior; 신입 is a hiring track, not a rung.
- **Employment type, when multi-valued or Korean-specific.** The source states
  an array and the schema holds one, so two values means none. `freelancer`,
  `dispatched` (파견직), `day_labor` (일용직) and `trainee` (교육생) have no home
  in the enum and are left null — rounding 파견직 to CONTRACT would tell a
  candidate they are hired by the company they would actually be dispatched to.
- **`jobGroup` / `jobTask` / `tags`.** 개발팀 is a development TEAM, not an
  industry; tags are arbitrary workspace labels.
- **Coordinates.** `x`/`y` are longitude and latitude (confirmed against the
  documented Busan sample) and are read but not stored: no column, no consumer.

### Multi-location

`jobLocations` is an array, making Ninehire the second provider — after Ashby —
to prove multi-location is generic rather than a quirk. The first site is
primary; the rest go to `additionalLocations`. None is discarded.

## Company careers pages (Task 4B.5)

The fifth provider, and the first one whose point is not new jobs but a second
witness to jobs already held.

### Why it exists

Four ATS integrations produced **zero** cross-provider merges, and that was the
right answer: employers buy one ATS, so the same requisition is almost never
published through two of them. The duplicate that genuinely occurs is a
company's own careers page and the ATS behind it —

```
ExternalJob  Engineering Manager, CDN
  ├ COMPANY_CAREERS  company.example/careers/engineering-manager-cdn-570…
  └ GREENHOUSE       job-boards.greenhouse.io/company/jobs/570…
```

— and it is the one worth resolving, because it is where "who published this"
and "where do I apply" stop being the same answer.

### Sources are a code catalogue, selected by id

`EXTERNAL_COMPANY_CAREERS_SOURCES` holds **ids**, never URLs:

```
EXTERNAL_COMPANY_CAREERS_SOURCES=vercel-careers,linear-careers
```

Each id resolves in `company-careers.catalogue.ts`, which carries the site's
access review — robots rules, how the page serves its jobs, and the verdict.
An unknown id is dropped; a URL pasted there is simply an unknown id. Every
other provider takes a tenant slug and pastes it into a fixed vendor URL, so a
bad value 404s; a careers source is a whole URL on an unvetted host, and an
environment variable that reaches `fetch` is an SSRF primitive on a six-hour
timer. Enabling a company is a reviewed code change.

### Three permissions, in order

1. **robots.txt**, fetched live per host and honoured per path, under
   `HRCopilotJobBot`. A missing file means no rules were stated; a refusal is
   respected rather than worked around.
2. **The source's own host+path allowlist**, applied to the first URL and to
   every redirect hop. This caught a live case on the first run:
   `vercel.com/sitemap.xml` 301s to `/crawled-sitemap.xml` — same host,
   undeclared path.
3. **The address**, via `SafeHttpFetcher`: DNS resolved once, every returned
   address classified, the socket pinned to the vetted one. That is what closes
   DNS rebinding, and it is why this provider borrows the candidate-link
   fetcher rather than the ATS HTTP client.

### Extraction is deterministic, and reads nothing fragile

Priority: schema.org `JobPosting` JSON-LD, then standardized document metadata
(`og:title`, `og:url`, `<title>`, `<h1>`, `<a href>`), then nothing. No class
names — Linear's job rows carry `class="X2WvJq_jobRow"`, a content hash
regenerated every deploy. No model: extraction is reproducible and auditable,
and merging or retiring a job on a model's reading is what this architecture
exists to refuse.

**Eleven live careers pages were checked and not one published a
`JobPosting`.** They publish `Organization`, `WebSite`, `Article` and
`BreadcrumbList` — so the JSON-LD reader is fully tested and currently
unexercised in production, which is stated rather than hidden.

### A sighting must state more than its own link

`statesMoreThanItsOwnLink` refuses a page that yields only a title and its own
URL. Such a sighting cannot be tied to a requisition, so it can never join the
ATS sighting of the same role, and the only row it can become is a second copy
of a job already in the catalogue.

Found live, not theorised: the first real run created 47 such rows and two
duplicate company records before the rule existed.

### URL identity is the merge evidence

A company page and its ATS agree on almost nothing a fingerprint can use — the
company name is written differently, the titles are edited, the locations
disagree ("North America" against `addressCountry: USA`). What they agree on
exactly is the apply URL, because it is the same form. So ingestion falls back
from the fingerprint to an **indexed** lookup on `ExternalJobSource.urlKeys`.

Canonicalization is `buildNormalizedIdentity`, shared with candidate links.
It drops scheme, host case, `www.`, a default port, a fragment, a trailing
slash and **known** tracking parameters — and keeps everything else, because
`?gh_jid=` (live on Figma's careers page) IS the Greenhouse requisition id.
Path case is preserved: Linear publishes `jobs.ashbyhq.com/Linear/{id}` while
the Ashby API answers `/linear/{id}` for the same posting, and folding case to
fix that would merge distinct paths on every case-sensitive server. That pair
is recorded as POSSIBLE with a reason naming the cause.

The shared-URL tier outranks the same-provider-different-id refusal, because
Vercel publishes three careers URLs carrying one Greenhouse requisition: the
employer's own id answers "how many postings" directly, and the same-provider
rule is only a proxy for it.

### One job, several sightings

`reconcileJob` now re-derives a job's FACTS from every source that stated any,
using the existing rule — stated beats silence, then trust, then freshness —
reading `ExternalJobSource.claims`. That column stores validated normalized
facts only: no raw page, no raw payload. A source row with no claims is
treated as unknown rather than silent, so a deployment cannot blank a
catalogue on its first sweep.

Source trust decides the canonical URL and field conflicts and **nothing** a
candidate is ranked by.

### Completeness, and the state today

Both researched sources report `complete: false` for measured reasons: Vercel's
sitemap lists 22 career URLs against 83 open roles; Linear's index renders one
row per title while seven titles are open twice. Neither may retire anything.

**Every catalogue entry is currently reviewed OFF**, each recording why:

| source | finding |
|---|---|
| `vercel-careers` | readable and permitted; the Apply link exists only in the hydration payload, so every page yields a bare title |
| `linear-careers` | same; the stated locations are continents ("North America", "Europe") |
| `figma-careers` | 164 real Greenhouse anchors, but robots.txt gives `Disallow: /` to GPTBot, ClaudeBot, CCBot, Google-Extended and others; the board is already ingested through the official API |
| `ramp-careers` | no company-owned job pages; the list is a verbatim copy of the Ashby API inside an RSC payload |

So **live cross-provider merges remain 0**, and thresholds were not lowered to
change that. The merge, the multi-source lifecycle and the ATS-migration
behaviour are proven against the real database by
`npm run external:company-careers`.

## Candidate external search (Task 4C.1)

The first candidate-facing read path over the external catalogue. Backend
only — there is no UI for it yet.

```
saved preferences + this request
  → resolved intent            (the SHARED resolver, same as Find Jobs)
  → hard scope                 (text query + explicit countries, nothing else)
  → indexed retrieval          (Postgres lexical ∪ Qdrant semantic, bounded)
  → PostgreSQL revalidation    ← the only authority on existence
  → deterministic ranking      (shared matchers + a versioned search policy)
  → stored snapshot            ← the only thing pagination reads
```

`POST /candidate-account/me/external-jobs/search`, `@CandidateScoped`. No
account id appears in any path, body or query — the subject is always the
caller — and the DTO has no `provider` field, deliberately: a job seeker does
not know which ATS published a role, and offering the filter would imply some
ATSs carry better jobs.

### Hard and soft

| Input | Effect |
|---|---|
| text query | **HARD** — decides which jobs are in the search |
| `countries` in THIS request | **HARD** — the only location filter |
| candidate's own exclusions | **HARD** — removals they asked for by name |
| saved country / work mode / employment / seniority / salary | **SOFT** — order only |

A saved city must never quietly filter a search. That bug was found and fixed
once on the internal side; the split above is what keeps it fixed here.

### Scale: the funnel, not the catalogue

Every stage is an indexed, LIMITed query, so a search costs O(K log N) rather
than O(N). There is no path that loads the ACTIVE set into memory and sorts it.

The lexical stage is a UNION of independently-indexed branches rather than one
`OR`, because a query whose safety depends on table statistics is not safe:
measured at 1,775 rows, PostgreSQL answers the `OR` form by filtering the whole
table, which is the right choice now and catastrophic later.

Measured plans (`EXPLAIN ANALYZE`, live catalogue):

| Stage | Index | Time |
|---|---|---|
| universe revision | `external_jobs_status_searchableUpdatedAt_idx` | 0.7 ms |
| full-text | `external_jobs_searchDocument_idx` (GIN) | 11 ms |
| trigram, incl. `개발자` | `external_jobs_title_idx` (GIN trgm) | 0.2 ms |
| company name | `external_companies_name_idx` (GIN trgm) | 0.3 ms |
| location + additionalLocations | BitmapOr of 3 indexes | 0.8 ms |
| revalidation | `external_jobs_pkey` | — |
| index lag | `external_jobs_searchIndexedAt_idx` | 0.07 ms |

### Text: `simple` + trigram, because there is no Korean config

PostgreSQL ships **no Korean text-search configuration** — verified, 28
languages and Korean is not one. `simple` does tokenize Hangul on whitespace
(`백엔드 개발자` → two lexemes) but cannot handle agglutination: `개발자를`
does not match a search for `개발자`. Trigrams have no language model at all,
which is exactly why they cover the gap —
`word_similarity('개발자','백엔드 개발자 채용') = 1.0`.

`searchDocument` is a **generated** column, weighted A title / B place / C the
first 8,000 characters of the description, so `ts_rank_cd` ranks a job CALLED
"Backend Engineer" above one whose description merely mentions backend
engineers. Company name is not in it — it lives on another table, so company
matching is its own trigram lookup.

Note `plainto_tsquery` is AND semantics: a three-word query requires all three
words. The trigram and semantic branches are what soften that.

### Qdrant is an accelerator and nothing else

Collection `external_jobs_v1` — **one point per canonical ExternalJob**, not
per source, so a job with a careers page and an ATS row is one result rather
than two. 384-dim, cosine, the same local multilingual model
(`paraphrase-multilingual-MiniLM-L12-v2`) the rest of the product uses. No
external API, no generation, and no field is invented: the indexed text is
title, company, place, work mode, employment type, seniority and description,
all of them stored facts.

Provider, trust class and source count are **not** in the indexed text. A job
is not a better answer because of where it was found.

Three failure modes, all proven live:

- **stale point** — job CLOSED in Postgres, point still present and still
  saying ACTIVE. Revalidation excludes it.
- **missing point** — job never indexed. The lexical branch still finds it.
- **outage** — Qdrant unreachable. The search returns results and reports
  `degraded: true`.

Indexing is a bounded background pass keyed on `searchIndexedAt <
searchableUpdatedAt`, so a provider sweep that merely re-observed a posting
does not re-embed the catalogue. Ingestion never blocks on it.

### Snapshots

`CandidateExternalSearchRun` + `Entry`, keyed
`(candidateAccountId, requestFingerprint)`. The fingerprint covers the request,
the candidate's CURRENT intent, the universe revision and the algorithm
version — so Rule N1 reaches the cache: editing or deleting preferences makes
the old snapshot unreachable, not merely unused.

The stored list is bounded by the FUNNEL, not the catalogue, so a run holds
hundreds of rows whether the catalogue has a thousand jobs or a million.

The universe revision is `count + max(searchableUpdatedAt)` over the current
universe — two index lookups, not a hash of the catalogue. `searchableUpdatedAt`
moves only when a field a searcher could notice actually changes; `updatedAt`
would move on every sweep and invalidate every stored search several times a
day.

Two counts, deliberately: `total` is what pagination covers, `matched` is how
many jobs answer the filters. They differ when the funnel truncated — and
occasionally in the other direction, because semantic retrieval can propose a
relevant job whose text does not contain the query.

### Scoring

`external-search-v1`, its own version — AI Job Match answers a different
question and the two must be free to change apart.

```
score = 0.6 × text relevance + 0.4 × soft alignment
```

Capability plays no part: a candidate searching "Accountant" must not be shown
engineering roles because their resume is full of engineering evidence. Null
and 0 differ on both inputs — no query is not "answered nothing", and no
preferences is not "matched nothing".

A semantic-only hit is capped at 0.85 of a lexical match, so an embedding's
nearest neighbour cannot outrank a job literally titled what was searched for.

Order: score → text → intent → firstSeenAt → id. `firstSeenAt` breaks ties only
and is never scored: no provider states when an employer published a role, and
`lastSeenAt` is crawler freshness, so ranking by it would sort employers by how
recently our own sweep ran.

### A Prisma trap worth knowing

Four GIN indexes were created in migration SQL with descriptive names
(`..._trgm_idx`) that Prisma's naming convention would never produce. Prisma
read them as objects it did not own, and the next `prisma migrate dev` emitted
a `DROP` for every one — then failed on an unrelated statement, having already
dropped them. Every search silently became a sequential scan and nothing
reported an error.

They are now declared in `schema.prisma` with `@@index(..., type: Gin)` and
`ops: raw("gin_trgm_ops")`, under the names Prisma generates, and
`searchDocument` carries `@default(dbgenerated())` so Prisma stops trying to
drop its generation expression. `prisma migrate diff` against the live database
is empty.

## The candidate screen (Task 4C.2)

`/external-jobs`, in the job-seeker workspace, directly beneath Find jobs. Two
separate navigation entries rather than one merged board: applying to an HR
Copilot role happens inside the product and applying to an external one happens
on the employer's site, and a single list would have to hide that behind one
button. The page carries a tab strip back to `/jobs`; the internal board itself
was not edited.

### The search lives in the URL

`/external-jobs?search=…&countries=…&workModes=…&page=…`, read and validated by
`lib/candidate/external-job-filters.ts`, rendered on the server. A search can be
shared, bookmarked and reached again with the back button, and the ranking a
reader sees comes from the same code path whether they typed it, paged to it or
reloaded it.

It also removes a class of bug outright: with no client-side fetch there is no
response to arrive out of order, because the router supersedes the earlier
navigation. The one place that genuinely fetches — the detail panel — carries
its own identity guard (`lib/candidate/latest-request.ts`), so opening job A
then job B can never show A's description under B's title.

A URL is user input, so every parameter is validated before it reaches the API:
unknown enum values are dropped, countries must be ISO 3166-1 alpha-2, the page
must be a positive integer, the query is capped at the 200 characters the DTO
accepts. A hand-edited link produces a narrower search, never an error page.

Nothing private travels in the URL. Saved preferences stay on the backend,
which resolves them per request — a shareable link must not carry someone's
salary expectations to whoever they send it to.

### Filter versus preference, said in the interface

Country is labelled **Filter**. Work arrangement, employment type, experience
and pay are labelled **Preference**. That is not decoration: the first removes
jobs and the others only reorder them, and calling all five "filters" would be
the interface lying about what a tick does. A reader who believes four ticks
each narrowed the list concludes the catalogue holds four jobs when it holds
hundreds.

### What the UI is not allowed to say

Every display decision lives in pure functions in
`lib/candidate/external-job-presentation.ts` so the honesty rules can be tested
without a browser:

- **Remote is not worldwide.** `workMode: REMOTE` with an empty
  `remoteCountriesAllowed` renders as "countries not stated". The words
  "worldwide" and "anywhere" do not exist in any of the four dictionaries, and
  a test asserts that.
- **An unposted salary is not zero.** No `$0`, no `N/A` in a money-shaped slot
  — "Salary not provided", which is what the employer said.
- **No frontend FX.** The contract exposes no converted display amount for
  external jobs, so none is shown and none is computed. A second exchange rate
  in the product would disagree with the first at the worst possible moment.
- **The score is not a probability.** It is a number and a band word, never a
  progress bar or a percentage, and the note beside it says outright that it is
  not a chance of being hired — in all four languages.
- **Reason codes are localized, never printed.** `jobMatch.matchReason` for the
  shared alignment verdicts (so the same verdict reads the same way on both
  screens) and `externalJobs.reason` for the text-relevance family. An
  unrecognised code is dropped, so a backend that adds one tomorrow cannot make
  an older frontend print `SALARY_FOO_BAR` on a job card.
- **`STALE` is about our crawl.** "Listing may need re-verification", never
  "posted a while ago" — no provider states when an employer published a role.
- **Provenance is transparency, not ranking.** "Source: Company careers",
  "Apply via: Greenhouse", "Listed by 2 sources". No trust score, no provider
  ordering, and `sourceCount` is displayed and never scored.

### Counts

The result line uses `matched` — how many jobs answer the filters — and
pagination uses `total`, what the snapshot actually ranked. Paging off the
larger number would offer pages the API answers with nothing.

### Two additive backend changes

`remoteCountriesAllowed` joined the search result, because a card that renders
`REMOTE` alone must choose between saying nothing about where and implying
anywhere, and the second is a claim no source made.

`GET /candidate-account/me/external-jobs/:id` (`ExternalJobDetailService`) reads
one job in full for the detail panel. A description can be twenty thousand
characters; twenty of them in every page of results is a payload two orders of
magnitude larger than the ranking it exists to convey. It takes no ranking
input and returns no score, band or reason — personalization belongs to the
search, which is the only call that knows who is asking — and it obeys the same
`ACTIVE | STALE` universe rule, so a job that closed is a 404 rather than a
rendered page with a dead Apply button.

Neither change touches retrieval, scoring, the snapshot or the algorithm
version.

### Applying

`target="_blank" rel="noopener noreferrer"` on the stored, provider-validated
canonical URL. `noopener` denies the employer's page a handle on the tab the
candidate came from; `noreferrer` keeps their search terms out of the
employer's referrer logs. The adapter refuses anything that is not an absolute
`http(s)` URL, so a `javascript:` or relative href leaves the card with no
Apply button rather than a dangerous one. No `Application` row is created — the
reader is told, before they leave, that this product does not receive the
application and cannot track it.

### Verifying it

`npm run external:ui-verify` signs in as a throwaway candidate, asks the real
page for HTML over the real stack and reads what a browser would have been
given — 106 checks. It asserts on the DISPLAYED markup, with `<script>` blocks
stripped: a React Server Components page ships the whole active dictionary in
its flight payload, so searching the raw document for a reason code finds the
dictionary key and reports a leak no reader could ever see.

## The employer's posting date (Task 4C.3)

### The audit, provider by provider

Every mapping below rests on a live payload plus the official documentation,
inspected for this task rather than remembered:

| Provider | Field | What it means | Documented | Live coverage | Used |
|---|---|---|---|---|---|
| Greenhouse | `first_published` | first publication to the board | in the official example response, never described | 255/255 across two boards | **yes** — FIRST_PUBLISHED |
| Greenhouse | `updated_at` | last modification | example only | 100% | **never** |
| Lever | `createdAt` (epoch ms) | posting record creation | **absent from the official field reference** | 942/942 | **no** |
| Ashby | `publishedAt` | "ISO DateTime when the job was last published" | documented | 334/334 | **yes** — LAST_PUBLISHED |
| Ninehire | `createdAt` | posting record creation | in the documented field table | no live key | **no** |
| Company careers | JSON-LD `datePosted` | schema.org: the date the employer posted the job | specified | fixture only | **yes** — DATE_POSTED |
| Company careers | `dateModified` | an edit | specified | — | **never** |

Greenhouse's field is the interesting judgement. It is undescribed, so the
mapping rests on the name plus a measurement: across 255 live postings it was
present on every one, identical on the list and detail endpoints, and **never
later than `updated_at`** — exactly the invariant a "first published" field
must satisfy against a "last modified" one.

Lever's is the interesting refusal. It costs 53% of the catalogue, and it is
still right: `createdAt` describes when a posting RECORD was created, drafts
included, and Lever's own repository carries an open issue asking what the
field means. A confident "Posted 3 days ago" computed from an undefined number
is worse than no date, because a reader cannot tell the two apart.

### One canonical field

`ExternalJob.employerPostedAt` — "the instant the employer's own source states
this listing was published". Not `createdAt` (a database row), not
`firstSeenAt` (our crawler's first sighting), not `lastSeenAt` (its most
recent one).

Providers do not write it. They state a claim — `{ at, semantics }` — on their
own `ExternalJobSource.claims`, and `resolveClaims` derives the canonical value
using the project's existing conflict policy: **stated beats silence, then
source trust, then freshness.** Never the earliest, the latest or an average of
two disagreeing sources; each of those would be a date nobody published.

`semantics` travels with the timestamp because the providers genuinely differ —
Greenhouse names the FIRST publication, Ashby the LAST. For a listing published
once, which is nearly all of them, they are the same instant; they diverge only
on republication, which no provider here flags. Recording which one a claim
used keeps that nuance auditable rather than pretending to a precision the
sources do not offer.

### Validation

`publicationDate()` refuses a value more than **48 hours** ahead of now — a
provider defect rendered as "Posted in 3 days" is worse than no date, and the
window absorbs date-line and clock skew. It refuses anything before 1990, the
floor the deadline parser already justifies. It does not refuse old postings:
the live catalogue's oldest genuine date is April 2021, and age is not a reason
to discard a fact.

A bare `YYYY-MM-DD` is anchored at **12:00 UTC**, so the employer's calendar
date survives rendering from UTC-11 to UTC+12. No DATE/DATETIME precision
column exists, because no live provider sends a date-only value.

### No backfill

Existing rows started NULL and were filled by re-syncing Ashby and Greenhouse
through the ordinary provider path. Nothing was derived in SQL from
`firstSeenAt` or `createdAt`; the whole point of the field is that it is the
employer's statement, and a manufactured one would be indistinguishable from a
real one forever after.

Live coverage after the resync: **Ashby 334/334, Greenhouse 499/499, Lever
0/942 — 833 of 1,775 (47%).** Every dated job's `employerPostedAt` precedes its
`firstSeenAt`; none equals `firstSeenAt` or `lastSeenAt`.

### A bug this exposed

The "unmerged duplicate" ingestion path — a sighting kept separate because a
merge could not be corroborated — touched its source row on every sweep and
never called `reconcileJob`. Its canonical facts froze at creation. Invisible
until now, because the fields it writes rarely change; `employerPostedAt` made
it visible because it is the first canonical field that starts null for every
row and can only be filled by a reconcile. Four Ashby jobs sat dateless through
two full syncs with the date sitting in their own source claims. One line.

### Sorting

`sort: RELEVANCE | NEWEST`, default RELEVANCE, a closed enum at the DTO that
is branched on explicitly — the string never reaches SQL.

NEWEST orders: **dated before undated → `employerPostedAt` DESC → the relevance
comparison as a tie-break** (which ends on the id, so the order is total and
pagination cannot repeat or lose a job). Undated jobs keep their place at the
end rather than being dropped or given an invented date.

It takes a different retrieval path, and that is the point: asking the relevance
funnel for the newest returns the newest of the 300 most relevant, silently
missing the job posted this morning. `newestCandidates` reads the date index
directly, one branch per status — `status = ANY(...)` cannot produce ordered
output from a per-status index, so two branches keep each an ordered `Index
Scan` that stops at its own LIMIT, merged by an incremental sort.

NEWEST also skips semantic retrieval entirely (so it never runs degraded) and
reports `textScore: null` rather than 0 — nothing measured how well each job
answers the query, and zero would state that they answer it badly.

Relevance ranking is untouched: same weights, same threshold, same candidate K,
same `external-search-v1`.

### What invalidates a stored search

`employerPostedAt` joined `SEARCHABLE_SELECT`, so a newly learned or changed
date bumps `searchableUpdatedAt` and invalidates the runs that would now order
differently. A sweep that re-observes 334 postings and changes nothing bumps
nothing — verified live: `max(searchableUpdatedAt)` was identical before and
after a full Ashby re-sync.

The sort is part of the request fingerprint, so RELEVANCE and NEWEST can never
share a snapshot.

### Known limitation

The snapshot caps at 500 ranked results. With 833 dated jobs, a **no-query**
newest browse fills all 500 with dated jobs, so the 942 undated ones are beyond
the cap and unreachable in that particular view. `truncated: true` says so, and
any narrower search reaches them normally. This is the same cap relevance has;
it is more visible here because the exclusion is systematic rather than
"the weakest matches".

## Saved jobs and apply tracking (Task 4C.4 / 4C.5) — API CONTRACT

This section is the authoritative contract for the frontend. Every route is
candidate-scoped (`@CandidateScoped`): the subject is ALWAYS the authenticated
candidate, no account id ever appears in a path, body or query, and an
organization token is refused. All routes live under the global `/api` prefix.

**Since Task 4C.5.1 the ENTIRE external workspace — search, detail, save,
saved list, tracking — is the MAX product.** A FREE or PRO candidate gets:

```
403 { "code": "PLAN_UPGRADE_REQUIRED", "requiredPlan": "MAX",
      "capability": "EXTERNAL_AI_SEARCH", … }
```

and the internal AI Job Match answers the same with `requiredPlan: "PRO"`,
`capability: "INTERNAL_AI_SEARCH"`. Switch on those fields, never on message
text. Full plan model: `docs/candidate-plans.md`.

### The two concepts, and the wall between them

**Saved** is a bookmark. **Application tracking** is the candidate's own record
that they applied on the employer's site. They are independent: saving never
creates a tracker, tracking never saves, unsaving never touches a tracker.
Neither one is, or ever becomes, an internal `Application` — applying to an
external job happens on the external site, and clicking Apply changes nothing
in this database.

Nothing in tracking is ever set by the system. No provider signal, lifecycle
event, or link click may create or advance a tracker: "the candidate opened a
page" is not "the candidate applied". The frontend may OFFER "Mark as applied"
next to the external link; only that explicit action calls the API.

### Enum

```
ExternalApplicationStatus = APPLIED | INTERVIEW | OFFER | REJECTED | WITHDRAWN
```

Self-reported stages only; there is deliberately no HIRED. No transition rules
are enforced — this is the candidate's personal notebook and they may correct
any entry to any value.

### Saved endpoints

```
POST   /candidate-account/me/external-jobs/:externalJobId/save
  → 200 { "externalJobId": "…", "saved": true,  "savedAt": "ISO" }
  Idempotent: saving twice returns the SAME savedAt, creates nothing.
  404 { message: "External job not found" } for an id that is not an ExternalJob.

DELETE /candidate-account/me/external-jobs/:externalJobId/save
  → 200 { "externalJobId": "…", "saved": false }
  Idempotent: unsaving a job that was never saved is the same 200.

GET    /candidate-account/me/external-jobs/saved?page=1&pageSize=20
  → 200 {
      "page": 1, "pageSize": 20, "total": <all saved rows>,
      "asOf": "ISO",
      "results": [ {
        "savedAt": "ISO",
        "externalJobId", "title", "company", "companyWebsiteUrl",
        "status",            // ANY ExternalJobStatus — see lifecycle below
        "location": { countryCode, region, city },
        "additionalLocations", "workMode", "remoteCountriesAllowed",
        "employmentType", "seniorityLevel",
        "salary": { min, max, currency, payPeriod },
        "employerPostedAt",  // ISO or null, employer-stated only
        "applyUrl",          // stored provider URL or null
        "provenance": { primarySource, applyVia, sourceCount },
        "applicationTracking": { id, status, appliedAt } | null
      } ]
    }
  Ordering: savedAt DESC, id ASC. pageSize max 100.
```

**Lifecycle honesty:** the saved list is the ONE candidate surface that shows
non-current jobs. A saved job that has since become CLOSED / EXPIRED /
UNAVAILABLE stays in the list with its real `status` — the bookmark is the
candidate's and does not evaporate because the listing did. Render the status
honestly; do not offer the detail view for non-current statuses (detail below
still 404s them) and expect Apply to be dead. `GET …/external-jobs/saved` must
be requested with the literal path segment `saved` — it is registered above the
`:externalJobId` route.

### Tracking endpoints

```
POST   /candidate-account/me/external-jobs/:externalJobId/application
  Body: { "status"?: ExternalApplicationStatus = APPLIED,
          "appliedAt"?: "ISO",   // defaults to now; must not be in the future
          "note"?: string }      // ≤ 2000 chars; empty ⇒ null
  → 201 { "id", "externalJobId", "status", "appliedAt", "note",
          "createdAt", "updatedAt" }
  404 for an unknown job id.
  409 { message: "EXTERNAL_APPLICATION_ALREADY_TRACKED", trackingId: "…" }
      when a tracker already exists — PATCH that tracker instead.

PATCH  /candidate-account/me/external-job-applications/:trackingId
  Body: any subset of { "status", "appliedAt", "note" } (note: null clears)
  → 200 <the updated tracker, same shape as POST>
  404 for a tracker that does not exist OR belongs to another candidate.

DELETE /candidate-account/me/external-job-applications/:trackingId
  → 200 { "id": "…", "deleted": true }
  404 for unknown/foreign id (delete is by specific id, not idempotent-blind).

GET    /candidate-account/me/external-job-applications?status=&page=&pageSize=
  → 200 {
      "page", "pageSize", "total", "asOf",
      "results": [ {
        "id", "status", "appliedAt", "note", "createdAt", "updatedAt",
        "job": { <same canonical job shape as a saved-list result,
                 including honest status>, "saved": boolean }
      } ]
    }
  Ordering: appliedAt DESC, id ASC. `status` filters to one enum value.
```

Trackers survive every job lifecycle change: a tracker on a job that later
closes remains, with the job's honest current status in `job.status`.

### Search & detail decoration

Every `results[]` element of `POST …/external-jobs/search` and the response of
`GET …/external-jobs/:externalJobId` now additionally carry:

```
"saved": boolean,
"applicationTracking": { "id", "status", "appliedAt" } | null
```

These are DECORATION, loaded in bulk per page after ranking. They are absent
from the snapshot and the request fingerprint, so: identical `score`,
`textScore`, `intentScore`, `band` and ORDER as before, for both RELEVANCE and
NEWEST; and saving/tracking a job never invalidates or reorders an existing
search. The detail route still 404s non-current jobs; its flags describe the
authenticated caller only.

## "Why this match" (Task 4C.6) — API CONTRACT

MAX only, inheriting `EXTERNAL_AI_SEARCH` — **no new capability exists for
it**. FREE and PRO get the usual `PLAN_UPGRADE_REQUIRED` / `requiredPlan:
"MAX"` refusal.

```
POST /candidate-account/me/external-jobs/:externalJobId/why-match
  Body: { "locale"?: "en" | "ko" | "ru" | "uz" }   // omit = the account's own
  → 200 {
      "jobId": "<uuid>",
      "version": "external-why-match-v1",
      "locale": "en",
      "summary": "…",                       // ~80–150 words
      "strengths": [ { "title": "…", "explanation": "…" } ],   // 2–4
      "gaps":      [ { "title": "…", "explanation": "…" } ],   // 0–2, may be []
      "cached": true | false,
      "generatedAt": "ISO"
    }
  → 403 PLAN_UPGRADE_REQUIRED (requiredPlan MAX) for FREE/PRO
  → 404 for an id that is not an external job
  → 503 { "code": "AI_EXPLANATION_UNAVAILABLE", … } when generation fails
```

**Lazy by design.** Search returns deterministic results and calls no model;
this endpoint runs only when a person asks about ONE job. Never fan it out
over a result page — one user action, one request. First generation takes
seconds; a repeat is a cache hit in ~100ms with `cached: true`.

**Honesty rules for rendering.** `gaps` is legitimately empty — do not label
that "no data". The explanation never contains a score, band or percentage
(the deterministic ranking owns those, and the model is given none). A
`503 AI_EXPLANATION_UNAVAILABLE` is retryable and must not blank the job
card: search, detail, saved and tracking are unaffected by it.

**Closed jobs.** A saved job that has since CLOSED can still be explained,
with its real lifecycle state; the detail route keeps 404-ing non-current
jobs, unchanged.

## Not yet built

Dismissed external jobs; alerts; AI Cover Letter, AI Interview Prep and the
Advanced Match Breakdown (all three will reuse the Task 4C.6 premium-AI
context foundation); recruiter-side anything for external jobs (saved rows
and trackers are candidate-private); auto-detection that an external
application was submitted.

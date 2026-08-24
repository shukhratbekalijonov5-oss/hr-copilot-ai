# Candidate plans: FREE / PRO / MAX

Task 4C.5.1. The candidate side sells three tiers. This page is the product
definition; the enforceable version of it lives in
`src/entitlements/candidate-plan.policy.ts` and nowhere else.

| | FREE | PRO | MAX |
|---|---|---|---|
| Ordinary internal job search (`GET /public/jobs`) | ✓ | ✓ | ✓ |
| Ordinary internal apply / My Applications | ✓ | ✓ | ✓ |
| **Internal AI Job Search** (`POST …/me/job-matches`) | — | ✓ | ✓ |
| **External AI Job Search** (search, detail, saved, tracking) | — | — | ✓ |
| **Gemini "why this match"** (Task 4C.6) | — | — | ✓ |

Capabilities are the unit of enforcement, plans are the unit of sale:

```
INTERNAL_AI_SEARCH : FREE ✗   PRO ✓   MAX ✓
EXTERNAL_AI_SEARCH : FREE ✗   PRO ✗   MAX ✓
```

Tiers are cumulative (a spec test pins this). Saved external jobs and external
apply tracking are features OF the external product and carry
`EXTERNAL_AI_SEARCH`: a FREE account that cannot see external search results
has nothing to honestly save or track.

## Internal and external are SEPARATE RANKING UNIVERSES

Internal AI Search ranks HR Copilot vacancies. External AI Search ranks the
external catalogue. **They are never merged, blended, or ordered by one
score.** Internal synthetic data and 85–90% internal match scores would
dominate any mixed list, and the two sides differ in provenance, freshness,
data quality and apply semantics (internal applies happen here; external
applies happen on the employer's site).

The ONLY sanctioned meeting point is the shared feature VOCABULARY
(`NormalizedJobFeatures` / `job-vocabulary.ts`) so each side's own ranking can
reuse the matchers. `src/entitlements/universe-separation.spec.ts` enforces
the boundary structurally: the internal side cannot query ExternalJob tables
or carry `applyUrl`/provenance, the external side cannot query
Vacancy/Application tables, and neither imports the other's ranking modules.

## How enforcement works

- Routes declare **what they are** with `@RequiresCapability('…')` (class- or
  handler-level). They never name a plan.
- One global `PlanCapabilityGuard` (registered after the identity/type/role
  guards) resolves the caller's plan **live** and refuses with the stable
  contract below. Guard order matters: a recruiter on a candidate AI surface
  gets `AUTH_ACCOUNT_TYPE_MISMATCH`, never an upsell.
- Nothing a client sends — body, query, cookie, header, token claim — can
  influence the answer. Guards run before validation pipes, so even a
  smuggled `plan` property is never read by anything.

### The refusal contract

```
403
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "<developer courtesy — never parse this>",
  "code": "PLAN_UPGRADE_REQUIRED",
  "requiredPlan": "PRO" | "MAX",     // the CHEAPEST plan that grants it
  "capability": "INTERNAL_AI_SEARCH" | "EXTERNAL_AI_SEARCH"
}
```

The frontend switches on `code` + `requiredPlan` + `capability` only.

## The plan source is TRANSITIONAL

Today: `candidate_accounts.plan` (`CandidatePlan` enum, default `FREE`),
written by **no public API** — migrations, test fixtures and operators only.
A candidate cannot grant themselves a tier through any request.

The **Java Spring Boot Payment Service** will become the subscription/billing
authority. When it exists, `CandidateEntitlementsService.planFor` swaps its
read from the column to that service — that is the entire migration; no
controller, guard, policy or route changes.

Until then, elevating an account is an operator/fixture action:

```sql
UPDATE candidate_accounts SET plan = 'MAX'
WHERE "userId" = (SELECT id FROM users WHERE email = '…');
```

Tests do exactly this via Prisma (see `test/plan-entitlements.e2e-spec.ts`).
There is deliberately no dev HTTP endpoint that mutates plans.

## The authenticated plan read (`GET /auth/me`)

A candidate's `/auth/me` response carries the plan and everything it grants,
resolved through the same `CandidateEntitlementsService` the guards use —
one policy table, mirrored, never duplicated:

```json
"candidateAccount": {
  "exists": true,
  "plan": "FREE" | "PRO" | "MAX",
  "capabilities": []                                        // FREE
                | ["INTERNAL_AI_SEARCH"]                    // PRO
                | ["INTERNAL_AI_SEARCH", "EXTERNAL_AI_SEARCH"] // MAX
}
```

An organization identity keeps `candidateAccount: { "exists": false }` — no
plan, no capabilities. An unknown stored plan value is published as-is with
`capabilities: []` (fail closed). This read is UX input ONLY: the capability
guards re-resolve the plan on every gated request and remain the final
authority regardless of what any client renders or claims.

## Fixed development test accounts

Until the Payment Service exists, exactly two accounts are designated
non-FREE for development:

| Account | Plan |
|---|---|
| shukhratbekalijonov9@gmail.com | MAX |
| shukhratbekalijonov7@gmail.com | PRO |
| every other candidate, and every future registration | FREE |

`npm run dev:plan-setup` (scripts/dev-plan-setup.ts) enforces this
idempotently: it verifies both users exist AND are candidate accounts (never
converts, never creates), sets them, normalizes everyone else to FREE, and
prints the final distribution. It refuses to run with NODE_ENV=production
and has no HTTP surface.

### Older live-verify scripts

`scripts/verify-evidence-lifecycle.ts` and `scripts/verify-evidence-sources.ts`
(Task-2-era, pure HTTP) call the internal AI match with throwaway candidates;
since 4C.5.1 they need the SQL above (PRO) on their candidate before the match
step. `verify-external-jobs-ui.ts` and the service-level measurement scripts
were updated and need nothing.

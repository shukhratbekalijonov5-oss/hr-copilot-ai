/**
 * What the backend actually exposes today.
 *
 * Kept separate from `lib/config.ts` so client components can read these flags
 * without pulling the API origin into the browser bundle. Nothing here is
 * environment-specific or sensitive.
 *
 * These gate UI that would otherwise have to invent data. When the matching
 * backend endpoint ships, flip the flag and delete the "not available" branch —
 * never replace it with mock content.
 */
export const BACKEND_CAPABILITIES = {
  /** /api/auth/*, /api/users, /api/organizations */
  auth: true,
  vacancies: true,
  /** Read/edit only — HR cannot create a candidate (`POST /candidates` gone). */
  candidates: true,
  /** Read/transition only — applications are created by candidates applying. */
  applications: true,
  /** Read/serve/delete only — there is no HR upload route. */
  documents: true,
  processingJobs: true,
  processingWebsocket: true,
  /** GET /api/evidence — live, but only populated once the AI service runs. */
  evidence: true,
  /**
   * POST /api/search/evidence — live. Returns 503 when the Python AI service
   * is not configured, which the UI surfaces as unavailable rather than empty.
   */
  aiSearch: true,
  /**
   * POST /api/ai/answer — live. A grounded answer with validated citations.
   * Needs the generation provider, so it 503s while that is unconfigured;
   * `aiSearch` and `evidenceMap` keep working in that state.
   */
  aiAnswer: true,
  /** POST /api/ai/candidates/:id/summary — live, generation-dependent. */
  aiSummary: true,
  /**
   * POST /api/ai/candidates/:cid/vacancies/:vid/interview-questions — live,
   * generation-dependent.
   */
  interviewQuestions: true,
  /**
   * GET/POST /api/candidates/:cid/vacancies/:vid/evidence-map — live.
   *
   * Retrieval and classification only, with no LLM in the path, so mapping
   * survives a generation outage. Running it is restricted by the backend to
   * OWNER, HR_ADMIN and RECRUITER; reading it is not.
   */
  evidenceMap: true,
  /** No retry route for failed processing jobs yet. */
  processingRetry: false,

  /* ---------------------------------------------------------------------- */
  /* Two-sided platform                                                      */
  /*                                                                         */
  /* The identity migration landed: a User owns an optional CandidateAccount
     and any number of OrganizationMember rows, each with its own role. Every
     flag below was flipped only after the matching contract was verified
     against the running API — see docs/identity-contracts.md.               */
  /* ---------------------------------------------------------------------- */

  /**
   * POST /api/candidate-account, GET/PATCH /candidate-account/me and the
   * personal-resume routes — live. A user owns a job-seeker profile that
   * belongs to no organization.
   */
  candidateAccount: true,
  /**
   * GET /api/auth/me returns `memberships[]`, and
   * POST /api/auth/switch-organization mints a token for another one — live.
   * One user can hold a different role in each organization.
   */
  multiOrganization: true,
  /** GET /api/public/jobs and /public/jobs/:slug — live, no auth required. */
  publicJobs: true,
  /** POST /api/public/jobs/:slug/apply — live, authenticated candidate. */
  directApplication: true,
  /** GET/POST/DELETE /api/candidate-account/me/saved-jobs — live. */
  savedJobs: true,
  /**
   * Session management: GET /api/auth/sessions, DELETE /auth/sessions/:id,
   * POST /auth/logout and /auth/logout-all — live.
   */
  sessionManagement: true,

  /** No email or job-board integration endpoints. */
  integrations: false,
} as const;

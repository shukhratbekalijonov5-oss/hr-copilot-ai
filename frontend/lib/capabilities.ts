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
  candidates: true,
  applications: true,
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
  /* The API models a User as belonging to exactly one organization, with the
     role as a column on the user row. There is no CandidateAccount and no
     OrganizationMember join, so none of the job-seeker surfaces can persist
     anything yet. Each flag below turns one on when its contract lands.      */
  /* ---------------------------------------------------------------------- */

  /** No CandidateAccount model — a user cannot own a job-seeker profile. */
  candidateAccount: false,
  /** No OrganizationMember join — a user cannot belong to several orgs. */
  multiOrganization: false,
  /** No public/unauthenticated vacancy discovery route. */
  publicJobs: false,
  /** No route lets a candidate apply to a vacancy for themselves. */
  directApplication: false,
  /** No saved-jobs/favourites model. */
  savedJobs: false,
  /**
   * Application.source — live. The API returns a provenance value on every
   * application (MANUAL_UPLOAD for one created in-app), so the badge shows a
   * real source rather than a guess.
   */
  applicationSource: true,
  /** No email or job-board integration endpoints. */
  integrations: false,
} as const;

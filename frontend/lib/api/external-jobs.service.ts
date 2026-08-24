import "server-only";

import { apiFetch } from "@/lib/api/http";
import {
  toExternalCoverLetter,
  toExternalInterviewPrep,
  toExternalMatchBreakdown,
  toExternalJobApplicationPage,
  toExternalWhyMatch,
  toExternalJobDetail,
  toExternalJobSearchPage,
  toExternalJobTracking,
  toSavedExternalJobPage,
} from "@/lib/api/external-jobs-adapters";
import type {
  ExternalCoverLetterResponse,
  ExternalMatchBreakdownResponse,
  ExternalInterviewPrepResponse,
  ExternalJobApplicationResponse,
  ExternalWhyMatchResponse,
  ExternalPagedResponse,
  ExternalJobDetailResponse,
  ExternalJobSaveStateResponse,
  ExternalJobSearchResponse,
  ExternalJobTrackingResponse,
  SavedExternalJobResponse,
} from "@/lib/api/contracts";
import type {
  ExternalApplicationStatus,
  ExternalCoverLetter,
  ExternalInterviewPrep,
  ExternalMatchBreakdown,
  ExternalWhyMatch,
  ExternalJobApplicationPage,
  ExternalJobDetail,
  ExternalJobSearchPage,
  ExternalJobTracking,
  SavedExternalJobPage,
} from "@/lib/types";

/**
 * The job seeker's search over roles published outside HR Copilot.
 *
 * Both routes are `/candidate-account/me/external-jobs/...`: there is no id in
 * the path for the search, because the subject is always the caller, and the
 * backend refuses the whole controller to anything but a live candidate
 * account.
 *
 * ## What is NOT in this request
 *
 * No provider, no board, no source type. A job seeker does not know or care
 * which ATS published a role, and offering the filter would leak an
 * integration detail into the product's vocabulary — and quietly imply that
 * some ATSs carry better jobs. The backend DTO has no such field either, so
 * this is a shape the API could not accept even if a caller invented it.
 *
 * No candidate profile, preferences, resume or evidence travels either. The
 * backend reads the caller's own saved preferences server-side to rank; none
 * of it is sent from here, and none of it reaches a provider.
 */

export interface ExternalJobSearchRequest {
  /** HARD: decides which jobs are in the search at all. */
  query?: string;
  /** HARD: the only location input that removes jobs. ISO 3166-1 alpha-2. */
  countries?: string[];
  /** SOFT: ranks. Never hides an on-site role from someone who prefers remote. */
  workModes?: string[];
  /** SOFT. */
  employmentTypes?: string[];
  /** SOFT. */
  seniorityLevels?: string[];
  /** SOFT: a pay floor ranks jobs; it never removes them. */
  minCompensation?: {
    minAmount: number;
    maxAmount?: number;
    currency: string;
    payPeriod: string;
  };
  /**
   * RELEVANCE (default) or NEWEST. A closed vocabulary the backend re-checks;
   * it never reaches SQL as a string.
   */
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Run, or page through, a search.
 *
 * POST rather than GET because the request has structure, and because paging
 * is the same call with a different `page`: the backend re-reads its stored
 * ranking instead of recomputing, which is what keeps page 2 consistent with
 * page 1.
 */
export async function searchExternalJobs(
  request: ExternalJobSearchRequest,
): Promise<ExternalJobSearchPage> {
  const response = await apiFetch<ExternalJobSearchResponse>(
    "/candidate-account/me/external-jobs/search",
    { method: "POST", body: request },
  );
  return toExternalJobSearchPage(response);
}

/**
 * One job in full, for a reader who opened it.
 *
 * Carries no score, band or reason — those belong to the search, which is the
 * only call that knows who is asking. Two candidates opening the same job read
 * the same facts.
 */
export async function getExternalJob(
  externalJobId: string,
): Promise<ExternalJobDetail> {
  const response = await apiFetch<ExternalJobDetailResponse>(
    `/candidate-account/me/external-jobs/${encodeURIComponent(externalJobId)}`,
  );
  return toExternalJobDetail(response);
}

/* -------------------------------------------------------------------------- */
/* Saving, and the candidate's own application tracking                        */
/* -------------------------------------------------------------------------- */

/**
 * ## Every external-jobs path in the product is in this file
 *
 * Components call named functions; none of them knows a URL. That is what
 * makes the backend's contract cheap to follow while it is still being
 * written in parallel: if a route or a field name lands differently, the edit
 * is here, and no card, drawer, list or action changes at all.
 *
 * ## Saving and tracking are independent, and stay that way here
 *
 * Nothing in this file does two things. Saving does not create a tracker,
 * tracking does not save, and unsaving does not delete a tracker — because a
 * candidate who applied to a job and then tidied it out of their saved list
 * has not withdrawn their application, and the product must not act as if
 * they had.
 *
 * ## Nothing here is optimistic
 *
 * Each call returns what the backend says is now true, and the caller renders
 * that. The UI may show a pending state while a call is in flight, but the
 * value it settles on is always the server's.
 */

const EXTERNAL_JOBS_BASE = "/candidate-account/me/external-jobs";
/** The backend's own default, restated so the pager and the request agree. */
export const EXTERNAL_LIST_PAGE_SIZE = 20;
const EXTERNAL_APPLICATIONS_BASE =
  "/candidate-account/me/external-job-applications";

/** Same encoding rule as the detail read: an id is a path segment, not a URL. */
function jobPath(externalJobId: string, suffix: string): string {
  return `${EXTERNAL_JOBS_BASE}/${encodeURIComponent(externalJobId)}${suffix}`;
}

/**
 * Save one job. Idempotent by contract, so a double submit is harmless — but
 * the UI still disables the control while a call is in flight, because a
 * second request is wasted work even when it is safe.
 */
export async function saveExternalJob(
  externalJobId: string,
): Promise<{ saved: boolean }> {
  const response = await apiFetch<ExternalJobSaveStateResponse>(
    jobPath(externalJobId, "/save"),
    { method: "POST" },
  );
  // Idempotent on the backend: saving twice answers `saved: true` again and
  // writes no second row, so a double press cannot duplicate a bookmark.
  // The server's word, not the word we hoped for: a backend that answered
  // `saved: false` to a save must not be re-rendered as saved.
  return { saved: response?.saved === true };
}

export async function unsaveExternalJob(
  externalJobId: string,
): Promise<{ saved: boolean }> {
  const response = await apiFetch<ExternalJobSaveStateResponse>(
    jobPath(externalJobId, "/save"),
    { method: "DELETE" },
  );
  return { saved: response?.saved === true };
}

/**
 * The saved list — `pageSize`, not `limit`.
 *
 * The candidate-owned external lists use their own envelope and their own
 * page-size parameter, unlike the `Paginated<T>` + `limit` the rest of this
 * API speaks. Sending `limit` was silently ignored, and reading `.data` gave
 * an empty array with no error to notice. Both live here, once.
 */
export async function getSavedExternalJobs(
  page = 1,
  pageSize = EXTERNAL_LIST_PAGE_SIZE,
): Promise<SavedExternalJobPage> {
  return toSavedExternalJobPage(
    await apiFetch<ExternalPagedResponse<SavedExternalJobResponse>>(
      `${EXTERNAL_JOBS_BASE}/saved`,
      { query: { page, pageSize } },
    ),
  );
}

/**
 * Start tracking — the candidate saying "I applied", explicitly.
 *
 * There is no code path anywhere that calls this as a side effect of opening
 * an employer's site. Clicking Apply is navigation; this is a claim about
 * something that happened off this product, and only the person who did it can
 * make it.
 */
export async function trackExternalApplication(
  externalJobId: string,
  input: { status?: ExternalApplicationStatus; appliedAt?: string; note?: string | null } = {},
): Promise<ExternalJobTracking | null> {
  const response = await apiFetch<ExternalJobTrackingResponse>(
    jobPath(externalJobId, "/application"),
    { method: "POST", body: input },
  );
  return toExternalJobTracking(response);
}

/**
 * Correct a tracked record.
 *
 * Any status may follow any other. No transition table is enforced here or
 * asked of the backend: an external process can go to interview and back to
 * applied, or end in a rejection weeks after an offer, and a product that
 * refused those edits would be telling people their own history is invalid.
 */
export async function updateExternalApplication(
  applicationId: string,
  input: { status?: ExternalApplicationStatus; note?: string | null },
): Promise<ExternalJobTracking | null> {
  const response = await apiFetch<ExternalJobTrackingResponse>(
    `${EXTERNAL_APPLICATIONS_BASE}/${encodeURIComponent(applicationId)}`,
    { method: "PATCH", body: input },
  );
  return toExternalJobTracking(response);
}

/** Stop tracking. Deletes the candidate's own record and nothing else. */
export async function deleteExternalApplication(
  applicationId: string,
): Promise<void> {
  await apiFetch(
    `${EXTERNAL_APPLICATIONS_BASE}/${encodeURIComponent(applicationId)}`,
    { method: "DELETE" },
  );
}

/**
 * The tracking list, optionally narrowed to one status.
 *
 * The status filter is the backend's — a closed vocabulary it re-checks — so
 * an unrecognised value is simply not sent rather than being passed through to
 * be rejected as a 400 on a page a reader shared.
 */
export async function getExternalApplications(
  page = 1,
  pageSize = EXTERNAL_LIST_PAGE_SIZE,
  status?: ExternalApplicationStatus,
): Promise<ExternalJobApplicationPage> {
  return toExternalJobApplicationPage(
    await apiFetch<ExternalPagedResponse<ExternalJobApplicationResponse>>(
      EXTERNAL_APPLICATIONS_BASE,
      { query: { page, pageSize, status } },
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Gemini "why this match"                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ask why ONE job was ranked where it was.
 *
 * ## Called from exactly one place, on purpose
 *
 * Nothing in a search render, a card, a list or a page load reaches this. A
 * search returns twenty jobs; generating twenty explanations nobody asked to
 * read would multiply every search by twenty model calls, and the reader who
 * scrolled past nineteen of them would have paid for all of it in latency
 * before seeing a single result. So the search stays a search, and this runs
 * when a person presses a button about one job.
 *
 * ## The frontend never talks to Gemini
 *
 * This is a call to HR Copilot's own API. There is no model client in this
 * repo, no API key reachable from it, and no prompt built here — the backend
 * owns the prompt, the model, the cache and the rate limit, which is the only
 * arrangement in which a key is not shipped to a browser.
 *
 * ## POST rather than GET
 *
 * Generation is not a safe, cacheable read: it may mint a record, it consumes
 * a rate-limited budget, and a GET invites a prefetch or a link-scanner to
 * spend model tokens for nobody.
 *
 * `locale` travels because the explanation is prose and must arrive in the
 * language the rest of the screen is written in. The backend re-checks it.
 */
export async function explainExternalMatch(
  externalJobId: string,
  locale?: string,
): Promise<ExternalWhyMatch> {
  const response = await apiFetch<ExternalWhyMatchResponse>(
    jobPath(externalJobId, "/why-match"),
    { method: "POST", body: locale ? { locale } : {} },
  );
  return toExternalWhyMatch(externalJobId, response);
}

/**
 * The other two on-demand MAX tools, on the same terms as the explanation.
 *
 * POST for the same reasons: generation is not a safe cacheable read, it
 * spends a rate-limited model budget, and a GET invites a prefetch to spend it
 * for nobody. `locale` is the ONLY thing sent — the backend reads the
 * candidate's evidence server-side and owns the prompt, so no profile, resume
 * or model instruction is assembled in a browser.
 *
 * Each is called from exactly one component, from a click handler. Nothing in
 * a search, a card, a list or a drawer-open path reaches them.
 */

export async function generateExternalCoverLetter(
  externalJobId: string,
  locale?: string,
): Promise<ExternalCoverLetter> {
  const response = await apiFetch<ExternalCoverLetterResponse>(
    jobPath(externalJobId, "/cover-letter"),
    { method: "POST", body: locale ? { locale } : {} },
  );
  return toExternalCoverLetter(externalJobId, response);
}

export async function generateExternalInterviewPrep(
  externalJobId: string,
  locale?: string,
): Promise<ExternalInterviewPrep> {
  const response = await apiFetch<ExternalInterviewPrepResponse>(
    jobPath(externalJobId, "/interview-prep"),
    { method: "POST", body: locale ? { locale } : {} },
  );
  return toExternalInterviewPrep(externalJobId, response);
}

/**
 * The dimension-by-dimension breakdown. Same terms as the other three tools:
 * POST, locale only, one job, called from one click handler.
 */
export async function generateExternalMatchBreakdown(
  externalJobId: string,
  locale?: string,
): Promise<ExternalMatchBreakdown> {
  const response = await apiFetch<ExternalMatchBreakdownResponse>(
    jobPath(externalJobId, "/match-breakdown"),
    { method: "POST", body: locale ? { locale } : {} },
  );
  return toExternalMatchBreakdown(externalJobId, response);
}

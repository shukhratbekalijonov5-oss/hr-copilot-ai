"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import { candidateFailureReason } from "@/lib/api/candidate-errors";
import { getLocale } from "@/lib/i18n/server";
import type {
  ApplicationStatus,
  CandidateAccount,
  CandidateAccountInput,
  CandidateActionReason,
  CandidateEvidenceState,
  CandidateLink,
  CandidateLinkInput,
  JobMatchResult,
  MyApplication,
  PersonalDocument,
} from "@/lib/types";

/**
 * The job seeker's own actions.
 *
 * Every one of them addresses `/candidate-account/me/...` or a public job slug
 * — there is no id in any path, because the subject is always the caller. None
 * of them needs an organization, which is what makes the candidate workspace
 * usable by someone who belongs to none.
 */

export type CandidateResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: CandidateActionReason;
      message?: string;
      code?: string | null;
    };

async function run<T>(action: () => Promise<T>): Promise<CandidateResult<T>> {
  try {
    return { ok: true, data: await action() };
  } catch (error) {
    return {
      ok: false,
      reason: candidateFailureReason(error),
      message: error instanceof ApiError ? error.message : undefined,
      code: error instanceof ApiError ? error.code : null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export async function createCandidateAccountAction(
  input: CandidateAccountInput = {},
): Promise<CandidateResult<CandidateAccount>> {
  const result = await run(() => api.createCandidateAccount(input));
  // The account's existence changes the shell (workspace switcher, nav).
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateCandidateAccountAction(
  input: CandidateAccountInput,
): Promise<CandidateResult<CandidateAccount>> {
  const result = await run(() => api.updateCandidateAccount(input));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

/*
 * FILE UPLOADS ARE NOT SERVER ACTIONS, AND MUST NOT BECOME ONE AGAIN.
 *
 * A Server Action's arguments are serialised into a single POST body that Next
 * caps at 1 MB (`serverActions.bodySizeLimit`). Putting a resume in one meant
 * every upload over that size died with "Body exceeded 1 MB limit" before any
 * of our code ran — against a product limit of 50 MB per file.
 *
 * Uploads now post multipart to `app/api/candidate-account/documents/route.ts`,
 * which streams the body through to the API without buffering or re-encoding
 * it. Everything else on this page — the profile form, links, deletes — is
 * still a Server Action, because none of them carry bytes.
 *
 * The legacy `uploadPersonalResumeAction` (the `me/resume` replace flow) was
 * removed here rather than left behind: no screen called it, and it had the
 * same 1 MB ceiling waiting for whoever wired it up next. `api.uploadPersonalResume`
 * remains, so that flow can be restored through the route handler if needed.
 */

export async function getPersonalDocumentUrlAction(
  id: string,
): Promise<CandidateResult<{ url: string; originalFileName: string }>> {
  return run(() => api.getPersonalDocumentUrl(id));
}

export async function deletePersonalDocumentAction(
  id: string,
): Promise<CandidateResult<{ id: string }>> {
  const result = await run(() => api.deletePersonalDocument(id));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

/** Re-queues AI indexing for a FAILED document, without a re-upload. */
export async function reprocessPersonalDocumentAction(
  id: string,
): Promise<CandidateResult<PersonalDocument>> {
  const result = await run(() => api.reprocessPersonalDocument(id));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

export async function getPersonalResumeUrlAction(): Promise<
  CandidateResult<{ url: string; originalFileName: string } | null>
> {
  return run(() => api.getPersonalResumeUrl());
}

/* -------------------------------------------------------------------------- */
/* Professional links                                                          */
/*                                                                             */
/* The other half of personal evidence. Same privacy story as a personal file:  */
/* the link belongs to the account, no organization can read it, and applying   */
/* is what creates the frozen copy a recruiter eventually sees.                 */
/* -------------------------------------------------------------------------- */

export async function addCandidateLinkAction(
  input: CandidateLinkInput,
): Promise<CandidateResult<CandidateLink>> {
  const result = await run(() => api.createCandidateLink(input));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

export async function updateCandidateLinkAction(
  id: string,
  input: CandidateLinkInput,
): Promise<CandidateResult<CandidateLink>> {
  const result = await run(() => api.updateCandidateLink(id, input));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

/**
 * Removes a link and its personal index entries.
 *
 * Applications already submitted keep their own copy of what was sent — this
 * never rewrites an organization's record.
 */
export async function deleteCandidateLinkAction(
  id: string,
): Promise<CandidateResult<{ id: string }>> {
  const result = await run(() => api.deleteCandidateLink(id));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

/** Retry a transient failure, or refresh a page that has changed. */
export async function reprocessCandidateLinkAction(
  id: string,
): Promise<CandidateResult<CandidateLink>> {
  const result = await run(() => api.reprocessCandidateLink(id));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

/* -------------------------------------------------------------------------- */
/* Jobs, applications and bookmarks                                            */
/* -------------------------------------------------------------------------- */

/**
 * The caller's current evidence state.
 *
 * Read from the backend rather than derived from the profile object, because
 * the backend owns the rule: matching runs when a candidate has at least one
 * file or one professional link, and `canRunJobMatch` is that same condition
 * — so the button and the endpoint can never disagree.
 *
 * `evidenceRevision` is what makes a displayed result checkable: a rendered
 * analysis carries the revision it was computed from, and a mismatch means the
 * screen is showing conclusions drawn from evidence that no longer exists.
 */
export async function getCandidateEvidenceStateAction(): Promise<
  CandidateResult<CandidateEvidenceState>
> {
  return run(() => api.getCandidateEvidenceState());
}

/**
 * Applies to a public job.
 *
 * The backend copies the personal resume into the hiring organization's own
 * namespace, creates the application and queues AI processing of that copy.
 * Nothing about the outcome is decided here — the response is an application in
 * status NEW, and every later stage is a human decision on the recruiter side.
 */
export async function applyToJobAction(
  slug: string,
): Promise<
  CandidateResult<{
    organizationName: string;
    applicationState: ApplicationStatus;
  }>
> {
  const result = await run(() => api.applyToJob(slug));
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      organizationName: result.data.vacancy.organization.name,
      applicationState: result.data.status,
    },
  };
}

export async function withdrawApplicationAction(
  id: string,
): Promise<CandidateResult<MyApplication>> {
  const result = await run(() => api.withdrawApplication(id));

  if (!result.ok && result.reason === "already_applied") {
    // A 409 on withdraw means the stage is terminal, not a duplicate apply.
    return { ok: false, reason: "cannot_withdraw", message: result.message };
  }
  if (result.ok) revalidatePath("/my-applications");
  return result;
}

export async function saveJobAction(
  slug: string,
): Promise<CandidateResult<{ saved: boolean }>> {
  return run(() => api.saveJob(slug));
}

export async function unsaveJobAction(
  slug: string,
): Promise<CandidateResult<{ saved: boolean }>> {
  return run(() => api.unsaveJob(slug));
}

/* -------------------------------------------------------------------------- */
/* AI job matching                                                             */
/* -------------------------------------------------------------------------- */

export type JobMatchFailure =
  /** No profile signal at all — the backend refuses to match on nothing. */
  | "not_ready"
  /** The matching service is down; nothing was computed. */
  | "unavailable"
  | "network"
  | "error";

export type JobMatchActionResult =
  | { ok: true; data: JobMatchResult }
  | { ok: false; reason: JobMatchFailure };

/**
 * Runs the caller's own job matching, or fetches the next page of a ranking
 * that already exists.
 *
 * Explicitly user-initiated — the first call ranks every eligible vacancy and
 * ends in a Gemini call, so it never runs as a render side effect. Later pages
 * are slices of that stored ranking: `page` alone must NOT recompute, or the
 * list would reshuffle under the reader's scroll. `refresh` is the only thing
 * that re-ranks, and it is the candidate's explicit choice.
 *
 * The locale is read server-side from the same cookie the UI renders from, so
 * the explanation language cannot drift from the screen's.
 */
export async function runJobMatchesAction(
  input: { page?: number; refresh?: boolean } = {},
): Promise<JobMatchActionResult> {
  const locale = await getLocale();

  try {
    return {
      ok: true,
      data: await api.getJobMatches({
        locale,
        page: input.page,
        refresh: input.refresh,
      }),
    };
  } catch (error) {
    if (!(error instanceof ApiError)) return { ok: false, reason: "error" };
    if (error.kind === "network") return { ok: false, reason: "network" };
    if (error.kind === "unavailable") return { ok: false, reason: "unavailable" };
    // 400 = no candidate account, 422 = nothing to match on. Both read the
    // same to the person: the profile is not ready yet.
    if (error.status === 400 || error.status === 422) {
      return { ok: false, reason: "not_ready" };
    }
    return { ok: false, reason: "error" };
  }
}

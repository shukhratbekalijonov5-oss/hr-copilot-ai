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
  JobMatchResult,
  MyApplication,
  PersonalDocument,
  PersonalResume,
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

/**
 * Replaces the personal resume.
 *
 * The file goes to the candidate account's private namespace and is not indexed
 * for any organization. Applications already sent keep the snapshot taken when
 * they were submitted.
 */
export async function uploadPersonalResumeAction(
  formData: FormData,
): Promise<CandidateResult<PersonalResume>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "error" };
  }

  const result = await run(() => api.uploadPersonalResume(file));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

export async function uploadPersonalDocumentAction(
  formData: FormData,
): Promise<CandidateResult<PersonalDocument>> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "error" };
  }

  const result = await run(() => api.uploadPersonalDocument(file));
  if (result.ok) revalidatePath("/my-profile");
  return result;
}

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

export async function getPersonalResumeUrlAction(): Promise<
  CandidateResult<{ url: string; originalFileName: string } | null>
> {
  return run(() => api.getPersonalResumeUrl());
}

/* -------------------------------------------------------------------------- */
/* Jobs, applications and bookmarks                                            */
/* -------------------------------------------------------------------------- */

export interface JobMatchReadiness {
  hasAccount: boolean;
  hasResume: boolean;
  hasProfileSignal: boolean;
}

export async function getJobMatchReadinessAction(): Promise<
  CandidateResult<JobMatchReadiness>
> {
  const result = await run(() => api.getCandidateAccount());
  if (!result.ok) return result;

  const account = result.data;
  return {
    ok: true,
    data: {
      hasAccount: account !== null,
      hasResume: Boolean(account?.resume),
      hasProfileSignal: Boolean(
        account &&
          (account.skills.length > 0 ||
            account.experience.length > 0 ||
            account.headline ||
            account.summary),
      ),
    },
  };
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
 * Runs the caller's own job matching. Explicitly user-initiated — this is a
 * slow call that ends in one Gemini generation, so it never runs as a render
 * side effect. The locale is read server-side from the same cookie the UI
 * renders from, so the explanation language cannot drift from the screen's.
 */
export async function runJobMatchesAction(): Promise<JobMatchActionResult> {
  const locale = await getLocale();

  try {
    return { ok: true, data: await api.getJobMatches({ locale }) };
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

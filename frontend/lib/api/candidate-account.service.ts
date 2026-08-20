import "server-only";

import { apiFetch, type Paginated } from "@/lib/api/http";
import {
  toCandidateAccount,
  toMyApplication,
  toSavedJob,
  toJobMatchResult,
} from "@/lib/api/adapters";
import type {
  CandidateAccountResponse,
  MyApplicationResponse,
  SavedJobResponse,
  JobMatchesResponse,
} from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import type {
  CandidateAccount,
  CandidateAccountInput,
  MyApplication,
  MyApplicationPage,
  PersonalResume,
  SavedJobPage,
  JobMatchResult,
  Locale,
} from "@/lib/types";

/**
 * The signed-in user's own job-seeker identity.
 *
 * Every route here is `/candidate-account/me/...` — there is no id in any path,
 * because the subject is always the caller. None of it needs, or accepts, an
 * organization context: a job seeker with zero memberships uses all of it.
 */

/** POST /candidate-account — 409 when one already exists. */
export function createCandidateAccount(
  input: CandidateAccountInput = {},
): Promise<CandidateAccount> {
  return apiFetch<CandidateAccountResponse>("/candidate-account", {
    method: "POST",
    body: input,
  }).then(toCandidateAccount);
}

/**
 * GET /candidate-account/me.
 *
 * Returns null instead of throwing on 404: "no profile yet" is the normal
 * starting state for anyone who registered as a job seeker, not an error.
 */
export async function getCandidateAccount(): Promise<CandidateAccount | null> {
  try {
    return toCandidateAccount(
      await apiFetch<CandidateAccountResponse>("/candidate-account/me"),
    );
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") return null;
    throw error;
  }
}

export function updateCandidateAccount(
  input: CandidateAccountInput,
): Promise<CandidateAccount> {
  return apiFetch<CandidateAccountResponse>("/candidate-account/me", {
    method: "PATCH",
    body: input,
  }).then(toCandidateAccount);
}

/**
 * POST /candidate-account/me/resume.
 *
 * Replaces the personal resume. Existing applications are unaffected: each one
 * carries the org-scoped snapshot taken when it was submitted.
 */
export function uploadPersonalResume(file: File): Promise<PersonalResume> {
  const formData = new FormData();
  formData.append("file", file);

  return apiFetch<{
    id: string;
    originalFileName: string;
    mimeType: string;
    fileSize: number;
  }>("/candidate-account/me/resume", {
    method: "POST",
    formData,
  }).then((response) => ({
    id: response.id,
    originalFileName: response.originalFileName,
    mimeType: response.mimeType,
    fileSize: response.fileSize,
    createdAt: new Date().toISOString(),
  }));
}

/** GET /candidate-account/me/resume — a short-lived signed URL. */
export async function getPersonalResumeUrl(): Promise<{
  url: string;
  originalFileName: string;
} | null> {
  try {
    return await apiFetch("/candidate-account/me/resume");
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") return null;
    throw error;
  }
}

export async function getMyApplications(
  page = 1,
  limit = 20,
): Promise<MyApplicationPage> {
  const response = await apiFetch<Paginated<MyApplicationResponse>>(
    "/candidate-account/me/applications",
    { query: { page, limit } },
  );

  return {
    applications: response.data.map(toMyApplication),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/**
 * POST /candidate-account/me/applications/:id/withdraw.
 *
 * The only status a candidate may set, and only from a still-active stage. The
 * backend rejects everything else with 409; the frontend hides the control
 * where it does not apply but never decides the transition itself.
 */
export function withdrawApplication(id: string): Promise<MyApplication> {
  return apiFetch<MyApplicationResponse>(
    `/candidate-account/me/applications/${id}/withdraw`,
    { method: "POST" },
  ).then(toMyApplication);
}

export async function getSavedJobs(
  page = 1,
  limit = 20,
): Promise<SavedJobPage> {
  const response = await apiFetch<Paginated<SavedJobResponse>>(
    "/candidate-account/me/saved-jobs",
    { query: { page, limit } },
  );

  return {
    saved: response.data.map(toSavedJob),
    total: response.meta.total,
    page: response.meta.page,
    totalPages: response.meta.totalPages,
  };
}

/** Idempotent on the backend, so a double click is harmless. */
export function saveJob(slug: string): Promise<{ saved: boolean }> {
  return apiFetch(`/candidate-account/me/saved-jobs/${slug}`, {
    method: "POST",
  });
}

export function unsaveJob(slug: string): Promise<{ saved: boolean }> {
  return apiFetch(`/candidate-account/me/saved-jobs/${slug}`, {
    method: "DELETE",
  });
}

/**
 * POST /candidate-account/me/job-matches — the candidate-side AI match.
 *
 * Slow by nature (~20s: vacancy retrieval, reranking and one grounded
 * explanation), so callers run it on an explicit user action, never as a
 * side effect of rendering. The subject is always the caller's own account;
 * there is no id to pass.
 */
export async function getJobMatches(input: {
  locale: Locale;
  limit?: number;
}): Promise<JobMatchResult> {
  const response = await apiFetch<JobMatchesResponse>(
    "/candidate-account/me/job-matches",
    {
      method: "POST",
      body: { locale: input.locale, limit: input.limit },
    },
  );
  return toJobMatchResult(response);
}

"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import { runAiAction, type AiActionResult } from "@/lib/api/ai-failure";
import { getLocale } from "@/lib/i18n/server";
import type {
  ApplicationStatus,
  CandidateSummary,
  EvidenceMap,
  GroundedAnswer,
  InterviewQuestionSet,
  InviteToInterviewResult,
} from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type InviteInterviewActionResult =
  | { ok: true; data: InviteToInterviewResult }
  | { ok: false; message?: string };

/**
 * Moves an application to another stage.
 *
 * This is the only place a candidate's standing changes, and it always
 * originates from a person clicking a control. Nothing in the product advances
 * or rejects an application on its own.
 */
export async function setApplicationStatusAction(
  applicationId: string,
  candidateId: string,
  status: ApplicationStatus,
): Promise<ActionResult> {
  try {
    const application = await api.setApplicationStatus(applicationId, status);
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/candidates");
    revalidatePath("/interview-chats");
    revalidatePath(`/vacancies/${application.vacancyId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not update the application." };
  }
}

/**
 * Signed URL for one of the applicant's CURRENT documents. Read-only, minted
 * at click time so it stays short-lived; the storage key never reaches the
 * browser.
 */
export async function getCurrentDocumentUrlAction(
  candidateId: string,
  vacancyId: string,
  documentId: string,
): Promise<
  | { ok: true; url: string; originalFileName: string }
  | { ok: false; message?: string }
> {
  try {
    const result = await api.getCandidateCurrentDocumentUrl(
      candidateId,
      vacancyId,
      documentId,
    );
    return {
      ok: true,
      url: result.url,
      originalFileName: result.originalFileName,
    };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false };
  }
}

export async function inviteToInterviewAction(
  applicationId: string,
  candidateId: string,
): Promise<InviteInterviewActionResult> {
  try {
    const result = await api.inviteToInterview(applicationId);
    revalidatePath(`/candidates/${candidateId}`);
    revalidatePath("/candidates");
    revalidatePath("/interview-chats");
    if (result.application.vacancyId) {
      revalidatePath(`/vacancies/${result.application.vacancyId}`);
    }
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not invite the candidate." };
  }
}

/* -------------------------------------------------------------------------- */
/* Grounded AI                                                                 */
/*                                                                             */
/* Every action below runs on the server so the session cookie authenticates    */
/* it and no token reaches the browser. None of them accepts a locale from the  */
/* client: the locale is read from the same cookie the UI renders from, so the  */
/* language of an answer can never drift from the language on screen.           */
/* -------------------------------------------------------------------------- */

/**
 * POST /ai/candidates/:id/summary — now vacancy-scoped.
 *
 * `vacancyId` is required by the backend: the summary answers how the evidence
 * relates to THIS vacancy and is grounded in its title and requirements, so a
 * candidate in two pipelines gets two different summaries.
 */
export async function generateSummaryAction(
  candidateId: string,
  vacancyId: string,
): Promise<AiActionResult<CandidateSummary>> {
  const locale = await getLocale();
  return runAiAction("generation", () =>
    api.summariseCandidate(candidateId, vacancyId, locale),
  );
}

/** POST /ai/candidates/:cid/vacancies/:vid/interview-questions */
export async function generateInterviewQuestionsAction(
  candidateId: string,
  vacancyId: string,
): Promise<AiActionResult<InterviewQuestionSet>> {
  const locale = await getLocale();
  return runAiAction("generation", () =>
    api.getInterviewQuestions(candidateId, vacancyId, locale),
  );
}

/**
 * POST /ai/answer, scoped to one candidate INSIDE one vacancy.
 *
 * The backend requires `vacancyId` whenever `candidateId` is present — the
 * selected vacancy's title and requirements become part of the generation
 * context — so an ask without a selection is rejected here rather than sent
 * to a guaranteed 400.
 */
export async function askAboutCandidateAction(
  candidateId: string,
  vacancyId: string,
  query: string,
): Promise<AiActionResult<GroundedAnswer>> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return { ok: false, reason: "invalid", message: "Query too short." };
  }
  if (!vacancyId) {
    return { ok: false, reason: "invalid", message: "Select a vacancy first." };
  }

  const locale = await getLocale();
  return runAiAction("generation", () =>
    api.answerQuestion({ query: trimmed, candidateId, vacancyId, locale }),
  );
}

/**
 * POST the evidence map — runs it and returns the stored result.
 *
 * Classified as a retrieval surface, not a generation one: the backend maps
 * requirements without an LLM, so a 503 here means retrieval is down rather
 * than that generation is unconfigured. Reporting it as a generation outage
 * would tell the recruiter that search still works when it does not.
 */
export async function runEvidenceMapAction(
  candidateId: string,
  vacancyId: string,
): Promise<AiActionResult<EvidenceMap>> {
  const locale = await getLocale();
  const result = await runAiAction("retrieval", () =>
    api.runEvidenceMap(candidateId, vacancyId, locale),
  );

  // A run writes CandidateEvidence rows the page reads server-side.
  if (result.ok) revalidatePath(`/candidates/${candidateId}`);
  return result;
}

/** GET the stored evidence map. No AI call, so it survives an LLM outage. */
export async function readEvidenceMapAction(
  candidateId: string,
  vacancyId: string,
): Promise<AiActionResult<EvidenceMap>> {
  return runAiAction("retrieval", () =>
    api.getEvidenceMap(candidateId, vacancyId),
  );
}

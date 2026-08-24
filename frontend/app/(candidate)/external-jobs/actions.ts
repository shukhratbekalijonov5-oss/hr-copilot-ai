"use server";

import { api, ApiError } from "@/lib/api";
import { getLocale } from "@/lib/i18n/server";
import { planUpgradeFrom } from "@/lib/entitlements/plan-error";
import type { CandidatePlan } from "@/lib/entitlements/plan";
import type {
  ExternalApplicationStatus,
  ExternalJobDetail,
  ExternalCoverLetter,
  ExternalInterviewPrep,
  ExternalJobTracking,
  ExternalMatchBreakdown,
  ExternalWhyMatch,
} from "@/lib/types";

/**
 * Reading one external job from the browser.
 *
 * A Server Action rather than a route handler because it carries no bytes and
 * needs the session: the access token lives in an httpOnly cookie only the
 * Next server can read, so the browser asks this and this asks the API. No
 * token, and no candidate identity, ever reaches client JavaScript.
 *
 * ## Why the outcome is a value and not an exception
 *
 * "This job is no longer listed" and "the API is unreachable" need different
 * words on the screen, and a thrown error carries neither reliably across the
 * action boundary. Returning a discriminated result keeps the distinction the
 * reader can act on: one of these means try again, the other means it is gone.
 *
 * The three-way mapping is deliberately narrow — the shared
 * `candidateFailureReason` reads a 400 as "no candidate account", which is
 * true of the apply routes it was written for and false here, where a 400 is a
 * malformed id.
 */

export type ExternalJobDetailResult =
  | { ok: true; data: ExternalJobDetail }
  | { ok: false; reason: "gone" | "unauthorized" | "error" };

export async function getExternalJobAction(
  externalJobId: string,
): Promise<ExternalJobDetailResult> {
  try {
    return { ok: true, data: await api.getExternalJob(externalJobId) };
  } catch (error) {
    if (error instanceof ApiError) {
      // 404 is a real answer: the listing left the current universe between
      // the search and the click. 400 lands here too — a hand-edited id is
      // not a job, and "not listed" is the truthful thing to say about it.
      if (error.status === 404 || error.status === 400) {
        return { ok: false, reason: "gone" };
      }
      if (error.status === 401 || error.status === 403) {
        return { ok: false, reason: "unauthorized" };
      }
    }
    return { ok: false, reason: "error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Saving, and the candidate's own application tracking                        */
/* -------------------------------------------------------------------------- */

/**
 * ## Why these are actions and not client fetches
 *
 * Same reason as the read above: the access token is in an httpOnly cookie
 * only the Next server can see. A client that could call the API directly
 * would need that token in JavaScript, and no feature here is worth that.
 *
 * ## Failure is a value, and it is never dressed as success
 *
 * Each of these mutates something the reader will act on — a saved list they
 * will come back to, a record of an application they made. Reporting "saved"
 * for a request that did not save would be the single worst outcome available:
 * they would stop looking for a job they believe they kept. So every path
 * below either carries the backend's own answer or says plainly that it did
 * not happen, and the UI reverts.
 *
 * `unavailable` exists for the window in which the API predates this feature —
 * a 404 from a route that does not exist yet, or from a listing that has left
 * the catalogue. Both mean "this cannot be done right now", and neither is
 * allowed to look like it worked.
 */

export type ExternalMutationFailure = {
  ok: false;
  reason: "unavailable" | "unauthorized" | "error";
};

export type ExternalSaveResult =
  | { ok: true; saved: boolean }
  | ExternalMutationFailure;

export type ExternalTrackingResult =
  | { ok: true; tracking: ExternalJobTracking | null }
  | ExternalMutationFailure;

/** One mapping for every mutation here, so they cannot drift apart. */
function mutationFailure(error: unknown): ExternalMutationFailure {
  if (error instanceof ApiError) {
    // 404 covers both "no such listing" and "this API cannot do that yet";
    // 400 covers a malformed id. None of them is a success.
    if (error.status === 404 || error.status === 400) {
      return { ok: false, reason: "unavailable" };
    }
    if (error.status === 401 || error.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
  }
  return { ok: false, reason: "error" };
}

export async function setExternalJobSavedAction(
  externalJobId: string,
  saved: boolean,
): Promise<ExternalSaveResult> {
  try {
    const result = saved
      ? await api.saveExternalJob(externalJobId)
      : await api.unsaveExternalJob(externalJobId);
    // The backend's answer, not the argument that was passed in.
    return { ok: true, saved: result.saved };
  } catch (error) {
    return mutationFailure(error);
  }
}

/**
 * Records that the candidate applied — because they said so, here.
 *
 * Nothing calls this from an `onClick` that also opens the employer's site.
 * Opening a link is navigation; this is a claim about the world.
 *
 * ## Already tracked is not a failure
 *
 * The backend answers 409 `EXTERNAL_APPLICATION_ALREADY_TRACKED` when a
 * tracker for this job already exists — two tabs, a stale card, a reader who
 * pressed the button on a job they had already marked. Reporting that as an
 * error would be actively misleading: the thing they asked for is already
 * true. So the conflict is reconciled by RE-READING the job, which carries the
 * authoritative tracker in its decoration, and the caller receives the real
 * record. Nothing is fabricated from the 409 body — it names a `trackingId`,
 * but not the status or date that go with it, and inventing those is exactly
 * the kind of guess this feature must not make.
 */
export async function trackExternalApplicationAction(
  externalJobId: string,
  input: {
    status?: ExternalApplicationStatus;
    note?: string | null;
  } = {},
): Promise<ExternalTrackingResult> {
  try {
    return { ok: true, tracking: await api.trackExternalApplication(externalJobId, input) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return reconcileAlreadyTracked(externalJobId);
    }
    return mutationFailure(error);
  }
}

/**
 * Recovers the tracker that already existed, from the backend rather than from
 * the error body. One extra read, only on a conflict, and it returns the whole
 * truthful record instead of an id with no status attached.
 */
async function reconcileAlreadyTracked(
  externalJobId: string,
): Promise<ExternalTrackingResult> {
  try {
    const job = await api.getExternalJob(externalJobId);
    // A tracker the adapter refused (unknown status, unusable date) comes back
    // null, and null is reported as a failure rather than as "not tracked" —
    // the reader pressed a button and something really is wrong.
    return job.tracking
      ? { ok: true, tracking: job.tracking }
      : { ok: false, reason: "error" };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateExternalApplicationAction(
  applicationId: string,
  input: { status?: ExternalApplicationStatus; note?: string | null },
): Promise<ExternalTrackingResult> {
  try {
    return {
      ok: true,
      tracking: await api.updateExternalApplication(applicationId, input),
    };
  } catch (error) {
    return mutationFailure(error);
  }
}

/**
 * Deletes the candidate's own record and nothing else.
 *
 * It does not unsave the job, and it does not reach the employer. Somebody
 * tidying their tracking list has not withdrawn an application, and this
 * product is in no position to withdraw one on their behalf.
 */
export async function removeExternalApplicationAction(
  applicationId: string,
): Promise<{ ok: true } | ExternalMutationFailure> {
  try {
    await api.deleteExternalApplication(applicationId);
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Gemini "why this match"                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Generates one job's explanation, because the reader asked for it.
 *
 * ## Four outcomes, because four different things need saying
 *
 * A single "it failed" would collapse cases that call for opposite screens.
 * `plan_required` is not a failure and must never offer a retry — the request
 * will be refused identically forever, and a Retry button beside it is the
 * cruellest control this product could ship. `unavailable` and `error` MAY be
 * retried, because a model timeout or a dropped connection often clears.
 * `gone` means the listing left the catalogue between the search and the
 * click, which no amount of retrying will undo.
 *
 * ## Why the plan check is a mapped 403 and not a local test
 *
 * The session's entitlements decide what to OFFER; only the backend decides
 * what is permitted. A plan that lapsed a minute ago, a downgrade made in
 * another tab, or a capability the backend splits out later all resolve
 * correctly here and nowhere else.
 */

export type ExternalWhyMatchResult =
  | { ok: true; explanation: ExternalWhyMatch }
  | PremiumAiFailure;

export type PremiumAiFailure = {
  ok: false;
  reason: "plan_required" | "unavailable" | "gone" | "error";
  /** Set only for `plan_required`, so the paywall can name the plan. */
  requiredPlan?: CandidatePlan;
};

/**
 * One mapping for all three MAX tools, so they cannot drift apart.
 *
 * Three near-identical copies of this would drift the moment one of them
 * learned about a new status code, and the drift would be invisible: the
 * cover letter would start showing "something went wrong" for a refusal the
 * explanation correctly presents as a paywall, and nothing would fail.
 */
function premiumAiFailure(error: unknown): PremiumAiFailure {
  const upgrade = planUpgradeFrom(error, "EXTERNAL_AI_SEARCH");
  if (upgrade) {
    return {
      ok: false,
      reason: "plan_required",
      requiredPlan: upgrade.requiredPlan,
    };
  }

  if (error instanceof ApiError) {
    // The listing is gone, or the id is not one. Either way there is nothing
    // to generate and nothing to retry.
    if (error.status === 404 || error.status === 400) {
      return { ok: false, reason: "gone" };
    }
    // 503 is the model or its queue being briefly unable; 429 is this reader
    // having asked too often; 504 is it taking too long. All three clear on
    // their own, so all three are worth a retry — and none of them is
    // "something went wrong on our side".
    if (error.status === 503 || error.status === 429 || error.status === 504) {
      return { ok: false, reason: "unavailable" };
    }
  }

  return { ok: false, reason: "error" };
}

/**
 * The locale, read server-side from the same cookie the page rendered from,
 * so generated prose cannot arrive in a different language from the screen
 * around it. The browser never chooses this.
 */

export async function explainExternalMatchAction(
  externalJobId: string,
): Promise<ExternalWhyMatchResult> {
  const locale = await getLocale();

  try {
    return {
      ok: true,
      explanation: await api.explainExternalMatch(externalJobId, locale),
    };
  } catch (error) {
    return premiumAiFailure(error);
  }
}

/* -------------------------------------------------------------------------- */
/* Cover letter and interview prep                                             */
/* -------------------------------------------------------------------------- */

/**
 * ## Nothing here is stored
 *
 * A generated letter is returned to the reader and held for as long as they
 * are looking at it. This task saves no drafts, so there is no write path, no
 * record, and nothing that could later be mistaken for something the candidate
 * actually sent. The backend may cache the generation; that is its business
 * and is not a record of the candidate's either.
 */

export type ExternalCoverLetterResult =
  | { ok: true; letter: ExternalCoverLetter }
  | PremiumAiFailure;

export async function generateCoverLetterAction(
  externalJobId: string,
): Promise<ExternalCoverLetterResult> {
  const locale = await getLocale();

  try {
    return {
      ok: true,
      letter: await api.generateExternalCoverLetter(externalJobId, locale),
    };
  } catch (error) {
    return premiumAiFailure(error);
  }
}

export type ExternalInterviewPrepResult =
  | { ok: true; prep: ExternalInterviewPrep }
  | PremiumAiFailure;

export async function generateInterviewPrepAction(
  externalJobId: string,
): Promise<ExternalInterviewPrepResult> {
  const locale = await getLocale();

  try {
    return {
      ok: true,
      prep: await api.generateExternalInterviewPrep(externalJobId, locale),
    };
  } catch (error) {
    return premiumAiFailure(error);
  }
}


export type ExternalMatchBreakdownResult =
  | { ok: true; breakdown: ExternalMatchBreakdown }
  | PremiumAiFailure;

export async function generateMatchBreakdownAction(
  externalJobId: string,
): Promise<ExternalMatchBreakdownResult> {
  const locale = await getLocale();

  try {
    return {
      ok: true,
      breakdown: await api.generateExternalMatchBreakdown(externalJobId, locale),
    };
  } catch (error) {
    return premiumAiFailure(error);
  }
}

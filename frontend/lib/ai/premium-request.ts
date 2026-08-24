import type { CandidatePlan } from "@/lib/entitlements/plan";

/**
 * The lifecycle every on-demand MAX AI feature shares.
 *
 * "Why this match" is the first; cover letter, interview prep and the advanced
 * match breakdown are the same shape — a reader presses a button about ONE
 * subject, a generation runs, and one of a small set of outcomes lands. The
 * states and the rules for moving between them are here, as data, so each
 * feature contributes its request function and its rendering and nothing else.
 *
 * ## Why this is a pure module and not a hook
 *
 * The two rules that actually matter — a second click while a generation is in
 * flight must not start a second one, and an answer for a subject the reader
 * has moved on from must not be displayed — are both decisions about state,
 * not about React. Written as pure functions they are tested directly, in
 * milliseconds, without a renderer; written inside a hook they would be tested
 * by proxy, if at all, and duplicate-request bugs are exactly the kind that
 * survive that.
 *
 * ## Why `subjectId` is part of the state
 *
 * A panel that is reused as the reader opens job after job holds one slot of
 * state. Without the subject stamped on it, an explanation generated for job A
 * renders under job B's title the moment the reader switches — silently, and
 * looking entirely plausible. Every read here is "is this for the thing on
 * screen", never "is there a value".
 */

export type AiGenerationStatus =
  /** Nothing asked for yet. The button is the whole UI. */
  | "idle"
  | "loading"
  | "ready"
  /** Not a failure: the plan does not include this. Never offers a retry. */
  | "plan_required"
  /** The model or its queue is briefly unable. Retrying is reasonable. */
  | "unavailable"
  /** The subject left the catalogue. Nothing to generate, nothing to retry. */
  | "gone"
  | "error";

export interface AiRequestState<T> {
  /** What the state below belongs to. Null only before the first request. */
  subjectId: string | null;
  status: AiGenerationStatus;
  value: T | null;
  /** Set only alongside `plan_required`, so the paywall can name a plan. */
  requiredPlan: CandidatePlan | null;
}

export function idleAiRequest<T>(): AiRequestState<T> {
  return { subjectId: null, status: "idle", value: null, requiredPlan: null };
}

/**
 * The state as it applies to the subject currently on screen.
 *
 * State stamped with a different subject reads as `idle` — which is the honest
 * answer: for THIS job, nothing has been asked for yet. It is not cleared,
 * because returning to a job whose explanation is still in the slot should
 * show it again rather than spend a second generation on the same text.
 */
export function aiRequestFor<T>(
  state: AiRequestState<T>,
  subjectId: string,
): AiRequestState<T> {
  return state.subjectId === subjectId ? state : idleAiRequest<T>();
}

/**
 * Whether pressing the button should actually start a generation.
 *
 * Refuses in two cases, and they are refused for different reasons:
 *
 *   - A generation for this subject is already in flight. A double click, a
 *     double tap, or an impatient second press must not buy a second model
 *     call. This is the rule that costs real money if it is wrong.
 *   - This subject is already explained. The text is on screen; regenerating
 *     it spends the budget again to produce the same paragraphs.
 *
 * Every failed state DOES allow a start, which is what makes the retry
 * affordance work — except `plan_required`, which no amount of pressing will
 * change and which therefore never renders a button to press.
 */
export function canStartAiRequest<T>(
  state: AiRequestState<T>,
  subjectId: string,
): boolean {
  const current = aiRequestFor(state, subjectId);
  if (current.status === "loading") return false;
  if (current.status === "ready") return false;
  if (current.status === "plan_required") return false;
  return true;
}

export function startedAiRequest<T>(subjectId: string): AiRequestState<T> {
  return { subjectId, status: "loading", value: null, requiredPlan: null };
}

export function readyAiRequest<T>(
  subjectId: string,
  value: T,
): AiRequestState<T> {
  return { subjectId, status: "ready", value, requiredPlan: null };
}

export function failedAiRequest<T>(
  subjectId: string,
  status: Exclude<AiGenerationStatus, "idle" | "loading" | "ready">,
  requiredPlan: CandidatePlan | null = null,
): AiRequestState<T> {
  return {
    subjectId,
    status,
    value: null,
    // A plan is carried only where it means something; attaching one to a
    // model timeout would let a "Upgrade to Max" render over an outage.
    requiredPlan: status === "plan_required" ? requiredPlan : null,
  };
}

/** Whether this status should offer a retry. Plan refusals never do. */
export function isRetryable(status: AiGenerationStatus): boolean {
  return status === "unavailable" || status === "error";
}

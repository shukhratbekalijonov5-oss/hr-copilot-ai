import { ApiError } from "@/lib/api/errors";
import type { AiFailureReason } from "@/lib/types";

/**
 * Which part of the system failed.
 *
 * The product must not collapse these into "Something went wrong": a recruiter
 * needs to know whether generation is down (evidence search still works),
 * retrieval is down (nothing can be searched or cited), the network dropped, or
 * their role simply does not allow the action.
 *
 * `surface` says which capability the call needed, because a 503 means
 * different things on `/ai/answer` than on `/search/evidence` — the status code
 * alone cannot distinguish them.
 */
export type AiSurface = "generation" | "retrieval";

export function aiFailureReason(
  error: unknown,
  surface: AiSurface,
): AiFailureReason {
  if (!(error instanceof ApiError)) return "error";

  switch (error.kind) {
    case "network":
      return "network";
    case "unavailable":
      return surface === "generation"
        ? "generation_unavailable"
        : "retrieval_unavailable";
    case "forbidden":
      return "forbidden";
    case "not_found":
      return "not_found";
    case "validation":
      return "invalid";
    default:
      return "error";
  }
}

/**
 * Result shape every AI server action returns.
 *
 * A discriminated union rather than `{ data, error }` so a caller cannot read
 * `data` without having proved the call succeeded.
 */
export type AiActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: AiFailureReason; message: string };

/** Wraps a service call, normalising every failure into one reason. */
export async function runAiAction<T>(
  surface: AiSurface,
  run: () => Promise<T>,
): Promise<AiActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const reason = aiFailureReason(error, surface);
    return {
      ok: false,
      reason,
      // Kept for logging and for the `error` fallback; the UI prefers its own
      // translated copy for every reason it recognises, because a backend
      // message is English-only.
      message: error instanceof ApiError ? error.message : "AI request failed.",
    };
  }
}

/**
 * The single error type any screen ever sees.
 *
 * Backend responses are normalised here so no component knows the shape
 * NestJS produces, and so a stack trace or a driver message can never reach a
 * phone screen. `code` is the important field: the backend states stable
 * codes for the situations the UI must handle differently, and screens map
 * those to localized copy rather than printing the server's English prose.
 */
export type ApiErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "unavailable";

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly code: string | null;
  /** Scalar hints the API attaches to a refusal, e.g. `retryAfterSeconds`. */
  readonly details: Readonly<Record<string, string | number>>;

  constructor(
    message: string,
    status: number,
    kind: ApiErrorKind,
    code: string | null = null,
    details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.code = code;
    this.details = details;
  }

  get isAuthFailure(): boolean {
    return this.kind === "unauthorized";
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "server";
}

/** Codes the UI must recognise. Anything else falls back to generic copy. */
export const API_CODES = {
  LOGIN_TEMPORARILY_LOCKED: "LOGIN_TEMPORARILY_LOCKED",
  PLAN_UPGRADE_REQUIRED: "PLAN_UPGRADE_REQUIRED",
  NOTIFICATIONS_UNAVAILABLE: "NOTIFICATIONS_UNAVAILABLE",
} as const;

/** Reads a numeric hint the backend attached, e.g. the lockout countdown. */
export function numericDetail(error: unknown, key: string): number | null {
  if (!(error instanceof ApiError)) return null;
  const value = error.details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseErrorBody(
  body: unknown,
  status: number,
  fallback: string,
): ApiError {
  const kind = kindForStatus(status);
  if (!body || typeof body !== "object") {
    return new ApiError(fallback, status, kind);
  }

  const payload = body as Record<string, unknown>;
  const message =
    typeof payload.message === "string"
      ? payload.message
      : Array.isArray(payload.message) &&
          typeof payload.message[0] === "string"
        ? payload.message[0]
        : fallback;
  const code = typeof payload.code === "string" ? payload.code : null;

  // Only scalars, only top level: enough for the handful of machine-readable
  // hints this API attaches, never a raw payload for screens to rummage in.
  const details: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "message" || key === "code") continue;
    if (typeof value === "string" || typeof value === "number") {
      details[key] = value;
    }
  }

  return new ApiError(message, status, kind, code, details);
}

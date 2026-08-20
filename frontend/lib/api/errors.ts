/**
 * The single error type the UI ever sees.
 *
 * Backend responses are normalised here so no component has to know the shape
 * NestJS produces, and so a raw driver message or stack trace can never reach
 * the screen.
 */

export interface FieldErrors {
  [field: string]: string;
}

export type ApiErrorKind =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server"
  | "network"
  | "unavailable";

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly fieldErrors: FieldErrors;
  readonly code: string | null;

  constructor(
    message: string,
    status = 500,
    kind: ApiErrorKind = "server",
    fieldErrors: FieldErrors = {},
    code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }

  get isAuthFailure(): boolean {
    return this.kind === "unauthorized";
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "server";
}

/** Copy shown to the user. Backend text is used only where it is safe to. */
const FALLBACK_MESSAGES: Record<ApiErrorKind, string> = {
  validation: "Please check the highlighted fields and try again.",
  unauthorized: "Your session has expired. Sign in again to continue.",
  forbidden: "Your role does not allow this action.",
  not_found: "We could not find what you were looking for.",
  conflict: "That conflicts with something that already exists.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  server: "Something went wrong on our side. Try again shortly.",
  network: "Could not reach the server. Check your connection and try again.",
  unavailable: "This service is temporarily unavailable. Try again shortly.",
};

/**
 * class-validator returns `message: string[]` of the form
 * "organizationSlug must be ...". The leading token is the field name, which
 * lets the form highlight the right input.
 */
function toFieldErrors(messages: string[]): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const message of messages) {
    const field = message.split(" ")[0];
    if (!field || !/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(field)) continue;
    // Keep the first message per field: class-validator emits one per failed
    // constraint and the first is the most specific.
    if (!fieldErrors[field]) fieldErrors[field] = capitalize(message);
  }

  return fieldErrors;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface NestErrorBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
  code?: string;
}

/** Builds an ApiError from a non-OK backend response. */
export async function apiErrorFromResponse(
  response: Response,
): Promise<ApiError> {
  const kind = kindForStatus(response.status);

  let body: NestErrorBody | null = null;
  try {
    body = (await response.json()) as NestErrorBody;
  } catch {
    // A non-JSON error body carries nothing we can safely surface.
  }

  if (Array.isArray(body?.message)) {
    const fieldErrors = toFieldErrors(body.message);
    return new ApiError(
      body.message[0] ? capitalize(body.message[0]) : FALLBACK_MESSAGES[kind],
      response.status,
      kind,
      fieldErrors,
      typeof body.code === "string" ? body.code : null,
    );
  }

  // A 500 body is never echoed: it is the one case that can contain internals.
  const message =
    kind === "server" || typeof body?.message !== "string"
      ? FALLBACK_MESSAGES[kind]
      : body.message;

  return new ApiError(
    message,
    response.status,
    kind,
    {},
    typeof body?.code === "string" ? body.code : null,
  );
}

export function networkError(): ApiError {
  return new ApiError(FALLBACK_MESSAGES.network, 0, "network");
}

/** Turns anything thrown into an ApiError so callers have one shape to handle. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(FALLBACK_MESSAGES.server, 500, "server");
}

/** User-facing message for any thrown value. */
export function errorMessage(error: unknown): string {
  return toApiError(error).message;
}

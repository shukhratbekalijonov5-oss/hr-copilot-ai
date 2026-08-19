/**
 * Transport boundary for the whole app.
 *
 * Every service in `lib/api` goes through `mockRequest`. When the backend is
 * ready, replace the body of `mockRequest` with a `fetch` against
 * `NEXT_PUBLIC_API_BASE_URL` — no component or page needs to change.
 */

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldErrors;

  constructor(message: string, status = 400, fieldErrors: FieldErrors = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Simulated round-trip so loading states are exercised during development. */
const DEFAULT_LATENCY_MS = 260;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function mockRequest<T>(
  produce: () => T | Promise<T>,
  latencyMs: number = DEFAULT_LATENCY_MS,
): Promise<T> {
  await delay(latencyMs);
  return produce();
}

/** Case-insensitive "does this record match the search box" helper. */
export function matchesSearch(term: string, ...fields: (string | null | undefined)[]) {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}

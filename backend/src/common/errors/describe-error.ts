/**
 * Produces a log/diagnostic message that actually says what went wrong.
 *
 * Prisma reports a connection failure as a PrismaClientKnownRequestError whose
 * message is only "Invalid `prisma.$queryRaw()` invocation:" — the useful part
 * (e.g. `ECONNREFUSED`) sits on `.code`. Other drivers nest theirs under
 * `.cause`. Both are collected here, so callers get something actionable.
 *
 * Safe to surface: driver codes and messages carry no credentials, and nothing
 * here adds a connection string back in.
 */
export function describeError(error: unknown, maxLength = 300): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && !parts.includes(code)) parts.push(code);

    const message = current.message.trim();
    if (message && !parts.includes(message)) parts.push(message);

    current = current.cause;
  }

  if (parts.length === 0 && typeof error === 'string') parts.push(error);

  const combined = parts.join(': ').replace(/\s+/g, ' ').trim();
  return combined.slice(0, maxLength) || 'Unknown error';
}

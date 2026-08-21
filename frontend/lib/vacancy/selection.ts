import type { MyVacancy } from "@/lib/types";

/**
 * The selected vacancy — one canonical piece of state.
 *
 * HR users work inside vacancies they created, so nearly every recruiter
 * surface is "this candidate / this pipeline / this evidence, *within the
 * selected vacancy*". That selection lives in the URL (`?vacancyId=`) rather
 * than in component state for four reasons: a refresh keeps it, back/forward
 * behave, a link can carry it (a future notification can deep-link straight
 * into candidate + vacancy), and — because the App Router re-renders the
 * server component tree when a search param changes — every vacancy-dependent
 * section refetches on a switch with no client cache to invalidate.
 *
 * That last point is why there are no query keys here. Vacancy-dependent data
 * is fetched per request on the server, keyed by the URL itself, so "stale
 * vacancy A content under vacancy B" cannot be rendered: the fetch that
 * produced A belongs to a URL that is no longer mounted. React's `key` on the
 * dependent subtree turns the switch into a remount, so a slow A response
 * cannot land in a B tree either.
 *
 * The selection is never trusted as authority. The backend re-validates
 * ownership and candidate association on every single request, so a stale or
 * hand-typed id degrades to a localized 403/404 — never to another user's data.
 */

/** The query parameter every vacancy-scoped surface reads and writes. */
export const VACANCY_PARAM = "vacancyId";

/** Reads the selected vacancy id out of already-awaited search params. */
export function selectedVacancyId(
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  const raw = searchParams[VACANCY_PARAM];
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || null;
}

/**
 * Resolves the vacancy to work inside.
 *
 * A requested id is honoured only when it is one of the caller's own; anything
 * else (a colleague's vacancy, a deleted one, a typo) resolves to `null` with
 * `invalid: true` so the screen can say so instead of silently showing a
 * different vacancy's data. Never auto-substitutes for an explicit request —
 * quietly reinterpreting an unauthorized id is exactly the behaviour the
 * ownership rule exists to prevent.
 *
 * With no request at all, the newest own vacancy is a safe default: the user
 * asked for nothing in particular, so there is nothing to misrepresent.
 */
export function resolveVacancySelection(
  vacancies: MyVacancy[],
  requestedId: string | null,
): { selected: MyVacancy | null; invalid: boolean } {
  if (requestedId) {
    const match = vacancies.find((vacancy) => vacancy.id === requestedId);
    return match
      ? { selected: match, invalid: false }
      : { selected: null, invalid: true };
  }

  return { selected: vacancies[0] ?? null, invalid: false };
}

/** Builds a URL with the vacancy selection applied, preserving other params. */
export function withVacancyParam(
  pathname: string,
  params: URLSearchParams,
  vacancyId: string | null,
): string {
  const next = new URLSearchParams(params);
  if (vacancyId) next.set(VACANCY_PARAM, vacancyId);
  else next.delete(VACANCY_PARAM);

  // Paging and per-vacancy selections belong to the old vacancy.
  next.delete("page");

  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

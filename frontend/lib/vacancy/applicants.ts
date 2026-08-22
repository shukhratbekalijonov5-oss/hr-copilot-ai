import type { Application, ID, VacancyCandidate } from "@/lib/types";

/**
 * One vacancy's applicant list, as a list of PEOPLE rather than attempts.
 *
 * Since reapply-after-rejection shipped, a candidate can hold several
 * applications to the same vacancy: a rejection ends an attempt, not the
 * relationship. `GET /applications` is — correctly — an attempt-level
 * endpoint, so it returns one row per attempt and every consumer that renders
 * it verbatim shows the same person three times.
 *
 * The recruiter's mental model is the candidate-vacancy relationship, so the
 * list is grouped here, on the read side. Nothing is merged, rewritten or
 * dropped: every attempt survives inside its row, and the row's operational
 * state (stage, applied date, the id every action targets) comes from the
 * CURRENT attempt — the newest one — so an old rejected attempt can never
 * present itself as the candidate's stage.
 *
 * Grouping is by database candidate id, never by name or email: two real
 * people who share a name must stay two rows, and one person whose display
 * name changed must stay one.
 */
export interface ApplicantRow {
  /** Stable identity of the row — also its React key. */
  candidateId: ID;
  /** Denormalized candidate summary, taken from the current attempt. */
  candidate: Application["candidate"];
  /**
   * The live attempt: newest by `createdAt`. Drives the row's stage, its
   * applied date, and every application-scoped action or link.
   */
  current: Application;
  /** Every attempt, newest first. `attempts[0] === current`, always. */
  attempts: Application[];
  /** `attempts.length`, so callers need no second derivation. */
  attemptCount: number;
}

/**
 * Newest first, deterministically.
 *
 * `createdAt` is the applied moment and decides the order. Two attempts can
 * share a millisecond (a double-submit, a seeded fixture), so ties fall
 * through to `updatedAt` and finally to the id — an arbitrary but STABLE
 * choice, which is what matters: the same input must always name the same
 * attempt "current", or a row's actions would target a different application
 * between two renders of the same data.
 */
interface AttemptStamp {
  id: string;
  createdAt: string;
  updatedAt?: string;
}

function compareRecencyDesc(a: AttemptStamp, b: AttemptStamp): number {
  const created =
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (created !== 0) return created;

  const updated =
    new Date(b.updatedAt ?? b.createdAt).getTime() -
    new Date(a.updatedAt ?? a.createdAt).getTime();
  if (updated !== 0) return updated;

  return b.id.localeCompare(a.id);
}

function byRecencyDesc(a: Application, b: Application): number {
  return compareRecencyDesc(a, b);
}

/**
 * Collapses attempts into one row per candidate.
 *
 * Rows come back ordered by their current attempt, newest first — the same
 * order the attempt list already had (the API sorts `createdAt` desc), just
 * with each person appearing once, at the position of their newest attempt.
 * Sorting the rows by anything application-derived therefore reads the live
 * attempt and never an old rejected one.
 *
 * The input is not mutated.
 */
export function groupApplicantsByCandidate(
  applications: Application[],
): ApplicantRow[] {
  const byCandidate = new Map<ID, Application[]>();
  for (const application of applications) {
    const existing = byCandidate.get(application.candidateId);
    if (existing) existing.push(application);
    else byCandidate.set(application.candidateId, [application]);
  }

  const rows: ApplicantRow[] = [];
  for (const [candidateId, group] of byCandidate) {
    const attempts = [...group].sort(byRecencyDesc);
    const current = attempts[0];
    rows.push({
      candidateId,
      // The newest attempt carries the freshest denormalized summary; older
      // attempts are only a fallback for a payload that omitted it.
      candidate:
        current.candidate ??
        attempts.find((attempt) => attempt.candidate)?.candidate,
      current,
      attempts,
      attemptCount: attempts.length,
    });
  }

  return rows.sort((a, b) => byRecencyDesc(a.current, b.current));
}

/**
 * The attempt number a given attempt holds in the candidate's history, as a
 * person counts them: the FIRST application is attempt 1.
 *
 * `attempts` is newest-first, so the label is the inverse of the index. Kept
 * next to the grouping so the two orderings can never drift apart.
 */
export function attemptNumber(row: ApplicantRow, index: number): number {
  return row.attemptCount - index;
}

/**
 * The one candidate-vacancy relationship behind Candidate Detail.
 *
 * Candidate Detail asks the mirror-image question the vacancy applicant list
 * asks — "this candidate, in THIS vacancy" instead of "this vacancy, all its
 * candidates" — and it must answer with the SAME current attempt, or the two
 * screens would disagree about a person's stage.
 *
 * So it is the same function, given the one vacancy's attempts: filtering a
 * single candidate's applications down to one vacancy leaves at most one row.
 * There is deliberately no second "pick the latest" rule to drift out of sync.
 */
export function vacancyAttempts(
  applications: Application[],
  vacancyId: string | null,
): ApplicantRow | null {
  if (!vacancyId) return null;

  const rows = groupApplicantsByCandidate(
    applications.filter((application) => application.vacancyId === vacancyId),
  );
  return rows[0] ?? null;
}

/**
 * The vacancies a candidate is in, once each.
 *
 * The candidate-global application list has one entry per ATTEMPT, so a
 * re-applicant's vacancy appears several times. Grouping by vacancy — with the
 * same recency rule — gives one row per pipeline, carrying its current attempt
 * and how many attempts it took.
 */
export function attemptsByVacancy(
  applications: Application[],
): Array<{
  vacancyId: ID;
  vacancy: Application["vacancy"];
  current: Application;
  attempts: Application[];
  attemptCount: number;
}> {
  const byVacancy = new Map<ID, Application[]>();
  for (const application of applications) {
    const existing = byVacancy.get(application.vacancyId);
    if (existing) existing.push(application);
    else byVacancy.set(application.vacancyId, [application]);
  }

  return [...byVacancy.entries()]
    .map(([vacancyId, group]) => {
      const attempts = [...group].sort(byRecencyDesc);
      const current = attempts[0];
      return {
        vacancyId,
        vacancy:
          current.vacancy ??
          attempts.find((attempt) => attempt.vacancy)?.vacancy,
        current,
        attempts,
        attemptCount: attempts.length,
      };
    })
    .sort((a, b) => byRecencyDesc(a.current, b.current));
}

/**
 * The other pipelines a recruiter may actually open for this candidate.
 *
 * `candidate.applications` is ORGANIZATION-scoped — every vacancy the person
 * applied to anywhere in the org, including vacancies a colleague created. HR
 * vacancy workflows are creator-scoped, so those rows are ones the backend
 * will refuse; rendering them offers a link that can only 403/404.
 *
 * So the list is an INTERSECTION with the caller's own vacancies. Nothing is
 * authorized here — `openableIds` comes from the server, which resolved it as
 * "this candidate's applications AND the caller's own vacancies" — this only
 * declines to advertise what the backend would reject. Weakening the backend
 * to make a bad link work would be the wrong direction entirely.
 *
 * Matching is on vacancy ID. Titles are not unique: an org can run three
 * "Application Security Engineer" vacancies at once, and matching on the title
 * would hide owned ones and surface foreign ones in the same stroke.
 *
 * The active vacancy is excluded — it already has its own section — and
 * re-application attempts collapse to one row per vacancy.
 */
export function openableOtherVacancies(
  applications: Application[],
  openableIds: Iterable<ID>,
  selectedVacancyId: ID | null,
): ReturnType<typeof attemptsByVacancy> {
  const openable = new Set(openableIds);
  return attemptsByVacancy(applications).filter(
    (row) =>
      openable.has(row.vacancyId) && row.vacancyId !== selectedVacancyId,
  );
}

/**
 * The same collapse for `/vacancies/:id/candidates` rows.
 *
 * That endpoint is attempt-level too — it returns one row per application —
 * and it feeds the Compare pool, where a re-applicant is not merely an ugly
 * repeated row: the picker keys on `candidate.id`, and the default selection
 * (the first three rows) would silently become the SAME person three times.
 *
 * Each surviving row keeps the newest attempt's stage and applied date, so
 * "in this vacancy" still means what it meant before.
 */
export function dedupeVacancyCandidates(
  rows: VacancyCandidate[],
): VacancyCandidate[] {
  const newestByCandidate = new Map<ID, VacancyCandidate>();
  for (const row of rows) {
    const held = newestByCandidate.get(row.candidate.id);
    if (!held || compareRecencyDesc(row.application, held.application) < 0) {
      newestByCandidate.set(row.candidate.id, row);
    }
  }

  return [...newestByCandidate.values()].sort((a, b) =>
    compareRecencyDesc(a.application, b.application),
  );
}

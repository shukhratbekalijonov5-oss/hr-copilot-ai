import { describe, expect, it } from "vitest";
import {
  attemptNumber,
  attemptsByVacancy,
  dedupeVacancyCandidates,
  groupApplicantsByCandidate,
  openableOtherVacancies,
  vacancyAttempts,
} from "@/lib/vacancy/applicants";
import type {
  Application,
  ApplicationStatus,
  VacancyCandidate,
} from "@/lib/types";

/**
 * The applicant list a recruiter reads is a list of PEOPLE. The API it is
 * built from is a list of ATTEMPTS, and since reapply-after-rejection one
 * person can own several of them on one vacancy. These tests pin the collapse
 * between the two: one row per candidate, driven by the newest attempt, with
 * every earlier attempt still present underneath.
 */

const VACANCY = "vac-1";

function application(
  id: string,
  candidateId: string,
  createdAt: string,
  status: ApplicationStatus = "NEW",
  overrides: Partial<Application> = {},
): Application {
  return {
    id,
    candidateId,
    vacancyId: VACANCY,
    status,
    source: "DIRECT",
    createdAt,
    updatedAt: createdAt,
    candidate: {
      id: candidateId,
      fullName: `Candidate ${candidateId}`,
      currentTitle: "Engineer",
    },
    ...overrides,
  };
}

/** The API returns attempts newest-first; every fixture mirrors that. */
function clara(): Application[] {
  return [
    application("a3", "clara", "2026-08-21T18:45:18.635Z", "NEW"),
    application("a2", "clara", "2026-08-21T18:40:23.870Z", "REJECTED"),
    application("a1", "clara", "2026-08-21T18:40:05.470Z", "REJECTED"),
  ];
}

describe("groupApplicantsByCandidate", () => {
  it("renders a candidate with a single application as one row", () => {
    const rows = groupApplicantsByCandidate([
      application("a1", "sofia", "2026-08-21T12:36:41.082Z"),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBe("sofia");
    expect(rows[0].attemptCount).toBe(1);
    expect(rows[0].current.id).toBe("a1");
  });

  it("collapses two attempts by one candidate into one row", () => {
    const rows = groupApplicantsByCandidate([
      application("a2", "uchqun", "2026-08-21T18:00:00.000Z", "NEW"),
      application("a1", "uchqun", "2026-08-20T09:00:00.000Z", "REJECTED"),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].attemptCount).toBe(2);
  });

  it("collapses three attempts into one row and counts them", () => {
    const rows = groupApplicantsByCandidate(clara());

    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBe("clara");
    expect(rows[0].attemptCount).toBe(3);
  });

  it("shows the newest attempt's status as the row's current stage", () => {
    const rows = groupApplicantsByCandidate(clara());

    expect(rows[0].current.id).toBe("a3");
    expect(rows[0].current.status).toBe("NEW");
  });

  it("never lets an older rejected attempt override a newer active one", () => {
    // The bug this whole module exists to make impossible: the ORDER the API
    // happens to return attempts in must not decide the row's stage. Same
    // three attempts, oldest first.
    const rows = groupApplicantsByCandidate([...clara()].reverse());

    expect(rows[0].current.status).toBe("NEW");
    expect(rows[0].current.id).toBe("a3");
    expect(rows[0].attempts.map((attempt) => attempt.id)).toEqual([
      "a3",
      "a2",
      "a1",
    ]);
  });

  it("keeps two different candidates as two rows", () => {
    const rows = groupApplicantsByCandidate([
      ...clara(),
      application("b1", "aziz", "2026-08-21T12:36:43.604Z"),
      application("c1", "sofia", "2026-08-21T12:36:41.082Z"),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.candidateId)).toEqual([
      "clara",
      "aziz",
      "sofia",
    ]);
  });

  it("groups by database identity, never by display name or email", () => {
    // Two real people who happen to share a name stay two rows...
    const namesakes = groupApplicantsByCandidate([
      application("a1", "person-1", "2026-08-21T10:00:00.000Z", "NEW", {
        candidate: { id: "person-1", fullName: "Alex Kim", currentTitle: null },
      }),
      application("a2", "person-2", "2026-08-20T10:00:00.000Z", "NEW", {
        candidate: { id: "person-2", fullName: "Alex Kim", currentTitle: null },
      }),
    ]);
    expect(namesakes).toHaveLength(2);

    // ...and one person whose name changed between attempts stays one row.
    const renamed = groupApplicantsByCandidate([
      application("a2", "person-1", "2026-08-21T10:00:00.000Z", "NEW", {
        candidate: { id: "person-1", fullName: "Alex Park", currentTitle: null },
      }),
      application("a1", "person-1", "2026-08-20T10:00:00.000Z", "REJECTED", {
        candidate: { id: "person-1", fullName: "Alex Kim", currentTitle: null },
      }),
    ]);
    expect(renamed).toHaveLength(1);
    // The newest attempt carries the freshest summary.
    expect(renamed[0].candidate?.fullName).toBe("Alex Park");
  });

  it("keeps vacancies separate — grouping is scoped to the list it is given", () => {
    // The vacancy list is fetched per vacancy, so the same candidate applying
    // elsewhere never reaches this input. If two vacancies were ever mixed,
    // the row must still describe only one of them.
    const rows = groupApplicantsByCandidate([
      application("a1", "clara", "2026-08-21T10:00:00.000Z"),
    ]);
    expect(rows[0].current.vacancyId).toBe(VACANCY);
    expect(
      rows[0].attempts.every((attempt) => attempt.vacancyId === VACANCY),
    ).toBe(true);
  });

  it("gives every row a stable, unique key — no duplicate React keys", () => {
    const rows = groupApplicantsByCandidate([
      ...clara(),
      application("b1", "aziz", "2026-08-21T12:36:43.604Z"),
    ]);

    const keys = rows.map((row) => row.candidateId);
    expect(new Set(keys).size).toBe(keys.length);

    // And the history list underneath keys on the attempt id, which is unique
    // within the row.
    for (const row of rows) {
      const attemptKeys = row.attempts.map((attempt) => attempt.id);
      expect(new Set(attemptKeys).size).toBe(attemptKeys.length);
    }
  });

  it("targets row-level actions at the current application", () => {
    // Whatever a row does — open the stage menu, reject, delete — it hands
    // over `current.id`. An action pointed at an already-rejected attempt
    // would silently do nothing visible.
    const [row] = groupApplicantsByCandidate(clara());
    expect(row.current.id).toBe("a3");
    expect(row.current.id).toBe(row.attempts[0].id);
  });

  it("orders rows by each candidate's current attempt, newest first", () => {
    // Aziz's newest attempt is older than Clara's newest but newer than
    // Clara's oldest: sorting must read the current attempt, not any attempt.
    const rows = groupApplicantsByCandidate([
      ...clara(),
      application("b1", "aziz", "2026-08-21T18:42:00.000Z"),
    ]);

    expect(rows.map((row) => row.candidateId)).toEqual(["clara", "aziz"]);
  });

  it("orders history newest-first while numbering attempts oldest-first", () => {
    const [row] = groupApplicantsByCandidate(clara());

    expect(
      row.attempts.map((attempt, index) => attemptNumber(row, index)),
    ).toEqual([3, 2, 1]);
  });

  it("counts people, not attempts", () => {
    // The "N candidates attached" line and the at-a-glance tile both read the
    // row count. Five attempts by three people is three candidates.
    const rows = groupApplicantsByCandidate([
      ...clara(),
      application("b1", "aziz", "2026-08-21T12:36:43.604Z"),
      application("c1", "sofia", "2026-08-21T12:36:41.082Z"),
    ]);

    expect(rows).toHaveLength(3);
  });

  it("picks a deterministic current attempt when timestamps tie", () => {
    const tied = [
      application("a1", "clara", "2026-08-21T10:00:00.000Z"),
      application("a2", "clara", "2026-08-21T10:00:00.000Z"),
    ];

    const forwards = groupApplicantsByCandidate(tied);
    const backwards = groupApplicantsByCandidate([...tied].reverse());

    expect(forwards[0].current.id).toBe(backwards[0].current.id);
  });

  it("preserves every historical attempt — nothing is dropped or merged", () => {
    const input = clara();
    const [row] = groupApplicantsByCandidate(input);

    expect(row.attempts).toHaveLength(input.length);
    expect(new Set(row.attempts.map((attempt) => attempt.id))).toEqual(
      new Set(input.map((attempt) => attempt.id)),
    );
    expect(row.attempts.map((attempt) => attempt.status)).toEqual([
      "NEW",
      "REJECTED",
      "REJECTED",
    ]);
  });

  it("does not mutate the list it was given", () => {
    const input = [...clara()].reverse();
    const order = input.map((attempt) => attempt.id);

    groupApplicantsByCandidate(input);

    expect(input.map((attempt) => attempt.id)).toEqual(order);
  });

  it("returns nothing for a vacancy with no applications", () => {
    expect(groupApplicantsByCandidate([])).toEqual([]);
  });

  it("still renders a row when only historical attempts remain", () => {
    // Rejected-and-never-re-applied. The relationship is still real, so the
    // candidate keeps their row — the stage simply reads REJECTED. No new
    // eligibility rule is invented here.
    const rows = groupApplicantsByCandidate([
      application("a2", "clara", "2026-08-21T10:00:00.000Z", "REJECTED"),
      application("a1", "clara", "2026-08-20T10:00:00.000Z", "REJECTED"),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].current.status).toBe("REJECTED");
    expect(rows[0].attemptCount).toBe(2);
  });
});

function poolRow(
  applicationId: string,
  candidateId: string,
  createdAt: string,
  status: ApplicationStatus = "NEW",
): VacancyCandidate {
  return {
    candidate: {
      id: candidateId,
      fullName: `Candidate ${candidateId}`,
      email: null,
      phone: null,
      location: null,
      currentTitle: null,
      totalExperienceYears: null,
      documentCount: 1,
      evidenceCount: 0,
    },
    application: { id: applicationId, status, createdAt },
  };
}

describe("dedupeVacancyCandidates", () => {
  const pool = [
    poolRow("a3", "clara", "2026-08-21T18:45:18.635Z", "NEW"),
    poolRow("a2", "clara", "2026-08-21T18:40:23.870Z", "REJECTED"),
    poolRow("a1", "clara", "2026-08-21T18:40:05.470Z", "REJECTED"),
    poolRow("b1", "aziz", "2026-08-21T12:36:43.604Z"),
    poolRow("c1", "sofia", "2026-08-21T12:36:41.082Z"),
  ];

  it("gives the Compare pool one row per candidate", () => {
    expect(dedupeVacancyCandidates(pool).map((row) => row.candidate.id)).toEqual(
      ["clara", "aziz", "sofia"],
    );
  });

  it("keeps the newest attempt's stage on the surviving row", () => {
    const [clara] = dedupeVacancyCandidates(pool);
    expect(clara.application.id).toBe("a3");
    expect(clara.application.status).toBe("NEW");
  });

  it("survives an oldest-first payload", () => {
    const [clara] = dedupeVacancyCandidates([...pool].reverse());
    expect(clara.application.id).toBe("a3");
  });

  it("stops the default selection from picking one person three times", () => {
    // The picker takes the first three rows as the initial comparison. On the
    // raw payload that is Clara, Clara and Clara.
    const raw = pool.slice(0, 3).map((row) => row.candidate.id);
    expect(new Set(raw).size).toBe(1);

    const deduped = dedupeVacancyCandidates(pool)
      .slice(0, 3)
      .map((row) => row.candidate.id);
    expect(new Set(deduped).size).toBe(3);
  });

  it("gives the picker unique React keys", () => {
    const keys = dedupeVacancyCandidates(pool).map((row) => row.candidate.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves a pool with no re-applicants untouched", () => {
    const simple = [
      poolRow("b1", "aziz", "2026-08-21T12:36:43.604Z"),
      poolRow("c1", "sofia", "2026-08-21T12:36:41.082Z"),
    ];
    expect(dedupeVacancyCandidates(simple)).toEqual(simple);
    expect(dedupeVacancyCandidates([])).toEqual([]);
  });
});

/**
 * Candidate Detail's half of the same relationship. It must answer with the
 * SAME current attempt the vacancy applicant list shows, or the two screens
 * would disagree about a person's stage.
 */
describe("vacancyAttempts — Candidate Detail", () => {
  const OTHER = "vac-2";
  const across = [
    ...clara(),
    { ...application("z1", "clara", "2026-08-22T09:00:00.000Z", "REVIEWING"), vacancyId: OTHER },
  ];

  it("uses the latest attempt for the active vacancy", () => {
    const row = vacancyAttempts(across, VACANCY);
    expect(row?.current.id).toBe("a3");
    expect(row?.current.status).toBe("NEW");
  });

  it("reports the attempt count for the active vacancy only", () => {
    expect(vacancyAttempts(across, VACANCY)?.attemptCount).toBe(3);
    expect(vacancyAttempts(across, OTHER)?.attemptCount).toBe(1);
  });

  it("keeps every previous attempt available as history, newest first", () => {
    const row = vacancyAttempts(across, VACANCY);
    expect(row?.attempts.map((attempt) => attempt.id)).toEqual([
      "a3",
      "a2",
      "a1",
    ]);
    expect(row?.attempts.map((attempt) => attempt.status)).toEqual([
      "NEW",
      "REJECTED",
      "REJECTED",
    ]);
  });

  it("marks the current attempt unambiguously", () => {
    const row = vacancyAttempts(across, VACANCY)!;
    const current = row.attempts.filter(
      (attempt) => attempt.id === row.current.id,
    );
    expect(current).toHaveLength(1);
  });

  it("agrees with the vacancy applicant list about which attempt is current", () => {
    // The whole point of sharing the function: one algorithm, one answer.
    const fromVacancyList = groupApplicantsByCandidate(clara())[0].current.id;
    expect(vacancyAttempts(across, VACANCY)?.current.id).toBe(fromVacancyList);
  });

  it("keeps vacancies isolated — another vacancy's attempts never leak in", () => {
    const row = vacancyAttempts(across, OTHER);
    expect(row?.attempts.every((a) => a.vacancyId === OTHER)).toBe(true);
    expect(row?.current.status).toBe("REVIEWING");
  });

  it("resolves to nothing without a vacancy context", () => {
    expect(vacancyAttempts(across, null)).toBeNull();
    expect(vacancyAttempts(across, "vac-unknown")).toBeNull();
  });
});

describe("attemptsByVacancy — the other pipelines list", () => {
  it("lists a re-applicant's vacancy once, with its attempt count", () => {
    const rows = attemptsByVacancy([
      ...clara(),
      { ...application("z1", "clara", "2026-08-22T09:00:00.000Z"), vacancyId: "vac-2" },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.vacancyId)).toEqual(["vac-2", VACANCY]);
    expect(rows[1].attemptCount).toBe(3);
    expect(rows[1].current.id).toBe("a3");
  });

  it("gives every row a unique key", () => {
    const keys = attemptsByVacancy(clara()).map((row) => row.vacancyId);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The other pipelines a recruiter may open.
 *
 * `candidate.applications` is organization-scoped, but HR vacancy workflows
 * are creator-scoped — so the two sets are not the same, and the difference is
 * exactly the links that can only 403.
 */
describe("openableOtherVacancies", () => {
  function applied(vacancyId: string, id: string, createdAt: string) {
    return {
      ...application(id, "clara", createdAt),
      vacancyId,
      vacancy: { id: vacancyId, title: `Vacancy ${vacancyId}`, status: "OPEN" as const },
    };
  }

  it("shows the other owned vacancies and excludes the selected one", () => {
    const applications = [
      applied("v1", "a1", "2026-08-20T10:00:00.000Z"),
      applied("v2", "a2", "2026-08-21T10:00:00.000Z"),
      applied("v3", "a3", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["v1", "v2", "v3"], "v1");
    expect(rows.map((row) => row.vacancyId)).toEqual(["v3", "v2"]);
  });

  it("hides a vacancy owned by another organization", () => {
    const applications = [
      applied("mine", "a1", "2026-08-21T10:00:00.000Z"),
      applied("foreign", "a2", "2026-08-22T10:00:00.000Z"),
    ];

    // The server's owned-vacancy universe simply does not contain it.
    const rows = openableOtherVacancies(applications, ["mine"], null);
    expect(rows.map((row) => row.vacancyId)).toEqual(["mine"]);
  });

  it("hides a same-organization vacancy created by a different recruiter", () => {
    // The case the backend was already refusing: same tenant, different
    // creator. Creator scope is the product rule, so the row must not be
    // offered even though it is genuinely in this candidate's history.
    const applications = [
      applied("mine", "a1", "2026-08-21T10:00:00.000Z"),
      applied("colleagues", "a2", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["mine"], null);
    expect(rows.map((row) => row.vacancyId)).toEqual(["mine"]);
  });

  it("lists a vacancy once however many times the candidate re-applied", () => {
    const applications = [
      applied("v1", "a1", "2026-08-18T10:00:00.000Z"),
      applied("v1", "a2", "2026-08-19T10:00:00.000Z"),
      applied("v1", "a3", "2026-08-20T10:00:00.000Z"),
      applied("v2", "b1", "2026-08-21T10:00:00.000Z"),
      applied("v2", "b2", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["v1", "v2"], null);
    expect(rows.map((row) => row.vacancyId)).toEqual(["v2", "v1"]);
    expect(rows.map((row) => row.attemptCount)).toEqual([2, 3]);
    // And each row's current attempt is the newest one.
    expect(rows.map((row) => row.current.id)).toEqual(["b2", "a3"]);
  });

  it("decides on vacancy id, never on title", () => {
    // Three real vacancies called "Application Security Engineer"; only one is
    // this recruiter's. A title match would hide the owned one and surface the
    // other two.
    const sameTitle = (vacancyId: string, id: string, createdAt: string) => ({
      ...application(id, "clara", createdAt),
      vacancyId,
      vacancy: {
        id: vacancyId,
        title: "Application Security Engineer",
        status: "OPEN" as const,
      },
    });
    const applications = [
      sameTitle("owned", "a1", "2026-08-20T10:00:00.000Z"),
      sameTitle("foreign-1", "a2", "2026-08-21T10:00:00.000Z"),
      sameTitle("foreign-2", "a3", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["owned"], null);
    expect(rows.map((row) => row.vacancyId)).toEqual(["owned"]);
  });

  it("never repeats the selected vacancy as an 'other' one", () => {
    const applications = [
      applied("v1", "a1", "2026-08-20T10:00:00.000Z"),
      applied("v1", "a2", "2026-08-21T10:00:00.000Z"),
      applied("v2", "b1", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["v1", "v2"], "v1");
    expect(rows.map((row) => row.vacancyId)).toEqual(["v2"]);
    expect(rows.some((row) => row.vacancyId === "v1")).toBe(false);
  });

  it("gives every row a unique key and an id a link can be built from", () => {
    const applications = [
      applied("v1", "a1", "2026-08-20T10:00:00.000Z"),
      applied("v1", "a2", "2026-08-21T10:00:00.000Z"),
      applied("v2", "b1", "2026-08-22T10:00:00.000Z"),
    ];

    const rows = openableOtherVacancies(applications, ["v1", "v2"], null);
    const keys = rows.map((row) => row.vacancyId);
    expect(new Set(keys).size).toBe(keys.length);
    // Every row carries the candidate + vacancy pair the link needs.
    for (const row of rows) {
      expect(row.current.candidateId).toBe("clara");
      expect(row.vacancyId).toBeTruthy();
    }
  });

  it("shows nothing when the recruiter owns none of the candidate's vacancies", () => {
    const applications = [applied("foreign", "a1", "2026-08-21T10:00:00.000Z")];
    expect(openableOtherVacancies(applications, [], null)).toEqual([]);
    expect(openableOtherVacancies([], ["v1"], null)).toEqual([]);
  });
});

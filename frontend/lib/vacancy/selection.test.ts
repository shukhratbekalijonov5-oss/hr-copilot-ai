import { describe, expect, it } from "vitest";
import {
  VACANCY_PARAM,
  resolveVacancySelection,
  selectedVacancyId,
  withVacancyParam,
} from "@/lib/vacancy/selection";
import type { MyVacancy } from "@/lib/types";

function vacancy(id: string, title = `Vacancy ${id}`): MyVacancy {
  return {
    id,
    title,
    status: "OPEN",
    createdAt: "2026-08-01T00:00:00.000Z",
    candidateCount: 2,
    requirementCount: 3,
  };
}

const mine = [vacancy("a1"), vacancy("a2")];

describe("selectedVacancyId", () => {
  it("reads the shared query parameter", () => {
    expect(selectedVacancyId({ [VACANCY_PARAM]: "a1" })).toBe("a1");
  });

  it("treats absent, blank and repeated values as no selection", () => {
    expect(selectedVacancyId({})).toBeNull();
    expect(selectedVacancyId({ [VACANCY_PARAM]: "   " })).toBeNull();
    // A repeated param arrives as an array; ambiguous input selects nothing
    // rather than silently picking one.
    expect(selectedVacancyId({ [VACANCY_PARAM]: ["a1", "a2"] })).toBeNull();
  });
});

describe("resolveVacancySelection", () => {
  it("honours a requested vacancy the caller owns", () => {
    expect(resolveVacancySelection(mine, "a2")).toEqual({
      selected: mine[1],
      invalid: false,
    });
  });

  it("refuses a vacancy that is not the caller's, without substituting another", () => {
    // The critical case: a colleague's id (or a deleted one) must NOT be
    // quietly reinterpreted as "show them their own first vacancy".
    const result = resolveVacancySelection(mine, "someone-elses");
    expect(result.selected).toBeNull();
    expect(result.invalid).toBe(true);
  });

  it("defaults to the newest own vacancy only when nothing was requested", () => {
    expect(resolveVacancySelection(mine, null)).toEqual({
      selected: mine[0],
      invalid: false,
    });
  });

  it("reports nothing selectable when the caller owns no vacancies", () => {
    expect(resolveVacancySelection([], null)).toEqual({
      selected: null,
      invalid: false,
    });
    expect(resolveVacancySelection([], "a1")).toEqual({
      selected: null,
      invalid: true,
    });
  });
});

describe("withVacancyParam", () => {
  it("sets the selection while preserving unrelated params", () => {
    const params = new URLSearchParams({ q: "kubernetes" });
    expect(withVacancyParam("/search", params, "a1")).toBe(
      "/search?q=kubernetes&vacancyId=a1",
    );
  });

  it("clears the selection when switching to none", () => {
    const params = new URLSearchParams({ vacancyId: "a1", q: "redis" });
    expect(withVacancyParam("/search", params, null)).toBe("/search?q=redis");
  });

  it("drops paging, which belonged to the previous vacancy", () => {
    const params = new URLSearchParams({ vacancyId: "a1", page: "4" });
    expect(withVacancyParam("/candidates", params, "a2")).toBe(
      "/candidates?vacancyId=a2",
    );
  });

  it("returns a bare path when nothing is left", () => {
    expect(withVacancyParam("/compare", new URLSearchParams(), null)).toBe(
      "/compare",
    );
  });
});

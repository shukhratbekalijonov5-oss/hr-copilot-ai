import { describe, expect, it } from "vitest";
import {
  isVacancySelectionInvalid,
  vacancyAccessReason,
} from "@/lib/api/vacancy-errors";
import { ApiError, apiErrorFromResponse, networkError } from "@/lib/api/errors";

/** Builds the exact body shape the backend's vacancy policy emits. */
function policyError(
  status: number,
  code: string,
  message: string,
): Promise<ApiError> {
  return apiErrorFromResponse(
    new Response(JSON.stringify({ statusCode: status, message, code }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("vacancyAccessReason", () => {
  it("maps a same-org colleague's vacancy to not_owned", async () => {
    const error = await policyError(
      403,
      "VACANCY_NOT_OWNED",
      "This vacancy was created by another member of your organization. " +
        "You can only work inside vacancies you created.",
    );
    expect(error.code).toBe("VACANCY_NOT_OWNED");
    expect(vacancyAccessReason(error)).toBe("not_owned");
  });

  it("maps an unassociated candidate to candidate_not_in_vacancy", async () => {
    const error = await policyError(
      403,
      "CANDIDATE_NOT_IN_VACANCY",
      "This candidate is not associated with the selected vacancy.",
    );
    expect(vacancyAccessReason(error)).toBe("candidate_not_in_vacancy");
  });

  it("maps a duplicate association to candidate_already_in_vacancy", async () => {
    const error = await policyError(
      409,
      "CANDIDATE_ALREADY_IN_VACANCY",
      "Candidate is already attached to this vacancy",
    );
    expect(vacancyAccessReason(error)).toBe("candidate_already_in_vacancy");
  });

  it("keeps a foreign-org 404 as not-found, never as not-yours", async () => {
    // Tenant nondisclosure: existence must not be confirmed across orgs, so
    // this may not be upgraded to a more informative reason.
    const error = await apiErrorFromResponse(
      new Response(
        JSON.stringify({ statusCode: 404, message: "Vacancy not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    expect(vacancyAccessReason(error)).toBe("vacancy_not_found");
  });

  it("returns null for failures that are not about vacancy access", () => {
    expect(vacancyAccessReason(networkError())).toBeNull();
    expect(vacancyAccessReason(new ApiError("boom", 500, "server"))).toBeNull();
    expect(vacancyAccessReason(new Error("not an ApiError"))).toBeNull();
  });

  it("still classifies a 403 with no code as unrelated rather than guessing", () => {
    // A role-based 403 (INTERVIEWER on a mapping route) is not an ownership
    // problem, and must not be reported as one.
    expect(vacancyAccessReason(new ApiError("Insufficient role", 403, "forbidden")))
      .toBeNull();
  });
});

describe("isVacancySelectionInvalid", () => {
  it("is true only when the SELECTION itself cannot be used", async () => {
    const notOwned = await policyError(403, "VACANCY_NOT_OWNED", "x");
    const notFound = await apiErrorFromResponse(
      new Response(JSON.stringify({ statusCode: 404, message: "x" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const candidateIssue = await policyError(403, "CANDIDATE_NOT_IN_VACANCY", "x");

    expect(isVacancySelectionInvalid(notOwned)).toBe(true);
    expect(isVacancySelectionInvalid(notFound)).toBe(true);
    // The vacancy is fine here — the candidate is the problem — so the
    // selection must survive.
    expect(isVacancySelectionInvalid(candidateIssue)).toBe(false);
    expect(isVacancySelectionInvalid(networkError())).toBe(false);
  });
});

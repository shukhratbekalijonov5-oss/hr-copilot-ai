import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse, networkError } from "@/lib/api/errors";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiErrorFromResponse", () => {
  it("maps class-validator messages onto the fields that failed", async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(400, {
        message: [
          "organizationSlug must be lowercase alphanumeric words joined by hyphens",
          "password must be at least 12 characters long",
        ],
        error: "Bad Request",
        statusCode: 400,
      }),
    );

    expect(error.kind).toBe("validation");
    expect(error.fieldErrors.organizationSlug).toMatch(/lowercase/);
    expect(error.fieldErrors.password).toMatch(/12 characters/);
  });

  it("keeps only the first message per field", async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(400, {
        message: [
          "email must be an email",
          "email must be shorter than or equal to 255 characters",
        ],
      }),
    );

    expect(error.fieldErrors.email).toBe("Email must be an email");
  });

  it("classifies auth, permission, conflict and rate-limit failures", async () => {
    expect((await apiErrorFromResponse(jsonResponse(401, {}))).kind).toBe("unauthorized");
    expect((await apiErrorFromResponse(jsonResponse(403, {}))).kind).toBe("forbidden");
    expect((await apiErrorFromResponse(jsonResponse(404, {}))).kind).toBe("not_found");
    expect((await apiErrorFromResponse(jsonResponse(409, {}))).kind).toBe("conflict");
    expect((await apiErrorFromResponse(jsonResponse(429, {}))).kind).toBe("rate_limited");
  });

  it("passes through a safe 4xx message from the backend", async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(409, { message: "Organization slug is already taken" }),
    );
    expect(error.message).toBe("Organization slug is already taken");
  });

  it("never echoes a 500 body, which can contain internals", async () => {
    const error = await apiErrorFromResponse(
      jsonResponse(500, {
        message: 'connect ECONNREFUSED 10.0.0.4:5432 for user "hr_admin"',
      }),
    );

    expect(error.message).not.toMatch(/ECONNREFUSED|5432|hr_admin/);
    expect(error.kind).toBe("server");
  });

  it("survives a non-JSON error body", async () => {
    const error = await apiErrorFromResponse(
      new Response("<html>502</html>", { status: 502 }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("server");
  });
});

describe("networkError", () => {
  it("is distinguishable from a server failure", () => {
    const error = networkError();
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
    expect(error.isAuthFailure).toBe(false);
  });
});

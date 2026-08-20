import { describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api/http";
import { getJobMatches } from "@/lib/api/candidate-account.service";
import type { JobMatchesResponse } from "@/lib/api/contracts";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/http", () => ({
  apiFetch: vi.fn(),
}));

const backendResponse: JobMatchesResponse = {
  matches: [],
  locale: "ko",
  generated: true,
  generatedAt: "2026-08-20T00:00:00.000Z",
};

describe("getJobMatches", () => {
  it("uses the candidate-only endpoint and sends the UI locale", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(backendResponse);

    const result = await getJobMatches({ locale: "ko", limit: 5 });

    expect(result.locale).toBe("ko");
    expect(apiFetch).toHaveBeenCalledWith(
      "/candidate-account/me/job-matches",
      {
        method: "POST",
        body: { locale: "ko", limit: 5 },
      },
    );
  });
});

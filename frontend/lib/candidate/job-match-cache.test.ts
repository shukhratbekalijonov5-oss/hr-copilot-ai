import { describe, expect, it, beforeEach } from "vitest";
import {
  clearCachedJobMatchResult,
  clearJobMatchCacheForTests,
  getCachedJobMatchResult,
  patchCachedJobMatchApplicationState,
  patchCachedJobMatchSaved,
  patchJobMatchResult,
  setCachedJobMatchResult,
} from "@/lib/candidate/job-match-cache";
import { jobMatchCacheKey } from "@/lib/candidate/job-match-cache-key";
import type { JobMatchResult } from "@/lib/types";

function result(): JobMatchResult {
  return {
    locale: "en",
    generated: true,
    generatedAt: "2026-08-20T00:00:00.000Z",
    matches: [
      {
        vacancy: {
          slug: "backend-engineer",
          title: "Backend Engineer",
          organizationName: "Northwind Labs",
          location: "Seoul",
          employmentType: "FULL_TIME",
          status: "OPEN",
        },
        match: "STRONG",
        explanation: "Grounded explanation.",
        supportedRequirements: [],
        unsupportedRequirements: [],
        unclearRequirements: [],
        evidence: [],
        saved: false,
        applicationState: null,
      },
      {
        vacancy: {
          slug: "frontend-engineer",
          title: "Frontend Engineer",
          organizationName: "Northwind Labs",
          location: "Remote",
          employmentType: "FULL_TIME",
          status: "OPEN",
        },
        match: "PARTIAL",
        explanation: null,
        supportedRequirements: [],
        unsupportedRequirements: [],
        unclearRequirements: [],
        evidence: [],
        saved: true,
        applicationState: null,
      },
    ],
  };
}

describe("job match cache", () => {
  beforeEach(() => clearJobMatchCacheForTests());

  it("scopes cached match data by user and locale", () => {
    const englishKey = jobMatchCacheKey("user-1", "en");
    const koreanKey = jobMatchCacheKey("user-1", "ko");
    const otherUserKey = jobMatchCacheKey("user-2", "en");
    const cached = result();

    setCachedJobMatchResult(englishKey, cached);

    expect(getCachedJobMatchResult(englishKey)).toBe(cached);
    expect(getCachedJobMatchResult(koreanKey)).toBeNull();
    expect(getCachedJobMatchResult(otherUserKey)).toBeNull();
  });

  it("clears only the selected user and locale cache entry", () => {
    const englishKey = jobMatchCacheKey("user-1", "en");
    const koreanKey = jobMatchCacheKey("user-1", "ko");
    const otherUserKey = jobMatchCacheKey("user-2", "en");
    setCachedJobMatchResult(englishKey, result());
    setCachedJobMatchResult(koreanKey, result());
    setCachedJobMatchResult(otherUserKey, result());

    clearCachedJobMatchResult(englishKey);

    expect(getCachedJobMatchResult(englishKey)).toBeNull();
    expect(getCachedJobMatchResult(koreanKey)).not.toBeNull();
    expect(getCachedJobMatchResult(otherUserKey)).not.toBeNull();
  });

  it("patches only the matching saved state by public slug", () => {
    const updated = patchJobMatchResult(result(), "backend-engineer", {
      saved: true,
    });

    expect(updated.matches[0].saved).toBe(true);
    expect(updated.matches[1].saved).toBe(true);
  });

  it("patches application state without replacing the whole cache entry", () => {
    const key = jobMatchCacheKey("user-1", "en");
    setCachedJobMatchResult(key, result());

    const updated = patchCachedJobMatchApplicationState(
      key,
      "backend-engineer",
      "NEW",
    );

    expect(updated?.matches[0].applicationState).toBe("NEW");
    expect(updated?.matches[1].applicationState).toBeNull();
    expect(getCachedJobMatchResult(key)?.matches[0].applicationState).toBe("NEW");
  });

  it("ignores save patches for missing cache keys", () => {
    expect(
      patchCachedJobMatchSaved("missing", "backend-engineer", true),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";

/**
 * These flags decide whether a screen calls a real endpoint or explains that it
 * cannot. A flag turned on ahead of its contract produces a screen that fails
 * in the browser; one left off after the contract lands hides a working feature.
 */
describe("backend capability flags", () => {
  it("enables the AI routes the API now exposes", () => {
    // POST /api/search/evidence, /api/ai/answer,
    // /api/ai/candidates/:id/summary,
    // /api/ai/candidates/:cid/vacancies/:vid/interview-questions,
    // GET+POST /api/candidates/:cid/vacancies/:vid/evidence-map
    expect(BACKEND_CAPABILITIES.aiSearch).toBe(true);
    expect(BACKEND_CAPABILITIES.aiAnswer).toBe(true);
    expect(BACKEND_CAPABILITIES.aiSummary).toBe(true);
    expect(BACKEND_CAPABILITIES.interviewQuestions).toBe(true);
    expect(BACKEND_CAPABILITIES.evidenceMap).toBe(true);
  });

  it("enables the candidate platform now that the identity migration landed", () => {
    // Verified against the running API: POST /candidate-account,
    // GET /public/jobs, POST /public/jobs/:slug/apply, the saved-job routes and
    // POST /auth/switch-organization all answer for real.
    expect(BACKEND_CAPABILITIES.candidateAccount).toBe(true);
    expect(BACKEND_CAPABILITIES.multiOrganization).toBe(true);
    expect(BACKEND_CAPABILITIES.publicJobs).toBe(true);
    expect(BACKEND_CAPABILITIES.directApplication).toBe(true);
    expect(BACKEND_CAPABILITIES.savedJobs).toBe(true);
  });

  it("enables session management", () => {
    // GET /auth/sessions, DELETE /auth/sessions/:id, POST /auth/logout-all.
    expect(BACKEND_CAPABILITIES.sessionManagement).toBe(true);
  });

  it("keeps flags off for routes the API still does not expose", () => {
    // No integration endpoints and no credential storage; no retry route.
    expect(BACKEND_CAPABILITIES.integrations).toBe(false);
    expect(BACKEND_CAPABILITIES.processingRetry).toBe(false);
  });
});

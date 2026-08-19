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

  it("keeps every candidate-platform surface gated until identity migrates", () => {
    // There is no CandidateAccount and no OrganizationMember join yet, so none
    // of these can persist anything.
    expect(BACKEND_CAPABILITIES.candidateAccount).toBe(false);
    expect(BACKEND_CAPABILITIES.multiOrganization).toBe(false);
    expect(BACKEND_CAPABILITIES.publicJobs).toBe(false);
    expect(BACKEND_CAPABILITIES.directApplication).toBe(false);
    expect(BACKEND_CAPABILITIES.savedJobs).toBe(false);
  });

  it("keeps flags off for routes the API still does not expose", () => {
    expect(BACKEND_CAPABILITIES.applicationSource).toBe(false);
    expect(BACKEND_CAPABILITIES.integrations).toBe(false);
    expect(BACKEND_CAPABILITIES.processingRetry).toBe(false);
  });
});

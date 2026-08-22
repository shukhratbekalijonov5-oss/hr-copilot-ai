import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toOrganization } from "@/lib/api/adapters";
import { getVacancies } from "@/lib/api/vacancies.service";
import { getAllCandidates, getCandidates } from "@/lib/api/candidates.service";
import { getProcessingJobs } from "@/lib/api/processing.service";
import { summarizeDocumentStatuses } from "@/lib/api/adapters";
import type {
  OrganizationResponse,
  OrganizationStatsResponse,
} from "@/lib/api/contracts";
import type { DashboardData, Organization } from "@/lib/types";

/**
 * Composed from the endpoints the API exposes today.
 *
 * `/organizations/current/stats` covers the headline counts, but there is no
 * aggregate for per-stage document progress or an activity feed, so those are
 * assembled here. A dedicated backend aggregation endpoint would collapse this
 * into one round trip — noted as a contract gap rather than worked around with
 * invented numbers.
 */
export async function getDashboard(): Promise<DashboardData> {
  const [stats, vacancyPage, candidatePage, allCandidates, jobs] =
    await Promise.all([
      apiFetch<OrganizationStatsResponse>("/organizations/current/stats"),
      getVacancies({ page: 1, limit: 4 }),
      getCandidates({ page: 1, limit: 5 }),
      getAllCandidates(),
      getProcessingJobs({ page: 1, limit: 6 }),
    ]);

  // Since the snapshot removal there are no org-side document copies: the
  // documents that exist are the candidates' CURRENT ones, and their statuses
  // arrive on the candidate rows.
  const statuses = allCandidates.flatMap(
    (candidate) => candidate.documentStatuses,
  );
  const processing = summarizeDocumentStatuses(statuses);

  const inFlight = statuses.filter(
    (status) => status !== "COMPLETED" && status !== "FAILED",
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalCandidates: stats.candidates,
      activeVacancies: stats.openVacancies,
      resumesProcessing: inFlight,
      completedAnalyses: statuses.filter((status) => status === "COMPLETED")
        .length,
    },
    recentVacancies: vacancyPage.vacancies,
    recentCandidates: candidatePage.candidates,
    processing,
    recentJobs: jobs.jobs,
  };
}

export async function getCurrentOrganization(): Promise<Organization> {
  return toOrganization(
    await apiFetch<OrganizationResponse>("/organizations/current"),
  );
}

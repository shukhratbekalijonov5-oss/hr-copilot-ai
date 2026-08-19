import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toOrganization } from "@/lib/api/adapters";
import { getAllDocuments } from "@/lib/api/documents.service";
import { getVacancies } from "@/lib/api/vacancies.service";
import { getCandidates } from "@/lib/api/candidates.service";
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
  const [stats, vacancyPage, candidatePage, documents, jobs] =
    await Promise.all([
      apiFetch<OrganizationStatsResponse>("/organizations/current/stats"),
      getVacancies({ page: 1, limit: 4 }),
      getCandidates({ page: 1, limit: 5 }),
      getAllDocuments(),
      getProcessingJobs({ page: 1, limit: 6 }),
    ]);

  const processing = summarizeDocumentStatuses(
    documents.map((document) => document.status),
  );

  const inFlight = documents.filter(
    (document) =>
      document.status !== "COMPLETED" && document.status !== "FAILED",
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      totalCandidates: stats.candidates,
      activeVacancies: stats.openVacancies,
      resumesProcessing: inFlight,
      completedAnalyses: documents.filter((d) => d.status === "COMPLETED")
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

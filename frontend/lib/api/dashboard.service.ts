import { mockRequest } from "@/lib/api/client";
import {
  activity,
  candidates,
  documents,
  globalProcessingSummary,
  vacancies,
} from "@/lib/mock/store";
import type { DashboardData } from "@/lib/types";

const IN_FLIGHT_STATUSES = new Set([
  "uploaded",
  "queued",
  "parsing",
  "chunking",
  "embedding",
  "indexing",
]);

export async function getDashboard(): Promise<DashboardData> {
  return mockRequest(() => ({
    stats: {
      totalCandidates: candidates.length,
      activeVacancies: vacancies.filter((vacancy) => vacancy.status === "open")
        .length,
      resumesProcessing: documents.filter((document) =>
        IN_FLIGHT_STATUSES.has(document.status),
      ).length,
      completedAnalyses: documents.filter(
        (document) => document.status === "completed",
      ).length,
    },
    recentVacancies: [...vacancies]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 4),
    recentCandidates: [...candidates]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 5),
    processing: globalProcessingSummary,
    activity,
  }));
}

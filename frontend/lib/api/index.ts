/**
 * The single entry point components use to reach data.
 *
 * Import `api` rather than any individual service so that swapping the mock
 * transport for HTTP stays a change inside `lib/api`.
 */
import * as auth from "@/lib/api/auth.service";
import * as candidatesService from "@/lib/api/candidates.service";
import * as compare from "@/lib/api/compare.service";
import * as dashboard from "@/lib/api/dashboard.service";
import * as processing from "@/lib/api/processing.service";
import * as search from "@/lib/api/search.service";
import * as settings from "@/lib/api/settings.service";
import * as vacanciesService from "@/lib/api/vacancies.service";

export const api = {
  // auth
  login: auth.login,
  register: auth.register,
  getSession: auth.getSession,

  // dashboard
  getDashboard: dashboard.getDashboard,

  // vacancies
  getVacancies: vacanciesService.getVacancies,
  getVacancy: vacanciesService.getVacancy,
  getVacancyCandidates: vacanciesService.getVacancyCandidates,
  getDepartments: vacanciesService.getDepartments,
  createVacancy: vacanciesService.createVacancy,

  // candidates
  getCandidates: candidatesService.getCandidates,
  getCandidate: candidatesService.getCandidate,
  getCandidateEvidence: candidatesService.getCandidateEvidence,
  getCandidateSummary: candidatesService.getCandidateSummary,
  getInterviewQuestions: candidatesService.getInterviewQuestions,
  setReviewState: candidatesService.setReviewState,

  // search & compare
  searchCandidates: search.searchCandidates,
  compareCandidates: compare.compareCandidates,

  // processing
  getProcessingJobs: processing.getProcessingJobs,
  getProcessingSummary: processing.getProcessingSummary,
  uploadResumes: processing.uploadResumes,
  openProcessingChannel: processing.openProcessingChannel,
  summarizeUploads: processing.summarizeUploads,

  // settings
  getSettings: settings.getSettings,
  updateProfile: settings.updateProfile,
  updateOrganization: settings.updateOrganization,
  updateAiPreferences: settings.updateAiPreferences,
};

export { ApiError } from "@/lib/api/client";
export { SEARCH_EXAMPLES } from "@/lib/api/search.service";
export type { ProcessingChannel, ProcessingEvent } from "@/lib/api/processing.service";

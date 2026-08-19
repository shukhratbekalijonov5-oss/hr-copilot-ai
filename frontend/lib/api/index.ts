import "server-only";

/**
 * The single entry point server components and server actions use to reach the
 * backend. Client components never import this — they call server actions or
 * the route handlers under `app/api`, so the JWT stays on the server.
 */
import * as ai from "@/lib/api/ai.service";
import * as applications from "@/lib/api/applications.service";
import * as auth from "@/lib/api/auth.service";
import * as candidates from "@/lib/api/candidates.service";
import * as compare from "@/lib/api/compare.service";
import * as dashboard from "@/lib/api/dashboard.service";
import * as documents from "@/lib/api/documents.service";
import * as evidence from "@/lib/api/evidence.service";
import * as processing from "@/lib/api/processing.service";
import * as search from "@/lib/api/search.service";
import * as settings from "@/lib/api/settings.service";
import * as vacancies from "@/lib/api/vacancies.service";

export const api = {
  // auth
  login: auth.login,
  register: auth.register,
  getSession: auth.getSession,

  // dashboard & organization
  getDashboard: dashboard.getDashboard,
  getCurrentOrganization: dashboard.getCurrentOrganization,

  // vacancies
  getVacancies: vacancies.getVacancies,
  getAllVacancies: vacancies.getAllVacancies,
  getVacancy: vacancies.getVacancy,
  createVacancy: vacancies.createVacancy,
  updateVacancy: vacancies.updateVacancy,
  setVacancyStatus: vacancies.setVacancyStatus,
  addRequirement: vacancies.addRequirement,
  removeRequirement: vacancies.removeRequirement,

  // candidates & applications
  getCandidates: candidates.getCandidates,
  getAllCandidates: candidates.getAllCandidates,
  getCandidate: candidates.getCandidate,
  createCandidate: candidates.createCandidate,
  updateCandidate: candidates.updateCandidate,
  getApplications: applications.getApplications,
  createApplication: applications.createApplication,
  setApplicationStatus: applications.setApplicationStatus,

  // documents
  getDocuments: documents.getDocuments,
  getAllDocuments: documents.getAllDocuments,
  getDocument: documents.getDocument,
  getDocumentDownloadUrl: documents.getDocumentDownloadUrl,
  uploadDocument: documents.uploadDocument,

  // processing
  getProcessingJobs: processing.getProcessingJobs,
  getProcessingJob: processing.getProcessingJob,
  getProcessingSummary: processing.getProcessingSummary,

  // search
  searchEvidence: search.searchEvidence,

  // grounded AI
  answerQuestion: ai.answerQuestion,
  summariseCandidate: ai.summariseCandidate,
  getInterviewQuestions: ai.getInterviewQuestions,
  runEvidenceMap: ai.runEvidenceMap,
  getEvidenceMap: ai.getEvidenceMap,

  // evidence & compare
  getCandidateEvidence: evidence.getCandidateEvidence,
  getCandidateRequirementEvidence: evidence.getCandidateRequirementEvidence,
  countEvidence: evidence.countEvidence,
  compareCandidates: compare.compareCandidates,

  // settings
  getSettings: settings.getSettings,
  updateOrganization: settings.updateOrganization,
  updateTeamMember: settings.updateTeamMember,
  inviteUser: settings.inviteUser,
};

export { ApiError, errorMessage, toApiError } from "@/lib/api/errors";
export type { FieldErrors } from "@/lib/api/errors";

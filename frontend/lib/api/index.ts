import "server-only";

/**
 * The single entry point server components and server actions use to reach the
 * backend. Client components never import this — they call server actions or
 * the route handlers under `app/api`, so the JWT stays on the server.
 */
import * as ai from "@/lib/api/ai.service";
import * as applications from "@/lib/api/applications.service";
import * as account from "@/lib/api/account.service";
import * as auth from "@/lib/api/auth.service";
import * as candidateAccount from "@/lib/api/candidate-account.service";
import * as candidateLinks from "@/lib/api/candidate-links.service";
import * as candidates from "@/lib/api/candidates.service";
import * as compare from "@/lib/api/compare.service";
import * as dashboard from "@/lib/api/dashboard.service";
import * as externalJobs from "@/lib/api/external-jobs.service";
import * as interviewChat from "@/lib/api/interview-chat.service";
import * as notifications from "@/lib/api/notifications.service";
import * as processing from "@/lib/api/processing.service";
import * as publicJobs from "@/lib/api/public-jobs.service";
import * as search from "@/lib/api/search.service";
import * as settings from "@/lib/api/settings.service";
import * as vacancies from "@/lib/api/vacancies.service";

export const api = {
  // auth & sessions
  login: auth.login,
  register: auth.register,
  registerCandidate: auth.registerCandidate,
  registerOrganization: auth.registerOrganization,
  getSession: auth.getSession,
  switchOrganization: auth.switchOrganization,
  logout: auth.logout,
  logoutAll: auth.logoutAll,
  listSessions: auth.listSessions,
  revokeSession: auth.revokeSession,

  // the caller's own account (both workspaces)
  getAccountProfile: account.getAccountProfile,
  updateAccountProfile: account.updateAccountProfile,
  deleteAvatar: account.deleteAvatar,

  // dashboard & organization
  getDashboard: dashboard.getDashboard,
  getCurrentOrganization: dashboard.getCurrentOrganization,

  // vacancies
  getVacancies: vacancies.getVacancies,
  getAllVacancies: vacancies.getAllVacancies,
  getVacancy: vacancies.getVacancy,
  getMyVacancies: vacancies.getMyVacancies,
  getAllMyVacancies: vacancies.getAllMyVacancies,
  getVacancyCandidates: vacancies.getVacancyCandidates,
  deleteVacancy: vacancies.deleteVacancy,
  bulkDeleteVacancies: vacancies.bulkDeleteVacancies,
  createVacancy: vacancies.createVacancy,
  updateVacancy: vacancies.updateVacancy,
  setVacancyStatus: vacancies.setVacancyStatus,
  addRequirement: vacancies.addRequirement,
  removeRequirement: vacancies.removeRequirement,

  // candidates & applications
  getCandidates: candidates.getCandidates,
  getAllCandidates: candidates.getAllCandidates,
  getCandidate: candidates.getCandidate,
  getCandidateCurrentEvidence: candidates.getCandidateCurrentEvidence,
  getCandidateCurrentDocumentUrl: candidates.getCandidateCurrentDocumentUrl,
  updateCandidate: candidates.updateCandidate,
  getApplications: applications.getApplications,
  getAllApplications: applications.getAllApplications,
  setApplicationStatus: applications.setApplicationStatus,
  inviteToInterview: interviewChat.inviteToInterview,

  // interview chat
  getOrganizationConversations: interviewChat.getOrganizationConversations,
  getOrganizationConversation: interviewChat.getOrganizationConversation,
  getOrganizationMessages: interviewChat.getOrganizationMessages,
  sendOrganizationMessage: interviewChat.sendOrganizationMessage,
  getCandidateConversations: interviewChat.getCandidateConversations,
  getCandidateConversation: interviewChat.getCandidateConversation,
  getCandidateMessages: interviewChat.getCandidateMessages,
  sendCandidateMessage: interviewChat.sendCandidateMessage,

  // notifications
  getNotifications: notifications.getNotifications,
  getUnreadNotificationCount: notifications.getUnreadNotificationCount,
  markNotificationRead: notifications.markNotificationRead,
  markAllNotificationsRead: notifications.markAllNotificationsRead,

  // documents

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
  compareCandidates: compare.compareCandidates,
  mapMissingCandidates: compare.mapMissingCandidates,

  // candidate platform (job-seeker side)
  getCandidateAccount: candidateAccount.getCandidateAccount,
  createCandidateAccount: candidateAccount.createCandidateAccount,
  updateCandidateAccount: candidateAccount.updateCandidateAccount,
  uploadPersonalResume: candidateAccount.uploadPersonalResume,
  getPersonalDocuments: candidateAccount.getPersonalDocuments,
  uploadPersonalDocument: candidateAccount.uploadPersonalDocument,
  getPersonalDocumentUrl: candidateAccount.getPersonalDocumentUrl,
  deletePersonalDocument: candidateAccount.deletePersonalDocument,
  reprocessPersonalDocument: candidateAccount.reprocessPersonalDocument,
  getPersonalResumeUrl: candidateAccount.getPersonalResumeUrl,
  getCandidateEvidenceState: candidateAccount.getCandidateEvidenceState,

  // professional links — the other half of the candidate's own evidence
  getCandidateLinks: candidateLinks.getCandidateLinks,
  createCandidateLink: candidateLinks.createCandidateLink,
  updateCandidateLink: candidateLinks.updateCandidateLink,
  deleteCandidateLink: candidateLinks.deleteCandidateLink,
  reprocessCandidateLink: candidateLinks.reprocessCandidateLink,
  getMyApplications: candidateAccount.getMyApplications,
  withdrawApplication: candidateAccount.withdrawApplication,
  getSavedJobs: candidateAccount.getSavedJobs,
  getJobMatches: candidateAccount.getJobMatches,
  getJobPreferences: candidateAccount.getJobPreferences,
  saveJobPreferences: candidateAccount.saveJobPreferences,
  deleteJobPreferences: candidateAccount.deleteJobPreferences,
  getJobSearchContext: candidateAccount.getJobSearchContext,
  getJobSalaryView: candidateAccount.getJobSalaryView,
  saveJob: candidateAccount.saveJob,
  unsaveJob: candidateAccount.unsaveJob,
  // external jobs (published outside HR Copilot; applying leaves the product)
  searchExternalJobs: externalJobs.searchExternalJobs,
  getExternalJob: externalJobs.getExternalJob,
  // Saving and the candidate's own application tracking. Independent of each
  // other, and of everything under /jobs and /my-applications.
  saveExternalJob: externalJobs.saveExternalJob,
  unsaveExternalJob: externalJobs.unsaveExternalJob,
  getSavedExternalJobs: externalJobs.getSavedExternalJobs,
  trackExternalApplication: externalJobs.trackExternalApplication,
  updateExternalApplication: externalJobs.updateExternalApplication,
  deleteExternalApplication: externalJobs.deleteExternalApplication,
  getExternalApplications: externalJobs.getExternalApplications,
  explainExternalMatch: externalJobs.explainExternalMatch,
  generateExternalCoverLetter: externalJobs.generateExternalCoverLetter,
  generateExternalInterviewPrep: externalJobs.generateExternalInterviewPrep,
  generateExternalMatchBreakdown: externalJobs.generateExternalMatchBreakdown,

  getPublicJobs: publicJobs.getPublicJobs,
  getPublicJob: publicJobs.getPublicJob,
  applyToJob: publicJobs.applyToJob,

  // settings
  getSettings: settings.getSettings,
  updateOrganization: settings.updateOrganization,
  updateTeamMember: settings.updateTeamMember,
  inviteUser: settings.inviteUser,
};

export { ApiError, errorMessage, toApiError } from "@/lib/api/errors";
export type { FieldErrors } from "@/lib/api/errors";

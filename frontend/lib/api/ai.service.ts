import "server-only";

import { apiFetch } from "@/lib/api/http";
import {
  toCandidateSummary,
  toEvidenceMap,
  toGroundedAnswer,
  toInterviewQuestionSet,
} from "@/lib/api/adapters";
import type {
  AiAnswerResponse,
  AiCandidateSummaryResponse,
  AiInterviewQuestionsResponse,
  EvidenceMapResponse,
} from "@/lib/api/contracts";
import type { Locale } from "@/lib/i18n/locales";
import type {
  CandidateSummary,
  EvidenceMap,
  GroundedAnswer,
  InterviewQuestionSet,
} from "@/lib/types";

/**
 * Grounded AI, through the NestJS API and nothing else.
 *
 * What is deliberately absent from every call here:
 *
 *  - `organizationId`. The backend derives the tenant from the JWT and its
 *    ValidationPipe rejects unknown properties, so sending one would be both a
 *    400 and a client-controlled tenancy parameter.
 *  - Any direct call to the Python AI service or to an LLM provider. The
 *    frontend has no AI credential and must never acquire one; `/internal/*`
 *    routes are unreachable from a browser by design.
 *
 * `locale` is required rather than optional on every generation call. The
 * backend defaults to English when it is missing, which would silently hand a
 * Korean reader an English answer — so the caller must state the language.
 */

/**
 * `/ai/answer` input.
 *
 * The backend requires `vacancyId` whenever `candidateId` is present — a
 * candidate question is always asked inside one vacancy's context — so the two
 * are modelled as a pair that cannot be half-supplied. Without a candidate the
 * vacancy stays optional org-wide search context.
 */
export type AnswerInput = {
  query: string;
  locale: Locale;
  limit?: number;
} & (
  | { candidateId: string; vacancyId: string }
  | { candidateId?: undefined; vacancyId?: string }
);

/** POST /ai/answer — a grounded answer with validated citations. */
export async function answerQuestion(
  input: AnswerInput,
): Promise<GroundedAnswer> {
  const response = await apiFetch<AiAnswerResponse>("/ai/answer", {
    method: "POST",
    body: {
      query: input.query.trim(),
      candidateId: input.candidateId,
      vacancyId: input.vacancyId,
      locale: input.locale,
      limit: input.limit,
    },
  });

  return toGroundedAnswer(response);
}

/**
 * POST /ai/candidates/:id/summary — what the documents state, not a rating.
 *
 * `vacancyId` is REQUIRED: the summary answers "how does this evidence relate
 * to THIS vacancy" and is grounded in its title and requirements, so the same
 * candidate reads differently under two roles.
 */
export async function summariseCandidate(
  candidateId: string,
  vacancyId: string,
  locale: Locale,
): Promise<CandidateSummary> {
  const response = await apiFetch<AiCandidateSummaryResponse>(
    `/ai/candidates/${candidateId}/summary`,
    { method: "POST", body: { vacancyId, locale } },
  );

  return toCandidateSummary(response);
}

/** POST /ai/candidates/:cid/vacancies/:vid/interview-questions */
export async function getInterviewQuestions(
  candidateId: string,
  vacancyId: string,
  locale: Locale,
): Promise<InterviewQuestionSet> {
  const response = await apiFetch<AiInterviewQuestionsResponse>(
    `/ai/candidates/${candidateId}/vacancies/${vacancyId}/interview-questions`,
    { method: "POST", body: { locale } },
  );

  return toInterviewQuestionSet(response);
}

/**
 * POST the evidence map — runs (or re-runs) it and returns the stored result.
 *
 * Restricted to OWNER, HR_ADMIN and RECRUITER by the backend; an INTERVIEWER
 * gets a 403, which the UI reports as a role limit rather than a failure.
 *
 * Safe to repeat: the backend replaces a requirement's evidence instead of
 * appending, so a double submission converges rather than duplicating rows.
 */
export async function runEvidenceMap(
  candidateId: string,
  vacancyId: string,
  locale: Locale,
): Promise<EvidenceMap> {
  const response = await apiFetch<EvidenceMapResponse>(
    `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
    { method: "POST", body: { locale } },
  );

  return toEvidenceMap(response);
}

/**
 * GET the stored evidence map.
 *
 * Reads only — no AI call, no LLM — so this keeps working when generation is
 * unavailable. Every requirement comes back whether or not it was mapped, and
 * an unmapped one is reported as NOT_RUN rather than as "no evidence".
 */
export async function getEvidenceMap(
  candidateId: string,
  vacancyId: string,
): Promise<EvidenceMap> {
  const response = await apiFetch<EvidenceMapResponse>(
    `/candidates/${candidateId}/vacancies/${vacancyId}/evidence-map`,
  );

  return toEvidenceMap(response);
}

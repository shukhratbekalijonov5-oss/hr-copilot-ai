import { ApiError, matchesSearch, mockRequest } from "@/lib/api/client";
import {
  buildEvidence,
  buildInterviewQuestions,
  buildSummary,
  candidates,
  findCandidate,
} from "@/lib/mock/store";
import type {
  Candidate,
  CandidateEvidence,
  CandidateQuery,
  CandidateSummary,
  InterviewQuestion,
  ReviewState,
} from "@/lib/types";

function evidenceCoverage(candidate: Candidate): number {
  if (!candidate.primaryVacancyId) return 0;
  const evidence = buildEvidence(candidate.id, candidate.primaryVacancyId);
  if (evidence.length === 0) return 0;
  const found = evidence.filter((item) => item.status === "found").length;
  return found / evidence.length;
}

export async function getCandidates(
  query: CandidateQuery = {},
): Promise<Candidate[]> {
  return mockRequest(() => {
    const vacancyId = query.vacancyId ?? "all";
    const processingStatus = query.processingStatus ?? "all";
    const reviewState = query.reviewState ?? "all";
    const sort = query.sort ?? "recent";

    const filtered = candidates
      .filter((candidate) =>
        vacancyId === "all" ? true : candidate.primaryVacancyId === vacancyId,
      )
      .filter((candidate) =>
        processingStatus === "all"
          ? true
          : candidate.processingStatus === processingStatus,
      )
      .filter((candidate) =>
        reviewState === "all" ? true : candidate.reviewState === reviewState,
      )
      .filter((candidate) =>
        matchesSearch(
          query.search ?? "",
          candidate.fullName,
          candidate.currentTitle,
          candidate.location,
          candidate.skills.join(" "),
        ),
      );

    const sorters: Record<string, (a: Candidate, b: Candidate) => number> = {
      recent: (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      name: (a, b) => a.fullName.localeCompare(b.fullName),
      experience: (a, b) => b.yearsOfExperience - a.yearsOfExperience,
      // Ranks by how many requirements have supporting evidence — a countable
      // fact from the documents, not an opaque quality score.
      evidence_coverage: (a, b) => evidenceCoverage(b) - evidenceCoverage(a),
    };

    return [...filtered].sort(sorters[sort] ?? sorters.recent);
  });
}

export async function getCandidate(id: string): Promise<Candidate> {
  return mockRequest(() => {
    const candidate = findCandidate(id);
    if (!candidate) {
      throw new ApiError(`Candidate ${id} was not found.`, 404);
    }
    return candidate;
  });
}

export async function getCandidateEvidence(
  candidateId: string,
  vacancyId: string,
): Promise<CandidateEvidence[]> {
  return mockRequest(() => buildEvidence(candidateId, vacancyId));
}

export async function getCandidateSummary(
  candidateId: string,
): Promise<CandidateSummary | null> {
  return mockRequest(() => buildSummary(candidateId));
}

export async function getInterviewQuestions(
  candidateId: string,
): Promise<InterviewQuestion[]> {
  return mockRequest(() => buildInterviewQuestions(candidateId));
}

/**
 * Review state is a human action. The mock records it in memory; the backend
 * is expected to persist who changed it and when.
 */
export async function setReviewState(
  candidateId: string,
  reviewState: ReviewState,
): Promise<Candidate> {
  return mockRequest(() => {
    const candidate = findCandidate(candidateId);
    if (!candidate) {
      throw new ApiError(`Candidate ${candidateId} was not found.`, 404);
    }
    candidate.reviewState = reviewState;
    candidate.updatedAt = new Date().toISOString();
    return candidate;
  }, 420);
}

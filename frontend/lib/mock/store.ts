import type {
  ActivityEntry,
  Candidate,
  CandidateDocument,
  CandidateEvidence,
  CandidateSummary,
  Citation,
  InterviewQuestion,
  JobRequirement,
  ProcessingJob,
  Vacancy,
} from "@/lib/types";
import { processingProgress, summarizeProcessing } from "@/lib/utils";
import { candidateSeeds } from "@/lib/mock/seed/candidates";
import { evidenceSeeds } from "@/lib/mock/seed/evidence";
import { questionSeeds, summarySeeds } from "@/lib/mock/seed/analysis";
import { organization } from "@/lib/mock/seed/org";
import { vacancySeeds } from "@/lib/mock/seed/vacancies";

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

function mimeTypeOf(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export const documents: CandidateDocument[] = candidateSeeds.flatMap(
  (candidate) =>
    candidate.documents.map((document) => ({
      id: document.id,
      candidateId: candidate.id,
      vacancyId: candidate.primaryVacancyId,
      fileName: document.fileName,
      mimeType: mimeTypeOf(document.fileName),
      sizeBytes: document.sizeBytes,
      pageCount: document.pageCount,
      kind: document.kind,
      status: document.status,
      uploadedAt: document.uploadedAt,
    })),
);

const documentById = new Map(documents.map((doc) => [doc.id, doc]));

/* -------------------------------------------------------------------------- */
/* Candidates                                                                  */
/* -------------------------------------------------------------------------- */

const vacancyTitleById = new Map(
  vacancySeeds.map((vacancy) => [vacancy.id, vacancy.title]),
);

export const candidates: Candidate[] = candidateSeeds.map((seed) => ({
  id: seed.id,
  organizationId: organization.id,
  fullName: seed.fullName,
  currentTitle: seed.currentTitle,
  email: seed.email,
  phone: seed.phone,
  location: seed.location,
  yearsOfExperience: seed.yearsOfExperience,
  skills: seed.skills,
  experience: seed.experience,
  education: seed.education,
  documents: documents.filter((doc) => doc.candidateId === seed.id),
  processingStatus: seed.processingStatus,
  reviewState: seed.reviewState,
  primaryVacancyId: seed.primaryVacancyId,
  primaryVacancyTitle: seed.primaryVacancyId
    ? (vacancyTitleById.get(seed.primaryVacancyId) ?? null)
    : null,
  createdAt: seed.createdAt,
  updatedAt: seed.updatedAt,
}));

const candidateById = new Map(candidates.map((c) => [c.id, c]));

/* -------------------------------------------------------------------------- */
/* Vacancies                                                                   */
/* -------------------------------------------------------------------------- */

export const vacancies: Vacancy[] = vacancySeeds.map((seed) => {
  const requirements: JobRequirement[] = seed.requirements.map(
    (requirement, index) => ({
      id: `${seed.id}-req-${index + 1}`,
      vacancyId: seed.id,
      label: requirement.label,
      detail: requirement.detail ?? null,
      kind: requirement.kind,
      category: requirement.category,
      position: index,
    }),
  );

  const vacancyCandidates = candidates.filter(
    (candidate) => candidate.primaryVacancyId === seed.id,
  );

  return {
    id: seed.id,
    organizationId: organization.id,
    title: seed.title,
    department: seed.department,
    location: seed.location,
    employmentType: seed.employmentType,
    experienceLevel: seed.experienceLevel,
    status: seed.status,
    description: seed.description,
    requirements,
    preferredSkills: seed.preferredSkills,
    candidateCount: vacancyCandidates.length,
    processing: summarizeProcessing(
      vacancyCandidates.flatMap((candidate) =>
        candidate.documents.map((doc) => doc.status),
      ),
    ),
    ownerId: seed.ownerId,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
  };
});

const vacancyById = new Map(vacancies.map((v) => [v.id, v]));

/* -------------------------------------------------------------------------- */
/* Evidence                                                                    */
/* -------------------------------------------------------------------------- */

function toCitations(
  candidateId: string,
  requirementId: string,
  seeds: { documentId: string; page: number; snippet: string }[],
): Citation[] {
  return seeds.map((seed, index) => ({
    id: `${candidateId}-${requirementId}-cit-${index + 1}`,
    documentId: seed.documentId,
    documentName: documentById.get(seed.documentId)?.fileName ?? seed.documentId,
    page: seed.page,
    snippet: seed.snippet,
  }));
}

/**
 * Evidence for every requirement of a vacancy. Requirements with no extracted
 * passage resolve to `not_found` rather than being omitted, so the reviewer
 * always sees the full requirement list.
 */
export function buildEvidence(
  candidateId: string,
  vacancyId: string,
): CandidateEvidence[] {
  const vacancy = vacancyById.get(vacancyId);
  if (!vacancy) return [];

  const perCandidate = evidenceSeeds[candidateId] ?? {};

  return vacancy.requirements.map((requirement) => {
    const seed = perCandidate[requirement.label];

    return {
      id: `${candidateId}-${requirement.id}`,
      candidateId,
      vacancyId,
      requirementId: requirement.id,
      requirementLabel: requirement.label,
      requirementKind: requirement.kind,
      status: seed?.status ?? "not_found",
      citations: seed ? toCitations(candidateId, requirement.id, seed.citations) : [],
      note: seed?.note ?? null,
    };
  });
}

/** Every extracted passage for a candidate, used as the search corpus. */
export function passagesFor(
  candidateId: string,
): { term: string; citation: Citation }[] {
  const perCandidate = evidenceSeeds[candidateId] ?? {};

  return Object.entries(perCandidate).flatMap(([label, seed]) =>
    seed.status === "not_found"
      ? []
      : toCitations(candidateId, label.replace(/\s+/g, "-").toLowerCase(), seed.citations).map(
          (citation) => ({ term: label, citation }),
        ),
  );
}

/* -------------------------------------------------------------------------- */
/* Summaries & interview questions                                             */
/* -------------------------------------------------------------------------- */

export function buildSummary(candidateId: string): CandidateSummary | null {
  const seed = summarySeeds[candidateId];
  if (!seed) return null;

  return {
    candidateId,
    vacancyId: candidateById.get(candidateId)?.primaryVacancyId ?? null,
    headline: seed.headline,
    bullets: seed.bullets,
    openQuestions: seed.openQuestions,
    generatedAt: seed.generatedAt,
  };
}

export function buildInterviewQuestions(
  candidateId: string,
): InterviewQuestion[] {
  const seeds = questionSeeds[candidateId] ?? [];
  const vacancyId = candidateById.get(candidateId)?.primaryVacancyId ?? null;
  const requirements = vacancyId
    ? (vacancyById.get(vacancyId)?.requirements ?? [])
    : [];

  return seeds.map((seed, index) => ({
    id: `${candidateId}-q-${index + 1}`,
    candidateId,
    category: seed.category,
    question: seed.question,
    rationale: seed.rationale,
    relatedRequirementId:
      requirements.find((r) => r.label === seed.requirementLabel)?.id ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* Processing                                                                  */
/* -------------------------------------------------------------------------- */

const FAILURE_REASONS: Record<string, string> = {
  "doc-13": "Text layer missing — the PDF appears to be a flat scan. Re-upload with OCR or send a DOCX.",
};

export const processingJobs: ProcessingJob[] = documents.map((document) => {
  const candidate = document.candidateId
    ? candidateById.get(document.candidateId)
    : null;

  return {
    id: `job-${document.id}`,
    documentId: document.id,
    documentName: document.fileName,
    candidateId: candidate?.id ?? null,
    candidateName: candidate?.fullName ?? null,
    vacancyId: document.vacancyId,
    vacancyTitle: document.vacancyId
      ? (vacancyTitleById.get(document.vacancyId) ?? null)
      : null,
    status: document.status,
    progress: processingProgress(document.status),
    error: document.status === "failed" ? (FAILURE_REASONS[document.id] ?? "Processing failed.") : null,
    startedAt: document.uploadedAt,
    updatedAt: candidate?.updatedAt ?? document.uploadedAt,
    completedAt:
      document.status === "completed" ? (candidate?.updatedAt ?? null) : null,
  };
});

export const globalProcessingSummary = summarizeProcessing(
  documents.map((document) => document.status),
);

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

export const activity: ActivityEntry[] = [
  {
    id: "act-1",
    kind: "processing",
    message: "Indexing finished for laura-bianchi-cv.pdf",
    detail: "Frontend Engineer, Design Systems",
    at: "2026-08-20T08:58:00.000Z",
  },
  {
    id: "act-2",
    kind: "processing",
    message: "oleg-ivanov-resume.pdf failed to parse",
    detail: "Text layer missing — needs a re-upload",
    at: "2026-08-20T08:51:00.000Z",
  },
  {
    id: "act-3",
    kind: "upload",
    message: "6 resumes uploaded to Senior Backend Engineer",
    detail: "by Marcus Lindqvist",
    at: "2026-08-20T08:44:00.000Z",
  },
  {
    id: "act-4",
    kind: "review",
    message: "Aziz Yusupov marked as reviewed",
    detail: "by Shukhratbek Alijonov · 8 of 8 requirements checked",
    at: "2026-08-19T14:22:00.000Z",
  },
  {
    id: "act-5",
    kind: "review",
    message: "Daniel Osei flagged for human review",
    detail: "Backend-experience requirement needs a judgement call",
    at: "2026-08-19T11:30:00.000Z",
  },
  {
    id: "act-6",
    kind: "vacancy",
    message: "Data Engineer opened",
    detail: "by Marcus Lindqvist",
    at: "2026-08-04T13:20:00.000Z",
  },
];

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function findVacancy(id: string): Vacancy | null {
  return vacancyById.get(id) ?? null;
}

export function findCandidate(id: string): Candidate | null {
  return candidateById.get(id) ?? null;
}

export function findDocument(id: string): CandidateDocument | null {
  return documentById.get(id) ?? null;
}

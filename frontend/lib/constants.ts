import type {
  ApplicationStage,
  EmploymentType,
  EvidenceStatus,
  ExperienceLevel,
  InterviewQuestionCategory,
  PipelineStage,
  ProcessingStatus,
  RequirementCategory,
  RequirementKind,
  ReviewState,
  UserRole,
  VacancyStatus,
} from "@/lib/types";

export const APP_NAME = "HR Copilot AI";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  principal: "Principal",
};

export const VACANCY_STATUS_LABELS: Record<VacancyStatus, string> = {
  draft: "Draft",
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export const PROCESSING_STATUS_LABELS: Record<ProcessingStatus, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  parsing: "Parsing",
  chunking: "Chunking",
  embedding: "Embedding",
  indexing: "Indexing",
  completed: "Completed",
  failed: "Failed",
};

/** Column labels for the cumulative pipeline readout. */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  uploaded: "Uploaded",
  parsing: "Parsing",
  chunking: "Chunking",
  embedding: "Embedding",
  indexing: "Indexed",
  completed: "Completed",
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  not_reviewed: "Not reviewed",
  needs_human_review: "Needs human review",
  reviewed: "Reviewed",
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  found: "Evidence found",
  not_found: "No evidence found",
  needs_human_review: "Needs human review",
};

export const REQUIREMENT_KIND_LABELS: Record<RequirementKind, string> = {
  must_have: "Must have",
  nice_to_have: "Nice to have",
};

export const REQUIREMENT_CATEGORY_LABELS: Record<RequirementCategory, string> = {
  skill: "Skill",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  language: "Language",
  other: "Other",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
};

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  new: "New",
  in_review: "In review",
  interview: "Interview",
  offer: "Offer",
  closed: "Closed",
};

export const INTERVIEW_CATEGORY_LABELS: Record<
  InterviewQuestionCategory,
  string
> = {
  technical: "Technical",
  experience: "Experience",
  system_design: "System design",
  collaboration: "Collaboration",
};

/** Accepted resume formats. Kept in one place so validation and copy agree. */
export const ACCEPTED_RESUME_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
] as const;

export const ACCEPTED_RESUME_EXTENSIONS = [".pdf", ".docx", ".doc"] as const;

export const MAX_RESUME_SIZE_BYTES = 15 * 1024 * 1024;

export const MAX_COMPARE_CANDIDATES = 5;
export const MIN_COMPARE_CANDIDATES = 2;

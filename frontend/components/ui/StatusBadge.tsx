"use client";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import type {
  AnswerStatus,
  ApplicationStatus,
  DocumentStatus,
  EvidenceStatus,
  ProcessingJobStatus,
  VacancyStatus,
} from "@/lib/types";

/**
 * Status pills.
 *
 * Client components because the label comes from the active dictionary: these
 * are rendered inside both server and client trees, and a server-only variant
 * would mean maintaining two of each.
 *
 * Tones carry meaning about *evidence and pipeline state*, never about a
 * person. Nothing here is styled as a verdict the product reached on its own.
 */

const VACANCY_TONES: Record<VacancyStatus, BadgeTone> = {
  DRAFT: "neutral",
  OPEN: "positive",
  CLOSED: "neutral",
  ARCHIVED: "neutral",
};

const DOCUMENT_TONES: Record<DocumentStatus, BadgeTone> = {
  UPLOADED: "neutral",
  QUEUED: "neutral",
  PARSING: "info",
  CHUNKING: "info",
  EMBEDDING: "info",
  INDEXING: "info",
  COMPLETED: "positive",
  FAILED: "critical",
};

const JOB_TONES: Record<ProcessingJobStatus, BadgeTone> = {
  PENDING: "neutral",
  QUEUED: "neutral",
  RUNNING: "info",
  COMPLETED: "positive",
  FAILED: "critical",
};

/**
 * Application stages are human decisions. They are shown neutrally — no stage
 * is styled as a verdict the product reached on its own.
 */
const APPLICATION_TONES: Record<ApplicationStatus, BadgeTone> = {
  NEW: "neutral",
  REVIEWING: "info",
  INTERVIEW: "info",
  OFFER: "brand",
  HIRED: "positive",
  REJECTED: "neutral",
  WITHDRAWN: "neutral",
};

const EVIDENCE_TONES: Record<EvidenceStatus, BadgeTone> = {
  FOUND: "positive",
  NOT_FOUND: "neutral",
  NEEDS_REVIEW: "warning",
  NOT_RUN: "neutral",
};

/**
 * Quality of an AI *answer*, never of a candidate. "Insufficient evidence" is
 * neutral rather than critical: it describes the documents, not the person.
 */
const ANSWER_TONES: Record<AnswerStatus, BadgeTone> = {
  GROUNDED: "positive",
  INSUFFICIENT_EVIDENCE: "neutral",
  NEEDS_HUMAN_REVIEW: "warning",
};

export function VacancyStatusBadge({ status }: { status: VacancyStatus }) {
  const { d } = useI18n();
  return <Badge tone={VACANCY_TONES[status]}>{d.status.vacancy[status]}</Badge>;
}

export function DocumentStatusBadge({
  status,
}: {
  status: DocumentStatus | null;
}) {
  const { d } = useI18n();
  if (!status) return <Badge tone="neutral">{d.candidates.noDocuments}</Badge>;
  return (
    <Badge tone={DOCUMENT_TONES[status]}>{d.status.document[status]}</Badge>
  );
}

export function ProcessingJobStatusBadge({
  status,
}: {
  status: ProcessingJobStatus;
}) {
  const { d } = useI18n();
  return <Badge tone={JOB_TONES[status]}>{d.status.job[status]}</Badge>;
}

export function ApplicationStatusBadge({
  status,
}: {
  status: ApplicationStatus;
}) {
  const { d } = useI18n();
  return (
    <Badge tone={APPLICATION_TONES[status]}>{d.status.application[status]}</Badge>
  );
}

export function EvidenceStatusBadge({
  status,
  short = false,
}: {
  status: EvidenceStatus;
  /** Compact wording for table cells, where the legend carries the detail. */
  short?: boolean;
}) {
  const { d } = useI18n();
  const labels = short ? d.status.evidenceShort : d.status.evidence;
  return <Badge tone={EVIDENCE_TONES[status]}>{labels[status]}</Badge>;
}

export function AnswerStatusBadge({ status }: { status: AnswerStatus }) {
  const { d } = useI18n();
  return <Badge tone={ANSWER_TONES[status]}>{d.status.answer[status]}</Badge>;
}

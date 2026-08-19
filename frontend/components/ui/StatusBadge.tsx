import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  EVIDENCE_STATUS_LABELS,
  PROCESSING_STATUS_LABELS,
  REVIEW_STATE_LABELS,
  VACANCY_STATUS_LABELS,
} from "@/lib/constants";
import type {
  EvidenceStatus,
  ProcessingStatus,
  ReviewState,
  VacancyStatus,
} from "@/lib/types";

const VACANCY_TONES: Record<VacancyStatus, BadgeTone> = {
  draft: "neutral",
  open: "positive",
  on_hold: "warning",
  closed: "neutral",
};

const PROCESSING_TONES: Record<ProcessingStatus, BadgeTone> = {
  uploaded: "neutral",
  queued: "neutral",
  parsing: "info",
  chunking: "info",
  embedding: "info",
  indexing: "info",
  completed: "positive",
  failed: "critical",
};

const REVIEW_TONES: Record<ReviewState, BadgeTone> = {
  not_reviewed: "neutral",
  needs_human_review: "warning",
  reviewed: "positive",
};

const EVIDENCE_TONES: Record<EvidenceStatus, BadgeTone> = {
  found: "positive",
  not_found: "neutral",
  needs_human_review: "warning",
};

export function VacancyStatusBadge({ status }: { status: VacancyStatus }) {
  return <Badge tone={VACANCY_TONES[status]}>{VACANCY_STATUS_LABELS[status]}</Badge>;
}

export function ProcessingStatusBadge({ status }: { status: ProcessingStatus }) {
  return (
    <Badge tone={PROCESSING_TONES[status]}>
      {PROCESSING_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  return <Badge tone={REVIEW_TONES[state]}>{REVIEW_STATE_LABELS[state]}</Badge>;
}

export function EvidenceStatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <Badge tone={EVIDENCE_TONES[status]}>{EVIDENCE_STATUS_LABELS[status]}</Badge>
  );
}

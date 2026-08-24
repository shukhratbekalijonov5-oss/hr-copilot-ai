"use client";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useI18n } from "@/lib/i18n/context";
import type { ApplicationStatus } from "@/lib/types";

/**
 * One application's stage, in the applicant's own vocabulary.
 *
 * ## Semantic, but never colour-only
 *
 * The tone follows what the stage means to the person who applied — an
 * interview is progress, a rejection is closed — while the word is always
 * printed. Anyone who cannot separate the hues reads exactly the same
 * information, which is the whole rule for status here.
 *
 * ## Applicant wording, not recruiter wording
 *
 * `d.status.candidateStage` is the job-seeker phrasing of the backend enum.
 * The recruiter side has its own labels for the same values and they are not
 * interchangeable: "New" is a queue position to a recruiter and "Submitted"
 * is a completed act to the person who did it.
 */
const TONES: Record<ApplicationStatus, BadgeTone> = {
  NEW: "info",
  REVIEWING: "info",
  INTERVIEW: "brand",
  OFFER: "positive",
  HIRED: "positive",
  REJECTED: "neutral",
  WITHDRAWN: "neutral",
};

export function CandidateStageBadge({ status }: { status: ApplicationStatus }) {
  const { d } = useI18n();
  return <Badge tone={TONES[status]}>{d.status.candidateStage[status]}</Badge>;
}

import type { ReadinessStep } from "@/components/candidate/ui/ProfileReadiness";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type {
  ApplicationStatus,
  CandidateAccount,
  CandidateEvidenceState,
  CandidateJobPreferences,
  MyApplication,
} from "@/lib/types";

/**
 * What the dashboard says, decided here rather than in the page.
 *
 * Pure functions over data the server already sent, so the rules are testable
 * without rendering and so no panel can quietly invent a number. Nothing in
 * this file fetches, and nothing derives a score from a score.
 */

/* ------------------------------------------------------------------ */
/* Profile readiness                                                   */
/* ------------------------------------------------------------------ */

export interface ReadinessInput {
  account: CandidateAccount | null;
  evidence: CandidateEvidenceState | null;
  preferences: CandidateJobPreferences | null;
}

/**
 * Four steps, each `done` because a server value says so.
 *
 * A step whose source failed to load is reported as NOT done — which reads as
 * "we cannot confirm this yet" and points at the page that can. Claiming a
 * step is complete on the strength of a failed request is the one mistake
 * that would make this panel worth less than nothing.
 */
export function readinessSteps(
  input: ReadinessInput,
  d: Dictionary,
): ReadinessStep[] {
  const copy = d.home.readiness;
  const { account, evidence, preferences } = input;

  return [
    {
      id: "resume",
      done: Boolean(account?.resume) || (evidence?.files ?? 0) > 0,
      label: account?.resume ? copy.resumeDone : copy.resume,
      hint: copy.resumeHint,
      href: "/my-profile",
      actionLabel: copy.add,
    },
    {
      id: "links",
      done: (evidence?.links ?? 0) > 0,
      label: (evidence?.links ?? 0) > 0 ? copy.linksDone : copy.links,
      hint: copy.linksHint,
      href: "/my-profile",
      actionLabel: copy.add,
    },
    {
      id: "profile",
      done: Boolean(account?.headline) && (account?.skills.length ?? 0) > 0,
      label:
        Boolean(account?.headline) && (account?.skills.length ?? 0) > 0
          ? copy.profileDone
          : copy.profile,
      hint: copy.profileHint,
      href: "/my-profile",
      actionLabel: copy.add,
    },
    {
      id: "preferences",
      // `stated` is the backend's own distinction between "no preference
      // profile" and "a deliberately empty one". Never inferred from length.
      done: preferences?.stated === true,
      label: preferences?.stated ? copy.preferencesDone : copy.preferences,
      hint: copy.preferencesHint,
      href: "/job-preferences",
      actionLabel: copy.add,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Application pipeline                                                */
/* ------------------------------------------------------------------ */

export type PipelineStage = "applied" | "review" | "interview" | "decision";

export interface Pipeline {
  applied: number;
  review: number;
  interview: number;
  decision: number;
  /** Applications an employer has not finished with. */
  active: number;
  total: number;
}

/**
 * The backend's seven stages, folded into the four a job seeker thinks in.
 *
 * OFFER and HIRED sit under "Decision" alongside REJECTED because from the
 * applicant's side all three are the same event — the employer decided. The
 * badge on the row still says which decision it was; only the funnel column
 * is coarse. WITHDRAWN is counted in the total but is in no stage: the
 * candidate ended it, so it is not somewhere in an employer's process.
 */
const STAGE_OF: Record<ApplicationStatus, PipelineStage | null> = {
  NEW: "applied",
  REVIEWING: "review",
  INTERVIEW: "interview",
  OFFER: "decision",
  HIRED: "decision",
  REJECTED: "decision",
  WITHDRAWN: null,
};

const ACTIVE: ApplicationStatus[] = ["NEW", "REVIEWING", "INTERVIEW", "OFFER"];

export function applicationPipeline(applications: MyApplication[]): Pipeline {
  const pipeline: Pipeline = {
    applied: 0,
    review: 0,
    interview: 0,
    decision: 0,
    active: 0,
    total: applications.length,
  };

  for (const application of applications) {
    const stage = STAGE_OF[application.status];
    if (stage) pipeline[stage] += 1;
    if (ACTIVE.includes(application.status)) pipeline.active += 1;
  }

  return pipeline;
}

/* ------------------------------------------------------------------ */
/* Match bands                                                         */
/* ------------------------------------------------------------------ */

/**
 * The backend's evidence-coverage band, mapped to the visual band.
 *
 * A pure rename, never a recomputation: WEAK stays WEAK, and an unrecognised
 * value becomes "unknown" rather than being guessed into a flattering bucket.
 */
export function bandFor(band: string): "strong" | "good" | "partial" | "unknown" {
  if (band === "STRONG") return "strong";
  if (band === "GOOD") return "good";
  if (band === "PARTIAL" || band === "LOW") return "partial";
  return "unknown";
}

import type { CandidateEvidenceState, JobMatchResult } from "@/lib/types";

/**
 * The two rules that decide what an AI Job Match screen is allowed to claim.
 *
 * They live here, apart from the component, because they are product rules
 * rather than rendering details — and because getting either of them backwards
 * shows someone conclusions drawn from evidence they deleted.
 */

/**
 * Can evidence-grounded matching run at all?
 *
 * Files and links count equally and independently: one portfolio link is a
 * perfectly good basis for matching, and a long headline with no files and no
 * links is not. The same condition is enforced in the backend — this is the
 * screen agreeing with it, never the screen deciding it.
 *
 * Note this is NOT the rule for applying, which still requires a resume. A
 * candidate can legitimately be able to match and unable to apply.
 */
export function canRunJobMatch(
  evidence: CandidateEvidenceState | null,
): boolean {
  if (!evidence) return false;
  return evidence.hasAccount && evidence.total > 0;
}

/**
 * Does the displayed result still describe the candidate's evidence?
 *
 * Two independent ways it can stop doing so:
 *
 *  - the backend saw the evidence change WHILE generating (`result.stale`) —
 *    a ~20s call can outlive the file it is describing;
 *  - the evidence changed AFTERWARDS, while the result sat on screen. This is
 *    the common one: deleting a file happens on a different page, and the
 *    match result is still in memory when the candidate navigates back.
 *
 * Unknown evidence state is deliberately NOT treated as stale: a failed state
 * read should not blank out a perfectly good analysis. It is treated as stale
 * only on positive proof that the revision moved.
 */
export function isJobMatchStale(
  result: JobMatchResult | null,
  evidence: CandidateEvidenceState | null,
): boolean {
  if (!result) return false;
  if (result.stale) return true;
  if (!evidence) return false;
  return evidence.evidenceRevision !== result.evidenceRevision;
}

/** Which banner, if any, belongs above the results. */
export type EvidenceHint = "none" | "add-resume" | "resume-improves";

/**
 * A candidate with links but no resume is doing fine — the banner should say
 * so rather than implying they have submitted nothing, which is what a
 * resume-only message does.
 */
export function evidenceHint(
  evidence: CandidateEvidenceState | null,
): EvidenceHint {
  if (!evidence) return "none";
  if (evidence.files > 0) return "none";
  return evidence.links > 0 ? "resume-improves" : "add-resume";
}

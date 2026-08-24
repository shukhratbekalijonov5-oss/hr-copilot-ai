import type { Dictionary } from "@/lib/i18n/dictionary";
import type { IntentAlignment, JobMatch, PayPeriod } from "@/lib/types";
import { formatNumber } from "@/lib/i18n/format";

/**
 * Turning a match into the two lists a candidate actually wants to read:
 * why this job is here, and why it is not higher.
 *
 * ## Deterministic, not generated
 *
 * Every line below comes from a machine-readable fact the backend computed —
 * a reason code, a requirement count, a converted salary. Nothing here asks a
 * model anything, and nothing here recomputes a score or converts money. The
 * prose Gemini writes is a nice-to-have that sits beside these; these are the
 * explanation, and they are available instantly and offline.
 *
 * ## Why the split is by STATE and not by score
 *
 * A reader wants "what is good" and "what is holding it back". An alignment's
 * state answers that directly: MATCH and PARTIAL argue for the job, MISMATCH
 * argues against it, and UNKNOWN / NOT_COMPARABLE argue for nothing at all —
 * they are facts about missing information, so they go in the second list
 * phrased as absences rather than as faults. Saying "salary is below your
 * minimum" when the employer simply did not state a salary would be inventing
 * a complaint on the employer's behalf.
 */

export type ExplanationTone = "positive" | "negative" | "neutral";

export interface ExplanationFact {
  /** Stable key for React and for tests. */
  key: string;
  text: string;
  tone: ExplanationTone;
  /** Extra deterministic line, e.g. the pay behind a salary verdict. */
  detail?: string;
}

export interface MatchExplanation {
  /** Reasons this job is a fit — capability first, then preferences. */
  matches: ExplanationFact[];
  /** What is holding the score down, including honest unknowns. */
  notHigher: ExplanationFact[];
}

/** The dictionary block holding one localized string per reason code. */
type ReasonLabels = Dictionary["jobMatch"]["matchReason"];

function reasonText(reason: string, d: Dictionary): string | null {
  const labels = d.jobMatch.matchReason as unknown as Record<string, string>;
  return labels[reason] ?? null;
}

/**
 * Money as a bare, locale-grouped amount plus its ISO code.
 *
 * The code rather than a symbol, and `formatNumber` rather than
 * `Intl.NumberFormat`: the project bans Intl here because Node and browser ICU
 * data differ and the mismatch shows up as a hydration error. This is display
 * only — the value was already decided by the backend.
 */
export function formatMoney(
  amount: number,
  currency: string,
  payPeriod: PayPeriod | null,
  d: Dictionary,
): string {
  const money = `${formatNumber(amount, d)} ${currency}`;
  if (!payPeriod) return money;
  return d.jobProfile.perPeriod
    .replace("{amount}", money)
    .replace("{period}", d.payPeriod[payPeriod]);
}

/** A range, or a single figure when both ends are the same or one is absent. */
export function formatMoneyRange(
  min: number | null,
  max: number | null,
  currency: string,
  payPeriod: PayPeriod | null,
  d: Dictionary,
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) {
    const range = d.jobProfile.salaryRange
      .replace("{min}", formatNumber(min, d))
      .replace("{max}", `${formatNumber(max, d)} ${currency}`);
    return payPeriod
      ? d.jobProfile.perPeriod
          .replace("{amount}", range)
          .replace("{period}", d.payPeriod[payPeriod])
      : range;
  }
  return formatMoney((min ?? max) as number, currency, payPeriod, d);
}

/**
 * The converted-salary line, e.g. "≈ 28,777 USD / year".
 *
 * Returned only when a conversion actually happened: a salary already in the
 * candidate's currency needs no approximation, and showing one would suggest
 * an exchange took place that did not.
 */
export function convertedSalaryLine(
  alignment: IntentAlignment,
  d: Dictionary,
): string | null {
  const salary = alignment.salary;
  if (!salary?.convertedCurrency) return null;
  if (salary.convertedCurrency === salary.originalCurrency) return null;
  const converted = formatMoneyRange(
    salary.convertedMin,
    salary.convertedMax,
    salary.convertedCurrency,
    salary.convertedPayPeriod,
    d,
  );
  if (!converted) return null;
  return d.jobMatch.approxSalary.replace("{amount}", converted);
}

function capabilityFacts(match: JobMatch, d: Dictionary): ExplanationFact[] {
  const facts: ExplanationFact[] = [];
  const supported = match.supportedRequirements.length;
  if (supported > 0) {
    facts.push({
      key: "capability-supported",
      tone: "positive",
      text: d.jobMatch.capabilityStrong.replace("{count}", String(supported)),
    });
  }
  if (match.matchedSkills.length > 0) {
    facts.push({
      key: "capability-skills",
      tone: "positive",
      // Capped: a card listing thirty technologies is not a reason, it is a
      // wall. The full list stays available in the requirement breakdown.
      text: d.jobMatch.skillsMatched.replace(
        "{skills}",
        match.matchedSkills.slice(0, 4).join(", "),
      ),
    });
  }
  return facts;
}

function capabilityGaps(match: JobMatch, d: Dictionary): ExplanationFact[] {
  const facts: ExplanationFact[] = [];
  const unsupported = match.unsupportedRequirements.length;
  const unclear = match.unclearRequirements.length;
  if (match.supportedRequirements.length === 0 && unsupported > 0) {
    // The honest headline when nothing at all was demonstrated.
    facts.push({
      key: "capability-none",
      tone: "negative",
      text: d.jobMatch.capabilityNone,
    });
  } else if (unsupported > 0) {
    facts.push({
      key: "capability-missing",
      tone: "negative",
      text: d.jobMatch.capabilityMissing.replace("{count}", String(unsupported)),
    });
  }
  if (unclear > 0) {
    facts.push({
      key: "capability-unclear",
      tone: "neutral",
      text: d.jobMatch.capabilityUnclear.replace("{count}", String(unclear)),
    });
  }
  return facts;
}

function alignmentFact(
  alignment: IntentAlignment,
  d: Dictionary,
): ExplanationFact | null {
  const text = reasonText(alignment.reason, d);
  // An unrecognized code is skipped rather than printed raw: a candidate must
  // never be shown SALARY_PARTIAL_OVERLAP as if it were a sentence.
  if (!text) return null;
  const tone: ExplanationTone =
    alignment.state === "MATCH" || alignment.state === "PARTIAL"
      ? "positive"
      : alignment.state === "MISMATCH"
        ? "negative"
        : "neutral";
  const fact: ExplanationFact = {
    key: `align-${alignment.dimension}`,
    tone,
    text,
  };
  const converted = convertedSalaryLine(alignment, d);
  if (converted) fact.detail = converted;
  return fact;
}

/**
 * Both lists for one match.
 *
 * Preference reasons follow capability ones because capability is what the
 * score is mostly made of — 80% of it — and leading with "matches your target
 * role" on a job whose requirements are entirely unmet would flatter the match.
 */
export function matchExplanation(
  match: JobMatch,
  d: Dictionary,
): MatchExplanation {
  const matches: ExplanationFact[] = capabilityFacts(match, d);
  const notHigher: ExplanationFact[] = capabilityGaps(match, d);

  for (const alignment of match.alignments) {
    const fact = alignmentFact(alignment, d);
    if (!fact) continue;
    if (fact.tone === "positive") matches.push(fact);
    else notHigher.push(fact);
  }
  return { matches, notHigher };
}

/**
 * The two or three lines worth showing on a collapsed card.
 *
 * Positive facts only: a summary is what argues FOR opening this job. The
 * reasons it scores where it does are one click away, not hidden.
 */
export function topReasons(
  match: JobMatch,
  d: Dictionary,
  limit = 3,
): ExplanationFact[] {
  return matchExplanation(match, d).matches.slice(0, limit);
}

export type { ReasonLabels };

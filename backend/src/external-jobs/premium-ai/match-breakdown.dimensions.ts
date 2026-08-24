import type {
  PremiumAiContext,
  PremiumAlignment,
} from './external-premium-ai.context';
import {
  MAX_BREAKDOWN_DIMENSIONS,
  MAX_BREAKDOWN_VALUES,
} from './external-premium-ai.policy';

/**
 * The DETERMINISTIC half of the Advanced Match Breakdown.
 *
 * Every status below is derived from stored values and the shared matchers'
 * own verdicts — never from a model. Gemini receives this table as decided
 * facts and contributes prose about it; it has no field through which a
 * status could come back, so it structurally cannot override one.
 *
 * ## Status semantics
 *
 * - STRONG   — the stored facts on both sides genuinely align.
 * - PARTIAL  — some of what the job states is answered, some is not.
 * - GAP      — both sides stated comparable facts and they do not align.
 * - UNKNOWN  — the comparison cannot honestly be made: the employer stated
 *              nothing, the candidate stated nothing, or the shared matcher
 *              itself said UNKNOWN / NOT_COMPARABLE.
 *
 * The one rule that shapes everything: **silence is never a weakness.** A
 * job with no salary is UNKNOWN, not GAP. A candidate with no stated
 * preference gets UNKNOWN, not a verdict. And a dimension where NEITHER side
 * said anything is omitted entirely — an all-UNKNOWN table would be noise
 * pretending to be analysis.
 *
 * ## Why preference dimensions read the alignment entries
 *
 * `searchAlignment` (the exact function external search ranks with) emits an
 * entry ONLY for dimensions the candidate stated a preference on. Presence
 * of an entry therefore IS the fact "a preference exists", and its state is
 * the same verdict the ranking used — one ladder, one currency conversion,
 * one opinion per dimension across every surface.
 */

export type BreakdownStatus = 'STRONG' | 'PARTIAL' | 'GAP' | 'UNKNOWN';

export interface BreakdownDimension {
  key: string;
  /** Canonical English label; clients localize by `key`. */
  label: string;
  status: BreakdownStatus;
  matched: string[];
  missing: string[];
  /**
   * The deterministic ground for the status, in plain English. Travels to
   * the model as a supplied fact and serves as the explanation fallback when
   * the model returns none for this key. Never shown as-is when a generated
   * explanation exists.
   */
  reason: string;
}

/** MATCH/PARTIAL/MISMATCH/UNKNOWN/NOT_COMPARABLE → breakdown status. */
const STATE_TO_STATUS: Record<string, BreakdownStatus> = {
  MATCH: 'STRONG',
  PARTIAL: 'PARTIAL',
  MISMATCH: 'GAP',
  UNKNOWN: 'UNKNOWN',
  NOT_COMPARABLE: 'UNKNOWN',
};

/**
 * Minimal ISO-639-ish code ↔ English-name pairs for the language dimension.
 * Deliberately small and conservative: a pair not listed here simply fails
 * to match, and an unconfirmed overlap reads as UNKNOWN — never as GAP.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'english',
  ko: 'korean',
  ru: 'russian',
  uz: 'uzbek',
  ja: 'japanese',
  zh: 'chinese',
  de: 'german',
  fr: 'french',
  es: 'spanish',
  pt: 'portuguese',
  it: 'italian',
  hi: 'hindi',
  ar: 'arabic',
  vi: 'vietnamese',
  id: 'indonesian',
  tr: 'turkish',
  pl: 'polish',
  nl: 'dutch',
  th: 'thai',
};

function languageForms(value: string): Set<string> {
  const raw = value.trim().toLowerCase();
  const forms = new Set([raw]);
  if (LANGUAGE_NAMES[raw]) forms.add(LANGUAGE_NAMES[raw]);
  for (const [code, name] of Object.entries(LANGUAGE_NAMES)) {
    if (raw === name) forms.add(code);
  }
  return forms;
}

function clip(values: string[]): string[] {
  return values.slice(0, MAX_BREAKDOWN_VALUES);
}

/**
 * Derive every dimension that has enough real information, in a fixed
 * canonical order. At most MAX_BREAKDOWN_DIMENSIONS entries by construction.
 */
export function deriveBreakdownDimensions(
  context: PremiumAiContext,
): BreakdownDimension[] {
  const dimensions: BreakdownDimension[] = [];
  const aligned = new Map<string, PremiumAlignment>(
    context.alignments.map((entry) => [entry.dimension, entry]),
  );

  const skills = skillsDimension(context);
  if (skills) dimensions.push(skills);

  const preferenceDimensions: {
    key: string;
    label: string;
    alignmentKey: string;
    jobValue: string | null;
  }[] = [
    {
      key: 'seniority',
      label: 'Seniority',
      alignmentKey: 'seniority',
      jobValue: context.job.seniorityLevel,
    },
    {
      key: 'workMode',
      label: 'Work mode',
      alignmentKey: 'workMode',
      jobValue: context.job.workMode,
    },
    {
      key: 'employmentType',
      label: 'Employment type',
      alignmentKey: 'employmentType',
      jobValue: context.job.employmentType,
    },
    {
      key: 'location',
      label: 'Location',
      alignmentKey: 'location',
      jobValue: context.job.locationLabel,
    },
    {
      key: 'salary',
      label: 'Salary',
      alignmentKey: 'salary',
      jobValue: context.job.salaryLabel,
    },
  ];

  for (const spec of preferenceDimensions) {
    const entry = aligned.get(spec.alignmentKey);
    if (entry) {
      // The candidate stated a preference; the shared matcher compared it.
      // Its UNKNOWN (employer silent) stays UNKNOWN here — silence is not
      // a weakness, and SALARY_UNKNOWN must never surface as GAP.
      dimensions.push({
        key: spec.key,
        label: spec.label,
        status: STATE_TO_STATUS[entry.state] ?? 'UNKNOWN',
        matched: [],
        missing: [],
        reason: preferenceReason(spec.label, entry, spec.jobValue),
      });
      continue;
    }
    if (spec.jobValue) {
      // The job states a value but the candidate stated no preference:
      // there is a fact worth showing and honestly nothing to compare it to.
      dimensions.push({
        key: spec.key,
        label: spec.label,
        status: 'UNKNOWN',
        matched: [],
        missing: [],
        reason:
          `The job states ${spec.label.toLowerCase()}: ${spec.jobValue}. ` +
          'You have not stated a preference on this, so no comparison was made.',
      });
    }
    // Neither side said anything → the dimension is omitted, not padded.
  }

  const languages = languagesDimension(context);
  if (languages) dimensions.push(languages);

  return dimensions.slice(0, MAX_BREAKDOWN_DIMENSIONS);
}

function skillsDimension(context: PremiumAiContext): BreakdownDimension | null {
  const jobSkills = context.job.skills.filter((skill) => skill.trim());
  if (jobSkills.length === 0) {
    // The employer listed no skills. There is nothing to break down, and an
    // UNKNOWN row would only imply an absence on the candidate's side.
    return null;
  }
  if (context.candidate.skills.length === 0) {
    return {
      key: 'skills',
      label: 'Skills',
      status: 'UNKNOWN',
      matched: [],
      missing: [],
      reason:
        `The job lists ${jobSkills.length} skill(s), but your profile ` +
        'states no skills yet, so no comparison was made. This is missing ' +
        'information, not a verdict.',
    };
  }
  const matched = clip(context.facts.matchedSkills);
  const missing = clip(context.facts.missingSkills);
  const status: BreakdownStatus =
    matched.length > 0 && missing.length === 0
      ? 'STRONG'
      : matched.length > 0
        ? 'PARTIAL'
        : 'GAP';
  return {
    key: 'skills',
    label: 'Skills',
    status,
    matched,
    missing,
    reason:
      `Of the skills this job lists, your profile shows ` +
      `${context.facts.matchedSkills.length} and does not show ` +
      `${context.facts.missingSkills.length}. Computed by set ` +
      'intersection over stored values.',
  };
}

function languagesDimension(
  context: PremiumAiContext,
): BreakdownDimension | null {
  const jobLanguages = context.job.languages.filter((value) => value.trim());
  if (jobLanguages.length === 0) return null; // Employer silent → omitted.
  if (context.candidate.languages.length === 0) {
    return {
      key: 'languages',
      label: 'Languages',
      status: 'UNKNOWN',
      matched: [],
      missing: [],
      reason:
        'The job states required languages, but your profile lists no ' +
        'languages, so no comparison was made.',
    };
  }
  const candidateForms = new Set<string>();
  for (const value of context.candidate.languages) {
    for (const form of languageForms(value)) candidateForms.add(form);
  }
  const matched: string[] = [];
  const unconfirmed: string[] = [];
  for (const value of jobLanguages) {
    const overlap = [...languageForms(value)].some((form) =>
      candidateForms.has(form),
    );
    (overlap ? matched : unconfirmed).push(value);
  }
  if (matched.length === 0) {
    /*
     * No overlap CONFIRMED — which is not the same as a confirmed gap.
     * Language self-reports are free text ("English", "en", "영어"); when
     * normalization finds nothing, the honest verdict is that we could not
     * compare, never that the candidate lacks the language.
     */
    return {
      key: 'languages',
      label: 'Languages',
      status: 'UNKNOWN',
      matched: [],
      missing: [],
      reason:
        'No overlap between the languages the job states and the languages ' +
        'on your profile could be confirmed. Language names are free text, ' +
        'so this is unconfirmed — not a verdict that you lack them.',
    };
  }
  return {
    key: 'languages',
    label: 'Languages',
    status: unconfirmed.length === 0 ? 'STRONG' : 'PARTIAL',
    matched: clip(matched),
    missing: clip(unconfirmed),
    reason:
      `Of the languages this job states, ${matched.length} match(es) your ` +
      `profile and ${unconfirmed.length} could not be confirmed.`,
  };
}

function preferenceReason(
  label: string,
  entry: PremiumAlignment,
  jobValue: string | null,
): string {
  const stated = jobValue
    ? `The job states ${label.toLowerCase()}: ${jobValue}. `
    : `The job does not state its ${label.toLowerCase()}. `;
  return (
    stated +
    `Compared against your stated preference by the shared deterministic ` +
    `matcher; verdict code ${entry.reason}.`
  );
}

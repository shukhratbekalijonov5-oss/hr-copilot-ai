/**
 * The eight explainable dimensions, each `score / max` with fixed
 * denominators (30/20/15/10/10/5/5/5 — MATCH_DIMENSION_MAX).
 *
 * These EXPLAIN; they never re-rank. The canonical ranking score stays the
 * match-policy formula. A dimension appears only when it is evaluable — a
 * vacancy with no language requirements simply has no `languageFit` row,
 * which is more honest than a fabricated neutral 50%.
 *
 * Every rule here is deterministic and documented inline; unknown facts earn
 * neutral credit (0.5) or drop the dimension, never zero — "not stated" is
 * not a failure (Rule N-series: empty ≠ reject).
 */

import type { SeniorityLevel } from '../../generated/prisma/enums';
import type { IntentAlignment } from '../intent-alignment';
import {
  ADJACENT_FAMILIES,
  ROLE_FAMILY_TITLES,
  SENIORITY_ORDER,
  normalizeTitle,
} from '../intent-alignment';
import type { CandidateJobIntent } from '../../candidate-preferences/candidate-job-intent';
import {
  MATCH_DIMENSION_MAX,
  type MatchDimension,
  type MatchDimensionKey,
  type RequirementMatrixRow,
} from './advanced-match.types';
import type { ExperienceFact, ProfileFacts } from './profile-facts';
import { containsSkillTerm } from './transferable-skills';

export interface VacancyLanguageFact {
  languageCode: string;
  level: string;
  required: boolean;
}

export interface DimensionInputs {
  context: 'CANDIDATE' | 'HR';
  matrix: readonly RequirementMatrixRow[];
  /** ai-service capability signals (semantic/required/preferred/skills/roleFamily), 0..1. */
  signals: Record<string, number>;
  vacancyTitle: string;
  vacancySeniority: SeniorityLevel | null;
  vacancyLanguages: readonly VacancyLanguageFact[];
  alignments: readonly IntentAlignment[];
  intent: CandidateJobIntent | null;
  profile: ProfileFacts;
  /** Distinct current evidence sources across this match's requirement rows. */
  distinctEvidenceSources: number;
  /** Evidence snippets for this match (for the project-complexity scan). */
  evidenceTexts: readonly string[];
  /** Deterministic "now" — injected so tests pin recency. */
  currentYear: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function dimension(
  key: MatchDimensionKey,
  normalized: number,
  reason?: string,
): MatchDimension {
  const max = MATCH_DIMENSION_MAX[key];
  const clamped = Math.max(0, Math.min(1, normalized));
  const score = Math.round(clamped * max);
  return {
    key,
    labelKey: `match.dimension.${key}`,
    score,
    max,
    // Derived from the ROUNDED score so `${score}/${max}` and the normalized
    // figure can never tell two different stories.
    normalizedScore: round2(score / max),
    ...(reason ? { reason } : {}),
  };
}

// --- requirement-driven dimensions -----------------------------------------

function requirementDimension(
  key: 'mustHaveSkills' | 'niceToHave',
  rows: readonly RequirementMatrixRow[],
): MatchDimension | null {
  if (rows.length === 0) return null;
  const mean =
    rows.reduce((sum, row) => sum + row.scoreContribution, 0) / rows.length;
  const evidenced = rows.filter(
    (r) => r.status === 'STRONG' || r.status === 'MATCH',
  ).length;
  return dimension(
    key,
    mean,
    `${evidenced} of ${rows.length} requirement(s) evidenced in current documents.`,
  );
}

// --- experience depth + recency --------------------------------------------

/**
 * Depth is INDEPENDENT CORROBORATION, not repetition: distinct current
 * sources supporting this match's requirements, with a recency bonus when a
 * recent role (ended within 2 years, or current) mentions a matched skill.
 * Repeating a skill twenty times in one document moves nothing here.
 */
function experienceDepth(
  input: DimensionInputs,
  matchedSkills: readonly string[],
): MatchDimension {
  const sources = input.distinctEvidenceSources;
  const base =
    sources >= 3 ? 0.9 : sources === 2 ? 0.75 : sources === 1 ? 0.5 : 0.15;

  const recentRelevant = input.profile.experience.some((exp) => {
    const recent =
      exp.isCurrent ||
      (exp.endYear !== null && exp.endYear >= input.currentYear - 2);
    if (!recent) return false;
    const text = `${exp.title} ${exp.description ?? ''}`;
    return matchedSkills.some((skill) => containsSkillTerm(text, skill));
  });

  const value = Math.min(1, base + (recentRelevant ? 0.1 : 0));
  const parts = [
    sources === 0
      ? 'No independent evidence sources support this match yet.'
      : `${sources} independent current source(s) support this match.`,
  ];
  if (recentRelevant) {
    parts.push('Recent experience (within 2 years) mentions a matched skill.');
  }
  return dimension('experienceDepth', value, parts.join(' '));
}

// --- role/title similarity ---------------------------------------------------

function familiesOfTitle(title: string): Set<string> {
  const lowered = (title || '').toLowerCase();
  const families = new Set<string>();
  for (const [family, markers] of Object.entries(ROLE_FAMILY_TITLES)) {
    if (markers.some((marker) => lowered.includes(marker)))
      families.add(family);
  }
  if (families.has('frontend') && families.has('backend')) {
    families.add('fullstack');
  }
  return families;
}

function adjacent(a: Set<string>, b: Set<string>): boolean {
  for (const mine of a) {
    for (const theirs of b) {
      if (ADJACENT_FAMILIES.has([mine, theirs].sort().join('|'))) return true;
    }
  }
  return false;
}

/**
 * Deterministic title ladder against the candidate's recent role titles
 * (candidate context also considers stated preferred roles): exact 1.0 →
 * token containment 0.85 → same family 0.6 → adjacent family 0.4 → 0.2.
 * Blended with the ai-service roleFamily signal by MAX — and capped by its
 * own 15-point weight, so title similarity can never dominate evidence.
 */
function roleSimilarity(input: DimensionInputs): MatchDimension {
  const candidateTitles = [
    ...input.profile.experience.slice(0, 3).map((e) => e.title),
    ...(input.intent?.roles ?? []),
  ].filter(Boolean);

  const vacancyNorm = normalizeTitle(input.vacancyTitle);
  const vacancyTokens = new Set(vacancyNorm.split(' ').filter(Boolean));
  const vacancyFamilies = familiesOfTitle(input.vacancyTitle);

  let ladder = candidateTitles.length === 0 ? 0.5 : 0.2;
  let ladderWhy =
    candidateTitles.length === 0 ? 'No current role titles to compare.' : '';
  for (const title of candidateTitles) {
    const norm = normalizeTitle(title);
    let value = 0.2;
    let why = `"${title}" differs from "${input.vacancyTitle}".`;
    const tokens = norm.split(' ').filter(Boolean);
    const contained =
      tokens.length > 0 &&
      (tokens.every((t) => vacancyTokens.has(t)) ||
        [...vacancyTokens].every((t) => tokens.includes(t)));
    const families = familiesOfTitle(title);
    if (norm === vacancyNorm) {
      value = 1;
      why = `Current role title matches "${input.vacancyTitle}".`;
    } else if (contained) {
      value = 0.85;
      why = `"${title}" closely overlaps "${input.vacancyTitle}".`;
    } else if (
      vacancyFamilies.size > 0 &&
      [...families].some((f) => vacancyFamilies.has(f))
    ) {
      value = 0.6;
      why = `"${title}" is in the same role family as this vacancy.`;
    } else if (adjacent(families, vacancyFamilies)) {
      value = 0.4;
      why = `"${title}" is in an adjacent role family.`;
    }
    if (value > ladder) {
      ladder = value;
      ladderWhy = why;
    }
  }

  const familySignal = input.signals['roleFamily'] ?? 0.5;
  const value = Math.max(ladder, familySignal);
  return dimension('roleSimilarity', value, ladderWhy || undefined);
}

// --- seniority ---------------------------------------------------------------

const TITLE_SENIORITY: [RegExp, SeniorityLevel][] = [
  [/intern|trainee/i, 'INTERN'],
  [/junior|jr\.?\b/i, 'JUNIOR'],
  [/staff|principal/i, 'STAFF'],
  [/lead|head of/i, 'LEAD'],
  [/manager|director|vp\b/i, 'MANAGER'],
  [/senior|sr\.?\b/i, 'SENIOR'],
];

export function inferSeniorityFromTitles(
  experience: readonly ExperienceFact[],
): SeniorityLevel | null {
  for (const exp of experience.slice(0, 3)) {
    for (const [pattern, level] of TITLE_SENIORITY) {
      if (pattern.test(exp.title)) return level;
    }
  }
  return experience.length > 0 ? 'MID' : null;
}

function seniorityFit(input: DimensionInputs): MatchDimension | null {
  if (!input.vacancySeniority) return null;
  const stated = input.intent?.seniorityLevels ?? [];
  const inferred = inferSeniorityFromTitles(input.profile.experience);
  const vacancyIdx = SENIORITY_ORDER.indexOf(input.vacancySeniority);

  const candidates = stated.length > 0 ? stated : inferred ? [inferred] : [];
  if (candidates.length === 0 || vacancyIdx < 0) {
    return dimension(
      'seniorityFit',
      0.5,
      'Candidate seniority is not stated; neutral credit.',
    );
  }
  const distance = Math.min(
    ...candidates.map((level) => {
      const idx = SENIORITY_ORDER.indexOf(level);
      return idx < 0 ? 99 : Math.abs(idx - vacancyIdx);
    }),
  );
  const value =
    distance === 0 ? 1 : distance === 1 ? 0.6 : distance === 2 ? 0.3 : 0.1;
  const source = stated.length > 0 ? 'stated' : 'inferred from recent titles';
  const reason =
    distance === 0
      ? `Seniority (${source}) matches the vacancy's ${input.vacancySeniority} level.`
      : `Seniority (${source}) is ${distance} level(s) from the vacancy's ${input.vacancySeniority}.`;
  return dimension('seniorityFit', value, reason);
}

// --- project complexity ------------------------------------------------------

/**
 * Complexity FACETS, each counted at most once however often its words repeat
 * — breadth of demonstrated engineering concerns, not keyword volume.
 */
export const COMPLEXITY_FACETS: Record<string, RegExp> = {
  architecture:
    /architect|microservice|service-oriented|event-driven|design pattern/i,
  production: /production|deployed|deployment|launch|shipped|live traffic/i,
  cicd: /ci\/cd|cicd|continuous integration|continuous delivery|pipeline|github actions|gitlab ci|jenkins/i,
  observability:
    /monitoring|observability|grafana|prometheus|logging|alerting|tracing/i,
  distributed:
    /distributed|scalab|high availability|load balanc|sharding|replication|queue|kafka|rabbitmq/i,
  cloud:
    /aws|azure|gcp|google cloud|cloud infrastructure|kubernetes|terraform|docker/i,
  data: /database|postgres|mysql|mongodb|redis|elasticsearch|data model|sql/i,
  security:
    /security|authentication|authorization|oauth|encryption|owasp|ssrf|xss/i,
};

function projectEvidence(input: DimensionInputs): MatchDimension {
  const corpus = [
    input.profile.summary ?? '',
    ...input.profile.experience.map((e) => `${e.title} ${e.description ?? ''}`),
    ...input.evidenceTexts,
  ]
    .join('\n')
    .toLowerCase();

  const facets = Object.entries(COMPLEXITY_FACETS)
    .filter(([, pattern]) => pattern.test(corpus))
    .map(([name]) => name);

  const value = Math.min(1, 0.1 + facets.length * 0.15);
  const reason =
    facets.length === 0
      ? 'Current evidence shows no distinct engineering-complexity signals yet.'
      : `Evidence shows ${facets.length} complexity signal(s): ${facets.join(', ')}.`;
  return dimension('projectEvidence', value, reason);
}

// --- location / work mode ----------------------------------------------------

function locationWorkMode(input: DimensionInputs): MatchDimension | null {
  if (input.context !== 'CANDIDATE') return null; // preferences stay private
  const byDim = new Map(input.alignments.map((a) => [a.dimension, a]));
  const parts = [byDim.get('location'), byDim.get('workMode')]
    .filter((a): a is IntentAlignment => !!a && a.score !== null)
    .map((a) => a.score as number);
  if (parts.length === 0) return null;
  const value = parts.reduce((a, b) => a + b, 0) / parts.length;
  return dimension(
    'locationWorkMode',
    value,
    'From the stated location and work-mode preferences.',
  );
}

// --- language fit ------------------------------------------------------------

/** Language code → names it may appear under in a free-text languages list. */
const LANGUAGE_NAMES: Record<string, readonly string[]> = {
  en: ['english', '영어', 'английский', 'ingliz'],
  ko: ['korean', '한국어', 'корейский', 'koreys'],
  ru: ['russian', 'русский', 'rus', '러시아어'],
  uz: ['uzbek', "o'zbek", 'ozbek', 'узбекский', '우즈베크어'],
  ja: ['japanese', '일본어', 'японский', 'yapon'],
  zh: ['chinese', 'mandarin', '중국어', 'китайский', 'xitoy'],
  de: ['german', 'deutsch', 'немецкий'],
  fr: ['french', 'français', 'французский'],
  es: ['spanish', 'español', 'испанский'],
  tr: ['turkish', 'türkçe', 'турецкий', 'turk'],
  ar: ['arabic', 'арабский', 'arab'],
  kk: ['kazakh', 'казахский', 'qozoq'],
};

export function candidateSpeaks(
  languages: readonly string[],
  code: string,
): boolean {
  const names = [
    code.toLowerCase(),
    ...(LANGUAGE_NAMES[code.toLowerCase()] ?? []),
  ];
  return languages.some((raw) => {
    const lowered = raw.toLowerCase();
    return names.some((name) => lowered.includes(name));
  });
}

export interface LanguageFitResult {
  dimension: MatchDimension | null;
  missingRequired: string[];
}

export function languageFit(
  vacancyLanguages: readonly VacancyLanguageFact[],
  candidateLanguages: readonly string[],
): LanguageFitResult {
  if (vacancyLanguages.length === 0) {
    return { dimension: null, missingRequired: [] };
  }
  const statedAny = candidateLanguages.length > 0;
  let weightTotal = 0;
  let weighted = 0;
  const missingRequired: string[] = [];
  const found: string[] = [];
  for (const lang of vacancyLanguages) {
    const weight = lang.required ? 1 : 0.5;
    const speaks = candidateSpeaks(candidateLanguages, lang.languageCode);
    // Stated-and-absent earns 0.2, not 0 — the list may be incomplete, and
    // missing evidence is never certainty of absence. Nothing stated at all
    // is UNKNOWN → neutral 0.5.
    const credit = speaks ? 1 : statedAny ? 0.2 : 0.5;
    weightTotal += weight;
    weighted += weight * credit;
    if (speaks) found.push(lang.languageCode);
    else if (lang.required && statedAny)
      missingRequired.push(lang.languageCode);
  }
  const value = weightTotal === 0 ? 0.5 : weighted / weightTotal;
  const reason = statedAny
    ? `Stated languages cover ${found.length} of ${vacancyLanguages.length} required/preferred language(s).`
    : 'The candidate has not stated languages; neutral credit.';
  return {
    dimension: dimension('languageFit', value, reason),
    missingRequired,
  };
}

// --- assembly ----------------------------------------------------------------

export interface DimensionsResult {
  dimensions: MatchDimension[];
  missingRequiredLanguages: string[];
}

export function buildDimensions(
  input: DimensionInputs,
  matchedSkills: readonly string[],
): DimensionsResult {
  const must = input.matrix.filter((r) => r.priority === 'MUST_HAVE');
  const nice = input.matrix.filter((r) => r.priority === 'NICE_TO_HAVE');
  const languages = languageFit(
    input.vacancyLanguages,
    input.profile.languages,
  );

  const dimensions = [
    requirementDimension('mustHaveSkills', must),
    experienceDepth(input, matchedSkills),
    roleSimilarity(input),
    seniorityFit(input),
    projectEvidence(input),
    locationWorkMode(input),
    languages.dimension,
    requirementDimension('niceToHave', nice),
  ].filter((d): d is MatchDimension => d !== null);

  return { dimensions, missingRequiredLanguages: languages.missingRequired };
}

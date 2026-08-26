/**
 * THE advanced-match engine entry point. Both presentation contexts — the
 * candidate's Internal AI Job Match and the HR vacancy-context assessment
 * (including Compare) — build their insight through this one function, so
 * there is exactly one algorithm. The only contextual differences are
 * declared inputs: HR passes no intent and no alignments (candidate
 * preferences are private to the candidate), and passes the vacancy status
 * so a non-open vacancy reads BLOCKED.
 *
 * Everything in the result is deterministic. Gemini is never consulted here.
 */

import type { SeniorityLevel } from '../../generated/prisma/enums';
import type {
  AiJobMatch,
  AiRequirementInsight,
} from '../../ai/ai-service.client';
import type { IntentAlignment } from '../intent-alignment';
import type { CandidateJobIntent } from '../../candidate-preferences/candidate-job-intent';
import {
  ADVANCED_MATCH_VERSION,
  type MatchEvidenceRef,
  type MatchInsight,
} from './advanced-match.types';
import { buildCareerTrajectory } from './career-trajectory';
import { detectContradictions } from './contradictions';
import { buildDimensions, type VacancyLanguageFact } from './dimensions';
import { computeEvidenceConfidence } from './evidence-confidence';
import { buildImprovementSuggestions } from './improvement-suggestions';
import type { ProfileFacts } from './profile-facts';
import { evaluateEligibility } from './eligibility';
import {
  buildRequirementMatrix,
  matrixFromChecks,
  summarizeMatrix,
  toEvidenceRef,
  type MatrixSummary,
} from './requirement-matrix';
import { buildScoreChange, type PreviousEntryMeta } from './score-change';
import {
  containsSkillTerm,
  findTransferableHits,
  toTransferableMatches,
} from './transferable-skills';

export interface BuildInsightInput {
  context: 'CANDIDATE' | 'HR';
  match: AiJobMatch;
  /** Canonical (ranking) score for this pair — scoreChange compares THIS. */
  canonicalScore: number;
  vacancyTitle: string;
  vacancySeniority: SeniorityLevel | null;
  vacancyLanguages: readonly VacancyLanguageFact[];
  /** HR context: current vacancy status; undefined in candidate context. */
  vacancyStatus?: string;
  /** Candidate context only; [] otherwise. */
  alignments: readonly IntentAlignment[];
  intent: CandidateJobIntent | null;
  profile: ProfileFacts;
  /** Run-level capability summary from ai-service. */
  capabilitySkills: readonly string[];
  evidenceSourceCount: number;
  evidenceChars: number;
  previous: PreviousEntryMeta | null;
  currentYear: number;
}

function insightsOf(match: AiJobMatch): AiRequirementInsight[] {
  if (match.requirementInsights && match.requirementInsights.length > 0) {
    return match.requirementInsights;
  }
  return [];
}

export function buildMatchInsight(input: BuildInsightInput): MatchInsight {
  const { match } = input;

  // Transferable coverage: candidate's evidenced skills vs the technologies
  // this vacancy names that the evidence does not show.
  const transferableHits = findTransferableHits(
    input.capabilitySkills,
    match.missingSkills ?? [],
  );

  // Requirement matrix — from the per-requirement insight rows when the
  // ai-service provides them, else the frozen check arrays (no depth data).
  const aiInsights = insightsOf(match);
  const matrix =
    aiInsights.length > 0
      ? buildRequirementMatrix(aiInsights, transferableHits)
      : matrixFromChecks(
          match.supportedRequirements ?? [],
          match.unsupportedRequirements ?? [],
          match.unclearRequirements ?? [],
          transferableHits,
        );
  const matrixSummary = summarizeMatrix(matrix);

  // Distinct current sources across the whole match (anti-stuffing measure).
  const distinctSources = new Set<string>();
  for (const row of aiInsights) {
    for (const item of row.evidence) {
      if (item.documentId && item.documentId !== 'profile') {
        distinctSources.add(item.documentId);
      }
    }
  }

  const evidenceTexts = (match.evidence ?? []).map((e) => e.text);

  const { dimensions, missingRequiredLanguages } = buildDimensions(
    {
      context: input.context,
      matrix,
      signals: match.signals ?? {},
      vacancyTitle: input.vacancyTitle,
      vacancySeniority: input.vacancySeniority,
      vacancyLanguages: input.vacancyLanguages,
      alignments: input.alignments,
      intent: input.intent,
      profile: input.profile,
      distinctEvidenceSources: distinctSources.size,
      evidenceTexts,
      currentYear: input.currentYear,
    },
    match.matchedSkills ?? [],
  );

  const eligibility = evaluateEligibilityFor(
    input,
    matrixSummary,
    missingRequiredLanguages,
  );

  const contradictions = detectContradictions(input.profile);

  const confidence = computeEvidenceConfidence({
    evidenceSourceCount: input.evidenceSourceCount,
    evidenceChars: input.evidenceChars,
    matrix,
    profile: input.profile,
    contradictions,
  });

  const transferableSkills = toTransferableMatches(
    transferableHits,
    (targetSkill) =>
      matrix.find((row) => containsSkillTerm(row.text, targetSkill))?.text ??
      null,
    (sourceSkill) => evidenceMentioning(aiInsights, sourceSkill),
  );

  return {
    version: ADVANCED_MATCH_VERSION,
    context: input.context,
    eligibility: eligibility.eligibility,
    eligibilityReasons: eligibility.reasons,
    evidenceConfidence: confidence.evidenceConfidence,
    evidenceConfidenceBreakdown: confidence.breakdown,
    dimensions,
    requirementMatrix: matrix,
    transferableSkills,
    contradictions,
    careerTrajectory: buildCareerTrajectory(input.profile, input.vacancyTitle),
    scoreChange: buildScoreChange(input.previous, input.canonicalScore, matrix),
    improvementSuggestions: buildImprovementSuggestions(
      matrix,
      missingRequiredLanguages,
      distinctSources.size,
    ),
  };
}

function evaluateEligibilityFor(
  input: BuildInsightInput,
  matrixSummary: MatrixSummary,
  missingRequiredLanguages: string[],
) {
  return evaluateEligibility({
    context: input.context,
    matrix: matrixSummary,
    alignments: input.alignments,
    relocation: input.intent?.relocation ?? null,
    missingRequiredLanguages,
    vacancyStatus: input.vacancyStatus,
  });
}

/** Evidence refs (≤2) from requirement rows whose passages mention a skill. */
function evidenceMentioning(
  insights: readonly AiRequirementInsight[],
  skill: string,
): MatchEvidenceRef[] {
  const refs: MatchEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const row of insights) {
    for (const item of row.evidence) {
      if (refs.length >= 2) return refs;
      const key = `${item.documentId}:${item.section ?? ''}:${item.text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      if (containsSkillTerm(item.text, skill)) {
        seen.add(key);
        refs.push(toEvidenceRef(item));
      }
    }
  }
  return refs;
}

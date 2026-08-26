/**
 * Requirement-by-requirement matrix: one typed row per stated vacancy
 * requirement, unifying (not replacing) the frozen supported/unsupported/
 * unclear arrays.
 *
 * Status ladder, decided from the ai-service classification plus source depth:
 *
 *   EVIDENCE_FOUND + ≥2 distinct sources → STRONG
 *   EVIDENCE_FOUND                       → MATCH
 *   NEEDS_HUMAN_REVIEW                   → PARTIAL
 *   NO_EVIDENCE_FOUND + transferable     → PARTIAL (labelled TRANSFERABLE)
 *   NO_EVIDENCE_FOUND                    → MISSING ("no current evidence
 *                                          found" — never "cannot do this")
 *
 * The `required` boolean on JobRequirement is the existing priority model:
 * true → MUST_HAVE, false → NICE_TO_HAVE.
 */

import type {
  AiRequirementCheck,
  AiRequirementInsight,
  AiRequirementInsightEvidence,
} from '../../ai/ai-service.client';
import {
  MATRIX_CREDITS,
  type MatchEvidenceRef,
  type RequirementMatrixRow,
} from './advanced-match.types';
import { containsSkillTerm, type TransferableHit } from './transferable-skills';

export function toEvidenceRef(
  item: AiRequirementInsightEvidence,
): MatchEvidenceRef {
  const kind =
    item.documentId === 'profile'
      ? 'PROFILE'
      : item.sourceType === 'URL'
        ? 'URL'
        : 'FILE';
  return {
    sourceKind: kind,
    fileName: item.fileName ?? null,
    pageNumber: item.pageNumber ?? null,
    section: item.section ?? null,
    snippet: item.text,
    sourceUrl: item.sourceUrl ?? null,
  };
}

function transferFor(
  row: { text: string; missingTerms: string[] },
  hits: readonly TransferableHit[],
): TransferableHit | null {
  const lowered = row.text.toLowerCase();
  const missing = new Set(row.missingTerms.map((t) => t.toLowerCase()));
  for (const hit of hits) {
    if (
      missing.has(hit.targetSkill) ||
      containsSkillTerm(lowered, hit.targetSkill)
    ) {
      return hit;
    }
  }
  return null;
}

export function buildRequirementMatrix(
  insights: readonly AiRequirementInsight[],
  transferableHits: readonly TransferableHit[],
): RequirementMatrixRow[] {
  return insights.map((insight) => {
    let status: RequirementMatrixRow['status'];
    let transferable: RequirementMatrixRow['transferable'] = null;
    let reason = insight.reason;

    if (insight.status === 'EVIDENCE_FOUND') {
      status = insight.distinctEvidenceSources >= 2 ? 'STRONG' : 'MATCH';
    } else if (insight.status === 'NEEDS_HUMAN_REVIEW') {
      status = 'PARTIAL';
    } else {
      const transfer = transferFor(insight, transferableHits);
      if (transfer) {
        status = 'PARTIAL';
        transferable = {
          sourceSkill: transfer.sourceSkill,
          relation: transfer.relation,
        };
        reason =
          `No current evidence of ${transfer.targetSkill}; related ` +
          `${transfer.label} evidence (${transfer.sourceSkill}) gives ` +
          `partial credit only.`;
      } else {
        status = 'MISSING';
        reason = `No current evidence found. ${insight.reason}`.trim();
      }
    }

    const credit = transferable
      ? MATRIX_CREDITS.TRANSFERABLE
      : MATRIX_CREDITS[status];

    return {
      requirementId: null,
      text: insight.text,
      priority: insight.required ? 'MUST_HAVE' : 'NICE_TO_HAVE',
      status,
      scoreContribution: credit,
      evidenceCount: insight.distinctEvidenceSources,
      evidenceRefs: insight.evidence.map(toEvidenceRef),
      transferable,
      reason,
    } satisfies RequirementMatrixRow;
  });
}

/**
 * Fallback for responses from an ai-service that predates
 * `requirementInsights`: the three frozen arrays still carry text/required/
 * reason, so the matrix keeps working with no depth data (no STRONG, no
 * per-row evidence). Removed once every environment runs the new service.
 */
export function matrixFromChecks(
  supported: readonly AiRequirementCheck[],
  unsupported: readonly AiRequirementCheck[],
  unclear: readonly AiRequirementCheck[],
  transferableHits: readonly TransferableHit[],
): RequirementMatrixRow[] {
  const insights: AiRequirementInsight[] = [
    ...supported.map((c) => ({ check: c, status: 'EVIDENCE_FOUND' as const })),
    ...unclear.map((c) => ({
      check: c,
      status: 'NEEDS_HUMAN_REVIEW' as const,
    })),
    ...unsupported.map((c) => ({
      check: c,
      status: 'NO_EVIDENCE_FOUND' as const,
    })),
  ].map(({ check, status }) => ({
    text: check.text,
    required: check.required,
    status,
    reason: check.reason,
    matchedTerms: [],
    missingTerms: [],
    distinctEvidenceSources: 0,
    evidence: [],
  }));
  return buildRequirementMatrix(insights, transferableHits);
}

export interface MatrixSummary {
  mustTotal: number;
  /** MUST_HAVE rows that are not MATCH/STRONG (i.e. PARTIAL or MISSING). */
  mustGaps: number;
  mustMissing: number;
}

export function summarizeMatrix(
  rows: readonly RequirementMatrixRow[],
): MatrixSummary {
  const must = rows.filter((r) => r.priority === 'MUST_HAVE');
  return {
    mustTotal: must.length,
    mustGaps: must.filter((r) => r.status !== 'MATCH' && r.status !== 'STRONG')
      .length,
    mustMissing: must.filter((r) => r.status === 'MISSING').length,
  };
}

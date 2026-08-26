/**
 * "What would improve this match?" — deterministic, derived strictly from the
 * current gaps, ranked by how much weight the gap sits under. Never promises
 * a future score; the standing phrasing is "these gaps currently reduce the
 * match most".
 */

import type {
  ImprovementSuggestion,
  RequirementMatrixRow,
} from './advanced-match.types';

const MAX_SUGGESTIONS = 6;

export function buildImprovementSuggestions(
  matrix: readonly RequirementMatrixRow[],
  missingRequiredLanguages: readonly string[],
  distinctEvidenceSources: number,
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  // 1) Missing must-haves: the heaviest weight in the breakdown.
  for (const row of matrix) {
    if (row.priority === 'MUST_HAVE' && row.status === 'MISSING') {
      suggestions.push({
        requirementId: row.requirementId,
        type: 'ADD_MUST_HAVE_EVIDENCE',
        text:
          `No current evidence found for the must-have "${row.text}". ` +
          `Adding a document, project or link that demonstrates it would ` +
          `address the largest current gap.`,
        impactRank: 0,
      });
    }
  }

  // 2) Transferable-covered must-haves: related credit is partial by rule,
  // so DIRECT evidence remains the improvement.
  for (const row of matrix) {
    if (row.priority === 'MUST_HAVE' && row.transferable !== null) {
      suggestions.push({
        requirementId: row.requirementId,
        type: 'ADD_MUST_HAVE_EVIDENCE',
        text:
          `"${row.text}" is currently covered only by related ` +
          `${row.transferable.sourceSkill} evidence (partial credit). ` +
          `Direct evidence would close the remaining gap.`,
        impactRank: 0,
      });
    }
  }

  // 3) Unclear must-haves: a person could not tell either way.
  for (const row of matrix) {
    if (
      row.priority === 'MUST_HAVE' &&
      row.status === 'PARTIAL' &&
      row.transferable === null
    ) {
      suggestions.push({
        requirementId: row.requirementId,
        type: 'CLARIFY_EVIDENCE',
        text:
          `Evidence for "${row.text}" is ambiguous. Making the relevant ` +
          `experience explicit in a document would clarify it.`,
        impactRank: 0,
      });
    }
  }

  // 3) Required languages absent from the stated list.
  for (const code of missingRequiredLanguages) {
    suggestions.push({
      requirementId: null,
      type: 'ADD_LANGUAGE_EVIDENCE',
      text:
        `The required language "${code}" is not among the stated languages. ` +
        `Stating it (if applicable) would close this gap.`,
      impactRank: 0,
    });
  }

  // 4) Single-source corroboration.
  if (distinctEvidenceSources <= 1 && matrix.length > 0) {
    suggestions.push({
      requirementId: null,
      type: 'ADD_INDEPENDENT_SOURCE',
      text:
        'Most support comes from a single source. An independent source ' +
        '(for example a portfolio or repository link) would strengthen the evidence.',
      impactRank: 0,
    });
  }

  // 5) Missing nice-to-haves, after everything heavier.
  for (const row of matrix) {
    if (row.priority === 'NICE_TO_HAVE' && row.status === 'MISSING') {
      suggestions.push({
        requirementId: row.requirementId,
        type: 'ADD_NICE_TO_HAVE_EVIDENCE',
        text: `Optional: evidence for the nice-to-have "${row.text}" is not present.`,
        impactRank: 0,
      });
    }
  }

  return suggestions
    .slice(0, MAX_SUGGESTIONS)
    .map((s, index) => ({ ...s, impactRank: index + 1 }));
}

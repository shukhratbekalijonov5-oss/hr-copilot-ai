import type { AiRequirementInsight } from '../../ai/ai-service.client';
import { MATRIX_CREDITS } from './advanced-match.types';
import {
  buildRequirementMatrix,
  matrixFromChecks,
  summarizeMatrix,
} from './requirement-matrix';
import { findTransferableHits } from './transferable-skills';

function insight(over: Partial<AiRequirementInsight>): AiRequirementInsight {
  return {
    text: 'Kubernetes in production',
    required: true,
    status: 'EVIDENCE_FOUND',
    reason: 'Retrieved evidence mentions kubernetes.',
    matchedTerms: ['kubernetes'],
    missingTerms: [],
    distinctEvidenceSources: 1,
    evidence: [
      {
        documentId: 'doc-1',
        fileName: 'resume.pdf',
        pageNumber: 1,
        section: 'experience',
        text: 'Ran Kubernetes in production',
        sourceType: 'FILE',
        sourceUrl: null,
      },
    ],
    ...over,
  };
}

describe('requirement matrix', () => {
  it('maps the required boolean to MUST_HAVE / NICE_TO_HAVE', () => {
    const rows = buildRequirementMatrix(
      [
        insight({ required: true }),
        insight({ text: 'Korean', required: false }),
      ],
      [],
    );
    expect(rows[0].priority).toBe('MUST_HAVE');
    expect(rows[1].priority).toBe('NICE_TO_HAVE');
  });

  it('EVIDENCE_FOUND with ≥2 independent sources is STRONG, one source is MATCH', () => {
    const strong = buildRequirementMatrix(
      [insight({ distinctEvidenceSources: 2 })],
      [],
    )[0];
    const match = buildRequirementMatrix(
      [insight({ distinctEvidenceSources: 1 })],
      [],
    )[0];
    expect(strong.status).toBe('STRONG');
    expect(strong.scoreContribution).toBe(MATRIX_CREDITS.STRONG);
    expect(match.status).toBe('MATCH');
    expect(match.scoreContribution).toBe(MATRIX_CREDITS.MATCH);
  });

  it('NO_EVIDENCE_FOUND is MISSING with "no current evidence" language — never certainty of absence', () => {
    const row = buildRequirementMatrix(
      [
        insight({
          status: 'NO_EVIDENCE_FOUND',
          matchedTerms: [],
          missingTerms: ['terraform'],
          distinctEvidenceSources: 0,
          evidence: [],
          text: 'Terraform modules',
        }),
      ],
      [],
    )[0];
    expect(row.status).toBe('MISSING');
    expect(row.scoreContribution).toBe(0);
    expect(row.reason).toContain('No current evidence found');
    expect(row.reason.toLowerCase()).not.toContain('cannot');
    expect(row.reason.toLowerCase()).not.toContain('does not know');
  });

  it('a transferable skill turns MISSING into labelled PARTIAL at reduced credit — never MATCH', () => {
    const hits = findTransferableHits(['rabbitmq'], ['kafka']);
    const row = buildRequirementMatrix(
      [
        insight({
          text: 'Kafka streaming experience',
          status: 'NO_EVIDENCE_FOUND',
          matchedTerms: [],
          missingTerms: ['kafka'],
          distinctEvidenceSources: 0,
          evidence: [],
        }),
      ],
      hits,
    )[0];
    expect(row.status).toBe('PARTIAL');
    expect(row.transferable).toEqual({
      sourceSkill: 'rabbitmq',
      relation: 'messaging',
    });
    expect(row.scoreContribution).toBe(MATRIX_CREDITS.TRANSFERABLE);
    expect(row.scoreContribution).toBeLessThan(MATRIX_CREDITS.MATCH);
    expect(row.reason).toContain('partial credit only');
  });

  it('a direct match never carries a transferable label — the two are structurally distinct', () => {
    const hits = findTransferableHits(['rabbitmq'], ['kafka']);
    const row = buildRequirementMatrix([insight({})], hits)[0];
    expect(row.transferable).toBeNull();
  });

  it('NEEDS_HUMAN_REVIEW is PARTIAL without a transferable label', () => {
    const row = buildRequirementMatrix(
      [insight({ status: 'NEEDS_HUMAN_REVIEW' })],
      [],
    )[0];
    expect(row.status).toBe('PARTIAL');
    expect(row.transferable).toBeNull();
    expect(row.scoreContribution).toBe(MATRIX_CREDITS.PARTIAL);
  });

  it('profile pseudo-evidence is marked PROFILE in the refs', () => {
    const row = buildRequirementMatrix(
      [
        insight({
          evidence: [
            {
              documentId: 'profile',
              fileName: 'Profile',
              pageNumber: null,
              section: 'skills',
              text: 'Skills: kubernetes',
              sourceType: 'FILE',
              sourceUrl: null,
            },
          ],
        }),
      ],
      [],
    )[0];
    expect(row.evidenceRefs[0].sourceKind).toBe('PROFILE');
  });

  it('falls back to the frozen check arrays when insights are absent (older ai-service)', () => {
    const rows = matrixFromChecks(
      [{ text: 'Node.js', required: true, reason: 'mentions node' }],
      [
        {
          text: 'Terraform',
          required: true,
          reason: 'no passage mentions terraform',
        },
      ],
      [{ text: 'Korean', required: false, reason: 'unclear' }],
      [],
    );
    const byText = Object.fromEntries(rows.map((r) => [r.text, r]));
    expect(byText['Node.js'].status).toBe('MATCH'); // no depth data → never STRONG
    expect(byText['Terraform'].status).toBe('MISSING');
    expect(byText['Korean'].status).toBe('PARTIAL');
  });

  it('summarizes must-have coverage for the eligibility gate', () => {
    const rows = matrixFromChecks(
      [{ text: 'Node.js', required: true, reason: '' }],
      [{ text: 'Terraform', required: true, reason: '' }],
      [],
      [],
    );
    expect(summarizeMatrix(rows)).toEqual({
      mustTotal: 2,
      mustGaps: 1,
      mustMissing: 1,
    });
  });
});

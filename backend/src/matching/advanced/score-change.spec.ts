import { buildScoreChange, requirementStatusesOf } from './score-change';
import { matrixFromChecks } from './requirement-matrix';
import { findTransferableHits } from './transferable-skills';

describe('score change', () => {
  const currentMatrix = matrixFromChecks(
    [{ text: 'Kubernetes', required: true, reason: '' }], // now evidenced
    [{ text: 'Terraform', required: true, reason: '' }], // still missing
    [],
    [],
  );

  it('null without a previous run — a prior score is never fabricated', () => {
    expect(buildScoreChange(null, 81, currentMatrix)).toBeNull();
  });

  it('reports previous → current with requirement-level reasons', () => {
    const change = buildScoreChange(
      {
        score: 67,
        requirementStatuses: { Kubernetes: 'MISSING', Terraform: 'MISSING' },
      },
      81,
      currentMatrix,
    )!;
    expect(change).toMatchObject({ previous: 67, current: 81, delta: 14 });
    expect(change.reasons).toContain('+ now evidenced: Kubernetes');
    expect(change.reasons).toContain('− still missing: Terraform');
  });

  it('a regression is stated too', () => {
    const regressed = matrixFromChecks(
      [],
      [{ text: 'Kubernetes', required: true, reason: '' }],
      [],
      [],
    );
    const change = buildScoreChange(
      { score: 81, requirementStatuses: { Kubernetes: 'MATCH' } },
      67,
      regressed,
    )!;
    expect(change.delta).toBe(-14);
    expect(change.reasons).toContain('− no longer evidenced: Kubernetes');
  });

  it('identical inputs produce delta 0 with no reasons — refresh is honest', () => {
    const change = buildScoreChange(
      {
        score: 81,
        requirementStatuses: requirementStatusesOf(currentMatrix),
      },
      81,
      currentMatrix,
    )!;
    expect(change.delta).toBe(0);
    // "still missing" only fires for MISSING→MISSING must-haves; the rest is silent.
    expect(change.reasons).toEqual(['− still missing: Terraform']);
  });

  it('a transferable-covered requirement does not count as evidenced in the diff', () => {
    const withTransfer = matrixFromChecks(
      [],
      [{ text: 'Kafka streaming', required: true, reason: '' }],
      [],
      findTransferableHits(['rabbitmq'], ['kafka']),
    );
    const change = buildScoreChange(
      { score: 60, requirementStatuses: { 'Kafka streaming': 'MISSING' } },
      62,
      withTransfer,
    )!;
    expect(change.reasons).not.toContain('+ now evidenced: Kafka streaming');
  });

  it('carries only scores and statuses across a replacement — no evidence content (N1)', () => {
    const statuses = requirementStatusesOf(currentMatrix);
    expect(Object.values(statuses).every((v) => typeof v === 'string')).toBe(
      true,
    );
    expect(JSON.stringify(statuses)).not.toContain('snippet');
  });
});

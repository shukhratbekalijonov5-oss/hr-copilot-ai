import {
  TRANSFERABLE_GROUPS,
  containsSkillTerm,
  findTransferableHits,
  toTransferableMatches,
} from './transferable-skills';
import { MATRIX_CREDITS, TRANSFERABLE_CREDIT } from './advanced-match.types';

describe('transferable skills taxonomy', () => {
  it('is a curated grouped mapping, not string similarity', () => {
    // Pin the group slugs: adding/removing a group is a reviewed decision.
    expect(TRANSFERABLE_GROUPS.map((g) => g.relation).sort()).toEqual([
      'api-style',
      'cloud-platform',
      'containers',
      'cross-platform-mobile',
      'frontend-framework',
      'js-language',
      'js-testing',
      'messaging',
      'native-mobile',
      'node-backend',
      'python-web',
      'sql-database',
    ]);
  });

  it('RabbitMQ evidence gives partial messaging credit toward Kafka', () => {
    const hits = findTransferableHits(['rabbitmq', 'python'], ['kafka']);
    expect(hits).toEqual([
      {
        sourceSkill: 'rabbitmq',
        targetSkill: 'kafka',
        relation: 'messaging',
        label: 'messaging/streaming technologies',
      },
    ]);
  });

  it('Azure evidence gives partial cloud credit toward AWS', () => {
    const hits = findTransferableHits(['azure'], ['aws']);
    expect(hits[0]).toMatchObject({
      sourceSkill: 'azure',
      targetSkill: 'aws',
      relation: 'cloud-platform',
    });
  });

  it('a directly evidenced skill is never its own transfer', () => {
    expect(findTransferableHits(['kafka'], ['kafka'])).toEqual([]);
  });

  it('unrelated skills earn nothing', () => {
    expect(findTransferableHits(['figma'], ['kafka'])).toEqual([]);
  });

  it('transferable credit is strictly below every direct credit', () => {
    expect(TRANSFERABLE_CREDIT).toBeLessThan(MATRIX_CREDITS.MATCH);
    expect(TRANSFERABLE_CREDIT).toBeLessThan(MATRIX_CREDITS.STRONG);
    // and below ambiguous-evidence PARTIAL too: "related" < "maybe direct".
    expect(TRANSFERABLE_CREDIT).toBeLessThan(MATRIX_CREDITS.PARTIAL);
  });

  it('contract objects are labelled, credited below direct, and honest', () => {
    const [match] = toTransferableMatches(
      findTransferableHits(['rabbitmq'], ['kafka']),
      () => 'Experience with Kafka pipelines',
      () => [],
    );
    expect(match.credit).toBe(TRANSFERABLE_CREDIT);
    expect(match.targetRequirement).toBe('Experience with Kafka pipelines');
    expect(match.reason).toContain('partial credit only');
    expect(match.reason).toContain('not evidence of kafka itself');
  });

  it('containsSkillTerm uses word-ish boundaries', () => {
    expect(containsSkillTerm('we use node.js daily', 'node.js')).toBe(true);
    expect(containsSkillTerm('algorithms course', 'go')).toBe(false);
    expect(containsSkillTerm('shipped Go services', 'go')).toBe(true);
  });
});

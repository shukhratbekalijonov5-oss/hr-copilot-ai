/**
 * Transferable-skill taxonomy: controlled partial credit for RELATED (never
 * identical) technologies.
 *
 * This is a curated, maintained mapping — not an LLM equivalence and not
 * string similarity. Every member name is a CANONICAL skill key exactly as
 * the ai-service lexicon emits it (`_SKILL_ALIASES` in
 * ai-service/app/candidate/capability.py), because the inputs here —
 * `matchedSkills`, `missingSkills`, capability skills — are produced by that
 * lexicon. A key that drifts from the lexicon silently stops matching, so the
 * spec test pins the member list.
 *
 * Rules enforced by the shape of this module:
 *  - transfer only WITHIN a group, both directions;
 *  - credit is the constant TRANSFERABLE_CREDIT (0.45) — always below direct
 *    evidence (1.0/0.9) so a related skill can never impersonate a direct one;
 *  - a transferable hit never flips a requirement to MATCH; the matrix keeps
 *    it PARTIAL and labels the transfer explicitly.
 *
 * Notably absent on purpose: cross-database document/relational transfers,
 * programming-language equivalences beyond JS↔TS, and anything where "related"
 * would overstate (e.g. Redis is not a message broker here).
 */

import {
  TRANSFERABLE_CREDIT,
  type MatchEvidenceRef,
  type TransferableSkillMatch,
} from './advanced-match.types';

export interface TransferableGroup {
  /** Slug used as `relation` in the contract. */
  relation: string;
  /** Human phrase used to build the reason sentence. */
  label: string;
  /** Canonical lexicon keys. */
  members: readonly string[];
}

export const TRANSFERABLE_GROUPS: readonly TransferableGroup[] = [
  {
    relation: 'messaging',
    label: 'messaging/streaming technologies',
    members: ['kafka', 'rabbitmq'],
  },
  {
    relation: 'cloud-platform',
    label: 'cloud platforms',
    members: ['aws', 'gcp', 'azure'],
  },
  {
    relation: 'containers',
    label: 'container technologies',
    members: ['kubernetes', 'docker'],
  },
  {
    relation: 'frontend-framework',
    label: 'component-based frontend frameworks',
    members: ['react', 'vue', 'angular', 'svelte'],
  },
  {
    relation: 'node-backend',
    label: 'Node.js backend frameworks',
    members: ['express', 'nestjs'],
  },
  {
    relation: 'python-web',
    label: 'Python web frameworks',
    members: ['django', 'flask', 'fastapi'],
  },
  {
    relation: 'sql-database',
    label: 'relational SQL databases',
    members: ['postgresql', 'mysql', 'sqlite', 'sql'],
  },
  {
    relation: 'js-language',
    label: 'JavaScript-family languages',
    members: ['javascript', 'typescript'],
  },
  {
    relation: 'cross-platform-mobile',
    label: 'cross-platform mobile frameworks',
    members: ['react native', 'flutter'],
  },
  {
    relation: 'native-mobile',
    label: 'native mobile development stacks',
    members: ['android', 'ios', 'swift', 'kotlin'],
  },
  {
    relation: 'js-testing',
    label: 'JavaScript testing tools',
    members: ['jest', 'cypress'],
  },
  {
    relation: 'api-style',
    label: 'API technologies',
    members: ['graphql', 'rest', 'grpc'],
  },
] as const;

const GROUP_BY_MEMBER = new Map<string, TransferableGroup>();
for (const group of TRANSFERABLE_GROUPS) {
  for (const member of group.members) GROUP_BY_MEMBER.set(member, group);
}

/**
 * One transferable finding: the candidate has `sourceSkill`, the vacancy
 * misses `targetSkill`, and both live in the same curated group.
 */
export interface TransferableHit {
  sourceSkill: string;
  targetSkill: string;
  relation: string;
  label: string;
}

/**
 * Related coverage for every missing vacancy skill the candidate can
 * partially answer. Deterministic: sorted by (targetSkill, sourceSkill);
 * a skill the candidate has DIRECT evidence for is never its own transfer.
 */
export function findTransferableHits(
  candidateSkills: readonly string[],
  missingSkills: readonly string[],
): TransferableHit[] {
  const have = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const hits: TransferableHit[] = [];
  for (const target of [...missingSkills].sort()) {
    const key = target.toLowerCase();
    if (have.has(key)) continue; // direct evidence exists; not a transfer
    const group = GROUP_BY_MEMBER.get(key);
    if (!group) continue;
    const sources = group.members
      .filter((member) => member !== key && have.has(member))
      .sort();
    // One transfer per target: the strongest claim is one related skill,
    // not a pile — listing three siblings would inflate perceived coverage.
    if (sources.length > 0) {
      hits.push({
        sourceSkill: sources[0],
        targetSkill: key,
        relation: group.relation,
        label: group.label,
      });
    }
  }
  return hits;
}

/** Contract objects for the response, with the standard reason wording. */
export function toTransferableMatches(
  hits: readonly TransferableHit[],
  targetRequirementFor: (targetSkill: string) => string | null,
  evidenceFor: (sourceSkill: string) => MatchEvidenceRef[],
): TransferableSkillMatch[] {
  return hits.map((hit) => ({
    sourceSkill: hit.sourceSkill,
    targetRequirement: targetRequirementFor(hit.targetSkill) ?? hit.targetSkill,
    targetSkill: hit.targetSkill,
    credit: TRANSFERABLE_CREDIT,
    relation: hit.relation,
    reason:
      `${hit.sourceSkill} and ${hit.targetSkill} are related ${hit.label}; ` +
      `partial credit only — not evidence of ${hit.targetSkill} itself.`,
    evidenceRefs: evidenceFor(hit.sourceSkill),
  }));
}

/**
 * Word-boundary-ish containment mirroring the ai-service `_contains`, so
 * "go" never matches inside "algorithm" while "node.js" and "c++" still hit.
 */
export function containsSkillTerm(corpus: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i').test(corpus);
}

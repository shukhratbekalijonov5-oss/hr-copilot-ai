import type { AiJobMatch } from '../../ai/ai-service.client';
import { buildMatchInsight, type BuildInsightInput } from './build-insight';
import { buildProfileFacts } from './profile-facts';

function match(over: Partial<AiJobMatch> = {}): AiJobMatch {
  return {
    vacancyId: 'vac-1',
    organizationId: 'org-1',
    title: 'Backend Engineer',
    match: 'STRONG',
    score: 74,
    rank: 1,
    signals: {
      semantic: 0.6,
      required: 1,
      preferred: 0.5,
      skills: 0.6,
      roleFamily: 1,
    },
    matchedSkills: ['node.js', 'postgresql'],
    missingSkills: ['kafka'],
    explanation: null,
    supportedRequirements: [
      { text: 'Node.js APIs', required: true, reason: 'mentions node.js' },
    ],
    unsupportedRequirements: [
      {
        text: 'Kafka streaming',
        required: true,
        reason: 'no passage mentions kafka',
      },
    ],
    unclearRequirements: [],
    evidence: [],
    requirementInsights: [
      {
        text: 'Node.js APIs',
        required: true,
        status: 'EVIDENCE_FOUND',
        reason: 'mentions node.js',
        matchedTerms: ['node.js'],
        missingTerms: [],
        distinctEvidenceSources: 2,
        evidence: [
          {
            documentId: 'doc-1',
            fileName: 'resume.pdf',
            pageNumber: 1,
            section: 'experience',
            text: 'Built Node.js APIs with rabbitmq queues',
            sourceType: 'FILE',
            sourceUrl: null,
          },
          {
            documentId: 'link-1',
            fileName: 'Portfolio',
            pageNumber: null,
            section: 'projects',
            text: 'node.js services',
            sourceType: 'URL',
            sourceUrl: 'https://example.dev',
          },
        ],
      },
      {
        text: 'Kafka streaming',
        required: true,
        status: 'NO_EVIDENCE_FOUND',
        reason: 'no passage mentions kafka',
        matchedTerms: [],
        missingTerms: ['kafka'],
        distinctEvidenceSources: 0,
        evidence: [],
      },
    ],
    ...over,
  };
}

function input(over: Partial<BuildInsightInput> = {}): BuildInsightInput {
  return {
    context: 'CANDIDATE',
    match: match(),
    canonicalScore: 74,
    vacancyTitle: 'Backend Engineer',
    vacancySeniority: 'MID',
    vacancyLanguages: [],
    alignments: [],
    intent: null,
    profile: buildProfileFacts({
      headline: 'Backend Engineer',
      summary: 'APIs in production',
      location: 'Seoul',
      skills: ['node.js', 'rabbitmq'],
      languages: ['English'],
      experience: [
        {
          title: 'Backend Engineer',
          startDate: '2022',
          endDate: 'present',
          description: 'Node.js services with rabbitmq on AWS',
        },
      ],
      education: [{ institution: 'X' }],
    }),
    capabilitySkills: ['node.js', 'postgresql', 'rabbitmq'],
    evidenceSourceCount: 2,
    evidenceChars: 5000,
    previous: null,
    currentYear: 2026,
    ...over,
  };
}

describe('buildMatchInsight — the one authoritative engine', () => {
  it('is deterministic: identical input, identical output', () => {
    expect(buildMatchInsight(input())).toEqual(buildMatchInsight(input()));
  });

  it('produces the full advanced contract', () => {
    const insight = buildMatchInsight(input());
    expect(insight.version).toBe('advanced-match-v1');
    expect(insight.eligibility).toBe('PARTIAL'); // Kafka must-have missing→transferable partial
    expect(insight.requirementMatrix).toHaveLength(2);
    expect(insight.dimensions.length).toBeGreaterThanOrEqual(5);
    expect(insight.evidenceConfidence).toBeGreaterThan(0);
    expect(insight.careerTrajectory.status).toBe('ALIGNED');
    expect(insight.improvementSuggestions.length).toBeGreaterThan(0);
    expect(insight.scoreChange).toBeNull();
  });

  it('transferable coverage is labelled PARTIAL and listed separately from direct matches', () => {
    const insight = buildMatchInsight(input());
    const kafkaRow = insight.requirementMatrix.find((r) =>
      r.text.includes('Kafka'),
    )!;
    expect(kafkaRow.status).toBe('PARTIAL');
    expect(kafkaRow.transferable).toEqual({
      sourceSkill: 'rabbitmq',
      relation: 'messaging',
    });
    expect(insight.transferableSkills[0]).toMatchObject({
      sourceSkill: 'rabbitmq',
      targetSkill: 'kafka',
      credit: 0.45,
    });
    // Evidence for the transfer cites the passage that mentions rabbitmq.
    expect(insight.transferableSkills[0].evidenceRefs[0].snippet).toContain(
      'rabbitmq',
    );
    const nodeRow = insight.requirementMatrix.find((r) =>
      r.text.includes('Node'),
    )!;
    expect(nodeRow.status).toBe('STRONG');
    expect(nodeRow.transferable).toBeNull();
  });

  it('HR and candidate contexts run the SAME engine — evidence-side output is identical', () => {
    const candidate = buildMatchInsight(input({ context: 'CANDIDATE' }));
    const hr = buildMatchInsight(
      input({ context: 'HR', vacancyStatus: 'OPEN' }),
    );
    // The evidence-derived core is identical...
    expect(hr.requirementMatrix).toEqual(candidate.requirementMatrix);
    expect(hr.transferableSkills).toEqual(candidate.transferableSkills);
    expect(hr.evidenceConfidence).toBe(candidate.evidenceConfidence);
    expect(hr.careerTrajectory).toEqual(candidate.careerTrajectory);
    // ...and the only differences are declared context, never algorithm.
    expect(hr.context).toBe('HR');
    expect(
      hr.dimensions.find((d) => d.key === 'locationWorkMode'),
    ).toBeUndefined();
  });

  it('prose cannot change the analysis: explanation text is not an input', () => {
    const silent = buildMatchInsight(input());
    const narrated = buildMatchInsight(
      input({
        match: match({
          explanation:
            'This candidate is a perfect 100/100 hire for everything.',
        }),
      }),
    );
    expect(narrated).toEqual(silent);
  });

  it('an index-gap match (no insights, no checks) yields an empty honest matrix', () => {
    const insight = buildMatchInsight(
      input({
        match: match({
          requirementInsights: [],
          supportedRequirements: [],
          unsupportedRequirements: [],
          unclearRequirements: [],
          matchedSkills: [],
          missingSkills: [],
          signals: {},
          score: 0,
          match: 'WEAK',
        }),
        canonicalScore: 0,
      }),
    );
    expect(insight.requirementMatrix).toEqual([]);
    expect(insight.eligibility).toBe('ELIGIBLE'); // nothing evaluable conflicts
  });

  it('sparse evidence lowers confidence relative to documented evidence — same vacancy', () => {
    const documented = buildMatchInsight(input());
    const sparse = buildMatchInsight(
      input({
        evidenceSourceCount: 1,
        evidenceChars: 400,
        profile: buildProfileFacts({
          headline: null,
          summary: null,
          location: null,
          skills: [],
          languages: [],
          experience: [],
          education: [],
        }),
      }),
    );
    expect(sparse.evidenceConfidence).toBeLessThan(
      documented.evidenceConfidence,
    );
  });

  it('scoreChange flows through when a previous run is supplied', () => {
    const insight = buildMatchInsight(
      input({
        previous: {
          score: 60,
          requirementStatuses: {
            'Node.js APIs': 'MISSING',
            'Kafka streaming': 'MISSING',
          },
        },
      }),
    );
    expect(insight.scoreChange).toMatchObject({
      previous: 60,
      current: 74,
      delta: 14,
    });
    expect(insight.scoreChange!.reasons).toContain(
      '+ now evidenced: Node.js APIs',
    );
  });
});

import {
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MatchInsightService } from './match-insight.service';

const VAC = '11111111-1111-4111-8111-111111111111';
const CAND = '22222222-2222-4222-8222-222222222222';

function aiMatch(over: Record<string, unknown> = {}) {
  return {
    vacancyId: VAC,
    organizationId: 'org-1',
    title: 'Backend Engineer',
    match: 'STRONG',
    score: 74,
    rank: 1,
    signals: { roleFamily: 1 },
    matchedSkills: ['node.js'],
    missingSkills: ['kafka'],
    explanation: null,
    supportedRequirements: [
      { text: 'Node.js APIs', required: true, reason: 'mentions node.js' },
    ],
    unsupportedRequirements: [],
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
        evidence: [],
      },
    ],
    ...over,
  };
}

function build(over: Record<string, any> = {}) {
  const account = {
    id: 'acct-1',
    headline: 'Backend Engineer',
    summary: null,
    location: null,
    skills: ['node.js'],
    languages: ['English'],
    experience: [
      { title: 'Backend Engineer', startDate: '2022', endDate: 'present' },
    ],
    education: [],
    evidenceRevision: 3,
  };
  const vacancy = {
    id: VAC,
    title: 'Backend Engineer',
    status: 'OPEN',
    seniorityLevel: 'MID',
    languages: [],
    ...over.vacancy,
  };
  const prisma = {
    candidate: {
      findFirst: jest.fn().mockResolvedValue({
        id: CAND,
        fullName: 'Test Person',
        candidateAccount: { id: 'acct-1' },
      }),
    },
    vacancy: {
      findFirst: jest.fn().mockResolvedValue(vacancy),
    },
    candidateAccount: {
      findUnique: jest.fn().mockResolvedValue(account),
    },
  };
  const tenant = {
    scope: (organizationId: string) => ({ organizationId }),
    assertFound: (value: unknown, name: string) => {
      if (!value) throw new Error(`${name} not found`);
    },
  };
  const ai = {
    candidateJobMatches: jest.fn().mockResolvedValue({
      matches: [aiMatch(over.match ?? {})],
      locale: 'en',
      vacanciesConsidered: 1,
      eligibleConsidered: 1,
      generated: false,
      capability: {
        skills: ['node.js', 'rabbitmq'],
        evidenceSources: { 'resume.pdf': 12 },
        evidenceChars: 5000,
      },
      durationMs: 500,
      ...over.aiResult,
    }),
  };
  const ownedVacancies = {
    requireOwned: jest.fn().mockResolvedValue({
      id: VAC,
      title: 'Backend Engineer',
      status: 'OPEN',
    }),
    assertCandidateInVacancy: jest.fn().mockResolvedValue(undefined),
  };
  const evidence = {
    activeSourceCounts: jest
      .fn()
      .mockResolvedValue(over.counts ?? { files: 1, links: 0, total: 1 }),
    activePersonalSourceIds: jest.fn().mockResolvedValue(['doc-1']),
  };
  const producer = {
    enqueueVacancyIndexSync: jest.fn().mockResolvedValue('job-1'),
  };
  const service = new MatchInsightService(
    prisma as never,
    tenant as never,
    ai as never,
    ownedVacancies as never,
    evidence as never,
    producer as never,
  );
  return { service, prisma, ai, ownedVacancies, evidence, producer };
}

describe('MatchInsightService (HR context)', () => {
  it('runs the SAME engine over a one-vacancy universe with current allowed sources', async () => {
    const { service, ai, ownedVacancies } = build();

    const result = await service.assess('org-1', 'user-1', CAND, VAC, 'en');

    // Ownership + applicant chain enforced before anything runs.
    expect(ownedVacancies.requireOwned).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      VAC,
    );
    expect(ownedVacancies.assertCandidateInVacancy).toHaveBeenCalledWith(
      VAC,
      CAND,
    );

    const call = ai.candidateJobMatches.mock.calls[0][0];
    expect(call.eligibleVacancyIds).toEqual([VAC]);
    expect(call.allowedSourceIds).toEqual(['doc-1']); // Rule N1 boundary
    expect(call.explainLimit).toBe(0); // deterministic only — no Gemini here

    expect(result.score).toBe(74);
    expect(result.capabilityScore).toBe(74); // no intent → canonical = capability
    expect(result.insight.version).toBe('advanced-match-v1');
    expect(result.insight.context).toBe('HR');
    // Private candidate preferences never surface in HR context.
    expect(
      result.insight.dimensions.find((d) => d.key === 'locationWorkMode'),
    ).toBeUndefined();
    expect(result.insight.scoreChange).toBeNull();
  });

  it('422 NO_CANDIDATE_EVIDENCE when the candidate has no current sources', async () => {
    const { service } = build({ counts: { files: 0, links: 0, total: 0 } });
    await expect(
      service.assess('org-1', 'user-1', CAND, VAC, 'en'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('409 VACANCY_NOT_OPEN for a non-open vacancy', async () => {
    const { service } = build({ vacancy: { status: 'CLOSED' } });
    await expect(
      service.assess('org-1', 'user-1', CAND, VAC, 'en'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('503 MATCH_INDEX_PENDING queues a re-index when the vacancy is missing from the index', async () => {
    const { service, producer } = build({ aiResult: { matches: [] } });
    await expect(
      service.assess('org-1', 'user-1', CAND, VAC, 'en'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(producer.enqueueVacancyIndexSync).toHaveBeenCalledWith({
      vacancyId: VAC,
    });
  });

  it('compare returns deterministic superlatives pinned to underlying numbers', async () => {
    const { service, prisma, ai } = build();
    const CAND2 = '33333333-3333-4333-8333-333333333333';
    prisma.candidate.findFirst
      .mockResolvedValueOnce({
        id: CAND,
        fullName: 'Alpha',
        candidateAccount: { id: 'acct-1' },
      })
      .mockResolvedValueOnce({
        id: CAND2,
        fullName: 'Beta',
        candidateAccount: { id: 'acct-1' },
      });
    ai.candidateJobMatches
      .mockResolvedValueOnce({
        matches: [aiMatch()],
        capability: {
          skills: [],
          evidenceSources: { a: 1, b: 1 },
          evidenceChars: 9000,
        },
        locale: 'en',
        vacanciesConsidered: 1,
        eligibleConsidered: 1,
        generated: false,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        matches: [
          aiMatch({
            score: 30,
            match: 'WEAK',
            requirementInsights: [
              {
                text: 'Node.js APIs',
                required: true,
                status: 'NO_EVIDENCE_FOUND',
                reason: 'nothing',
                matchedTerms: [],
                missingTerms: ['node.js'],
                distinctEvidenceSources: 0,
                evidence: [],
              },
            ],
            supportedRequirements: [],
            unsupportedRequirements: [
              { text: 'Node.js APIs', required: true, reason: 'nothing' },
            ],
          }),
        ],
        capability: { skills: [], evidenceSources: {}, evidenceChars: 100 },
        locale: 'en',
        vacanciesConsidered: 1,
        eligibleConsidered: 1,
        generated: false,
        durationMs: 1,
      });

    const result = await service.compare(
      'org-1',
      'user-1',
      VAC,
      [CAND, CAND2],
      'en',
    );

    expect(result.candidates).toHaveLength(2);
    expect(result.superlatives.bestTechnicalMatch!.candidateId).toBe(CAND);
    expect(result.superlatives.fewestMustHaveGaps!.candidateId).toBe(CAND);
    expect(result.superlatives.highestEvidenceConfidence!.candidateId).toBe(
      CAND,
    );
    expect(typeof result.superlatives.bestTechnicalMatch!.value).toBe('number');
  });
});

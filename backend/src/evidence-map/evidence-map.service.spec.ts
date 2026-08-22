import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EvidenceMapService } from './evidence-map.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { AiServiceDisabledError } from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CAND = 'cand-1';
/** The account behind CAND — where the mapped evidence actually lives. */
const ACCOUNT = 'acct-1';
const VAC = 'vac-1';
/** The vacancy creator; every call in this spec runs as them by default. */
const HR_A = 'user-a';
const HR_B = 'user-b';

const REQUIREMENTS = [
  { id: 'r-nest', text: 'NestJS', type: 'SKILL', required: true },
  {
    id: 'r-aws',
    text: 'AWS production experience',
    type: 'SKILL',
    required: true,
  },
];

function aiMapping() {
  return {
    candidateId: CAND,
    vacancyId: VAC,
    durationMs: 10,
    requirements: [
      {
        requirementId: 'r-nest',
        requirementText: 'NestJS',
        status: 'EVIDENCE_FOUND' as const,
        matchedTerms: ['nestjs'],
        missingTerms: [],
        reason: 'Retrieved evidence mentions nestjs.',
        evidence: [
          {
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            fileName: 'cv.pdf',
            pageNumber: 1,
            section: 'experience',
            text: 'Built the platform using NestJS',
          },
        ],
      },
      {
        requirementId: 'r-aws',
        requirementText: 'AWS production experience',
        status: 'NO_EVIDENCE_FOUND' as const,
        matchedTerms: [],
        missingTerms: ['aws'],
        reason: 'No retrieved passage mentions aws.',
        evidence: [],
      },
    ],
  };
}

describe('EvidenceMapService', () => {
  let prisma: any;
  let ai: any;
  let service: EvidenceMapService;
  let evidence: ReturnType<typeof evidenceLifecycleMock>;
  let createMany: jest.Mock;
  let deleteMany: jest.Mock;
  let upsert: jest.Mock;
  /**
   * The citation-resolution lookups inside the transaction. A citation names a
   * SOURCE, which is either the candidate's personal file or their
   * professional link — one key space, so both tables are consulted to find
   * out which kind an id is.
   */
  let txDocumentFindMany: jest.Mock;
  let txCandidateLinkFindMany: jest.Mock;

  beforeEach(() => {
    createMany = jest.fn();
    deleteMany = jest.fn();
    upsert = jest.fn(({ create }: any) =>
      Promise.resolve({ id: `map-${create?.requirementId ?? 'x'}` }),
    );
    txDocumentFindMany = jest.fn().mockResolvedValue([{ id: 'doc-1' }]);
    txCandidateLinkFindMany = jest.fn().mockResolvedValue([]);

    prisma = {
      candidate: {
        findFirst: jest.fn().mockResolvedValue({
          id: CAND,
          fullName: 'Ji-woo Han',
          candidateAccount: { id: ACCOUNT },
        }),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: VAC,
          title: 'Backend Engineer',
          status: 'OPEN',
          createdById: HR_A,
          requirements: REQUIREMENTS,
        }),
      },
      application: {
        // The candidate HAS applied to the vacancy by default (the applicant
        // association is what every candidate-in-vacancy AI path requires).
        findFirst: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
      },
      requirementEvidenceMap: {
        upsert,
        findMany: jest.fn().mockResolvedValue([]),
      },
      candidateEvidence: { deleteMany, createMany },
      $transaction: jest.fn((fn: any) =>
        fn({
          requirementEvidenceMap: { upsert },
          candidateEvidence: { deleteMany, createMany },
          document: { findMany: txDocumentFindMany },
          candidateLink: { findMany: txCandidateLinkFindMany },
        }),
      ),
    };
    ai = { mapEvidence: jest.fn().mockResolvedValue(aiMapping()) };
    evidence = evidenceLifecycleMock();
    service = new EvidenceMapService(
      prisma,
      new TenantService(),
      ai,
      new OwnedVacancyService(prisma),
      evidence as never,
    );
  });

  /**
   * Isolation, restated for the account-scoped world.
   *
   * Mapping used to retrieve from an org-owned copy of the candidate's
   * evidence, so `organizationId` was the filter that kept tenants apart.
   * There are no copies now: retrieval addresses the candidate's own account,
   * resolved through the authorization chain (owned vacancy -> applicant of
   * that vacancy -> live account). The organization still owns the RESULT — a
   * mapping is a recruiter's work product — so it keeps stamping the stored
   * rows.
   */
  describe('tenant isolation', () => {
    it('retrieves against the candidate ACCOUNT resolved from auth, not the payload', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      const payload = ai.mapEvidence.mock.calls[0][0];
      expect(payload.candidateAccountId).toBe(ACCOUNT);
      // Nothing org-shaped travels to the AI service: the org-owned corpus it
      // used to select no longer exists.
      expect(payload).not.toHaveProperty('organizationId');
      expect(payload).not.toHaveProperty('candidateId');
    });

    it('rejects a candidate from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(service.run(ORG_B, HR_A, CAND, VAC)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('rejects a candidate whose account row no longer exists', async () => {
      // The applicant predicate guarantees a candidateAccountId, but the
      // account row itself can be gone. No account means no current evidence
      // to map — a 404, never an unscoped retrieval.
      prisma.candidate.findFirst.mockResolvedValue({
        id: CAND,
        fullName: 'Ji-woo Han',
        candidateAccount: null,
      });

      await expect(service.run(ORG_A, HR_A, CAND, VAC)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('rejects a vacancy from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(service.run(ORG_B, HR_A, CAND, VAC)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('scopes both lookups by organization', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(
        prisma.candidate.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
      expect(
        prisma.vacancy.findFirst.mock.calls[0][0].where.organizationId,
      ).toBe(ORG_A);
    });
  });

  describe('only CURRENT evidence may be mapped', () => {
    it('restricts retrieval to the candidate’s surviving personal sources', async () => {
      evidence.activePersonalSourceIds.mockResolvedValue(['doc-1', 'link-1']);

      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(evidence.activePersonalSourceIds).toHaveBeenCalledWith(ACCOUNT);
      expect(ai.mapEvidence.mock.calls[0][0].allowedSourceIds).toEqual([
        'doc-1',
        'link-1',
      ]);
    });

    it('an empty allowlist is sent as `[]`, which retrieves nothing', async () => {
      // `[]` and "no restriction" must never be confused here: a requirement
      // coming back EVIDENCE_FOUND on the strength of a file the candidate has
      // since deleted is exactly the failure this list prevents.
      evidence.activePersonalSourceIds.mockResolvedValue([]);

      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(ai.mapEvidence.mock.calls[0][0].allowedSourceIds).toEqual([]);
    });
  });

  describe('persistence policy', () => {
    it('stores a mapping row per requirement, including one with no evidence', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(upsert).toHaveBeenCalledTimes(2);
      const statuses = upsert.mock.calls.map((c) => c[0].create.status);
      expect(statuses).toEqual(['EVIDENCE_FOUND', 'NO_EVIDENCE_FOUND']);
    });

    it('stores evidence rows only for requirements that have evidence', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(createMany).toHaveBeenCalledTimes(1);
      const rows = createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0].requirementId).toBe('r-nest');
    });

    it('preserves the source chunk id for traceability', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data[0].sourceChunkId).toBe('chunk-1');
    });

    it('stamps the caller organization onto stored evidence', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data[0].organizationId).toBe(ORG_A);
    });

    it('resolves a citation against THIS candidate’s own sources only', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      // The id in a citation is only meaningful if it names something this
      // candidate actually owns. Scoping the lookup to their account is what
      // stops a foreign or fabricated source id being stored as though it were
      // theirs; `organizationId: null` keeps it to the personal row, the only
      // copy there is.
      expect(txDocumentFindMany.mock.calls[0][0].where).toMatchObject({
        id: { in: ['doc-1'] },
        candidateAccountId: ACCOUNT,
        organizationId: null,
      });
      expect(txCandidateLinkFindMany.mock.calls[0][0].where).toMatchObject({
        id: { in: ['doc-1'] },
        candidateAccountId: ACCOUNT,
      });
    });

    it('skips evidence whose source the candidate no longer has', async () => {
      txDocumentFindMany.mockResolvedValue([]);
      txCandidateLinkFindMany.mockResolvedValue([]);

      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(createMany.mock.calls[0][0].data).toHaveLength(0);
    });

    it('stores a citation from a professional LINK against candidateLinkId', async () => {
      // The AI service uses one key space for both source kinds, so the id in
      // a citation may name either. Storing a link id in `documentId` would
      // violate a real foreign key; dropping it (the earlier behaviour) meant
      // JD Evidence reported EVIDENCE_FOUND with nothing to show for it. The
      // column now points at the candidate's LIVE link, so deleting it
      // cascades the citation away instead of leaving it dangling.
      txDocumentFindMany.mockResolvedValue([]);
      txCandidateLinkFindMany.mockResolvedValue([{ id: 'doc-1' }]);

      await service.run(ORG_A, HR_A, CAND, VAC);

      const stored = createMany.mock.calls[0][0].data[0];
      expect(stored.candidateLinkId).toBe('doc-1');
      expect(stored.documentId).toBeNull();
    });

    it('stores a citation from a FILE against documentId', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      const stored = createMany.mock.calls[0][0].data[0];
      expect(stored.documentId).toBe('doc-1');
      expect(stored.candidateLinkId).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('deletes prior evidence before inserting the new set', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { requirementMapId: 'map-r-nest' },
      });
    });

    it('upserts on the candidate/vacancy/requirement key', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(upsert.mock.calls[0][0].where).toEqual({
        candidateId_vacancyId_requirementId: {
          candidateId: CAND,
          vacancyId: VAC,
          requirementId: 'r-nest',
        },
      });
    });

    it('re-running produces the same number of writes', async () => {
      await service.run(ORG_A, HR_A, CAND, VAC);
      const first = {
        upserts: upsert.mock.calls.length,
        inserts: createMany.mock.calls.length,
      };

      upsert.mockClear();
      createMany.mockClear();
      deleteMany.mockClear();
      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(upsert.mock.calls.length).toBe(first.upserts);
      expect(createMany.mock.calls.length).toBe(first.inserts);
    });
  });

  describe('failure behaviour', () => {
    it('reports a clear 503 when the AI service is not configured', async () => {
      ai.mapEvidence.mockRejectedValue(
        new AiServiceDisabledError('map requirement evidence'),
      );

      await expect(service.run(ORG_A, HR_A, CAND, VAC)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('refuses to map a vacancy with no requirements', async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: VAC,
        title: 'Empty',
        status: 'OPEN',
        createdById: HR_A,
        requirements: [],
      });

      await expect(service.run(ORG_A, HR_A, CAND, VAC)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('never persists anything when the AI call fails', async () => {
      ai.mapEvidence.mockRejectedValue(new Error('ai down'));

      await expect(service.run(ORG_A, HR_A, CAND, VAC)).rejects.toThrow(
        'ai down',
      );
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('read', () => {
    it('lists every requirement, mapped or not', async () => {
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([]);

      const result = await service.read(ORG_A, HR_A, CAND, VAC);

      expect(result.requirements).toHaveLength(2);
      expect(result.requirements[0].status).toBeNull();
    });

    it('scopes the read by organization', async () => {
      await service.read(ORG_A, HR_A, CAND, VAC);

      expect(
        prisma.requirementEvidenceMap.findMany.mock.calls[0][0].where
          .organizationId,
      ).toBe(ORG_A);
    });

    it('presents a link-backed citation through the LIVE link', async () => {
      // Both source kinds are emitted in one shape — `documentId` is whichever
      // id the citation names — so the UI addresses them uniformly. The title
      // and URL come from the candidate's current link rather than from a
      // frozen copy, which is what makes an edited or deleted link take effect
      // everywhere at once.
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([
        {
          requirementId: 'r-nest',
          status: 'EVIDENCE_FOUND',
          reason: 'x',
          matchedTerms: [],
          missingTerms: [],
          updatedAt: new Date(),
          evidence: [
            {
              id: 'ev-1',
              documentId: null,
              candidateLinkId: 'link-1',
              pageNumber: null,
              section: 'projects',
              text: 'Kubernetes work',
              sourceChunkId: 'chunk-9',
              document: null,
              candidateLink: {
                title: 'Portfolio Website',
                url: 'https://portfolio.example.com/projects',
              },
            },
          ],
        },
      ]);

      const result = await service.read(ORG_A, HR_A, CAND, VAC);
      const cited = result.requirements[0].evidence[0];

      expect(cited.documentId).toBe('link-1');
      expect(cited.sourceType).toBe('URL');
      expect(cited.fileName).toBe('Portfolio Website');
      expect(cited.sourceUrl).toBe('https://portfolio.example.com/projects');
      // The read asks for the live link, not a stored snapshot of it.
      const include =
        prisma.requirementEvidenceMap.findMany.mock.calls[0][0].include;
      expect(include.evidence.select.candidateLink).toEqual({
        select: { title: true, url: true },
      });
    });

    it('presents a file-backed citation as a FILE', async () => {
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([
        {
          requirementId: 'r-nest',
          status: 'EVIDENCE_FOUND',
          reason: 'x',
          matchedTerms: [],
          missingTerms: [],
          updatedAt: new Date(),
          evidence: [
            {
              id: 'ev-1',
              documentId: 'doc-1',
              candidateLinkId: null,
              pageNumber: 1,
              section: 'experience',
              text: 'Built the platform using NestJS',
              sourceChunkId: 'chunk-1',
              document: { originalFileName: 'cv.pdf' },
              candidateLink: null,
            },
          ],
        },
      ]);

      const result = await service.read(ORG_A, HR_A, CAND, VAC);
      const cited = result.requirements[0].evidence[0];

      expect(cited.documentId).toBe('doc-1');
      expect(cited.sourceType).toBe('FILE');
      expect(cited.fileName).toBe('cv.pdf');
      expect(cited.sourceUrl).toBeNull();
    });

    it('never returns a score or fit percentage', async () => {
      prisma.requirementEvidenceMap.findMany.mockResolvedValue([
        {
          requirementId: 'r-nest',
          status: 'EVIDENCE_FOUND',
          reason: 'x',
          matchedTerms: ['nestjs'],
          missingTerms: [],
          updatedAt: new Date(),
          evidence: [],
        },
      ]);

      const result = await service.read(ORG_A, HR_A, CAND, VAC);
      const serialised = JSON.stringify(result).toLowerCase();

      expect(serialised).not.toContain('"score"');
      expect(serialised).not.toContain('fitpercentage');
      expect(serialised).not.toContain('"rating"');
    });
  });

  describe('vacancy-scoped workspace rule (Compare backbone)', () => {
    it("a same-org colleague cannot run or read under HR A's vacancy", async () => {
      await expect(service.run(ORG_A, HR_B, CAND, VAC)).rejects.toMatchObject({
        status: 403,
      });
      await expect(service.read(ORG_A, HR_B, CAND, VAC)).rejects.toMatchObject({
        status: 403,
      });
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('a candidate outside the selected vacancy is refused with a stable code', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      try {
        await service.run(ORG_A, HR_A, CAND, VAC);
        fail('expected the mapping to be refused');
      } catch (error) {
        expect(
          (error as { getResponse(): unknown }).getResponse(),
        ).toMatchObject({
          code: 'CANDIDATE_NOT_IN_VACANCY',
        });
      }
      expect(ai.mapEvidence).not.toHaveBeenCalled();
    });

    it('requires a real APPLICATION, not merely any association row', async () => {
      prisma.application.findFirst.mockResolvedValue({ id: 'assoc-1' });

      await service.run(ORG_A, HR_A, CAND, VAC);

      expect(ai.mapEvidence).toHaveBeenCalled();
      const where = prisma.application.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({
        vacancyId: VAC,
        candidateId: CAND,
        source: 'DIRECT',
        candidate: { candidateAccountId: { not: null } },
      });
    });
  });
});

/**
 * The lifecycle service as a collaborator. `activePersonalSourceIds` is the
 * surviving-source allowlist every candidate-scoped AI call must carry — these
 * tests check it is SENT for the right account, not what it contains (that is
 * the lifecycle service's own spec).
 */
const evidenceLifecycleMock = () => ({
  activePersonalSourceIds: jest.fn().mockResolvedValue([]),
  activeSourceCounts: jest
    .fn()
    .mockResolvedValue({ files: 1, links: 1, total: 2 }),
  revision: jest.fn().mockResolvedValue(0),
  bumpRevision: jest.fn().mockResolvedValue(undefined),
  cascadePersonalFileDeletion: jest.fn().mockResolvedValue(undefined),
  cascadePersonalLinkDeletion: jest.fn().mockResolvedValue(undefined),
  cascadeDerivedCopyRemoval: jest.fn().mockResolvedValue(undefined),
});

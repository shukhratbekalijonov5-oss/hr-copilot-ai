import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiAnswerService } from './ai-answer.service';
import { TenantService } from '../common/tenant/tenant.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import {
  AiServiceDisabledError,
  isSupportedLocale,
} from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CAND = 'cand-1';
/** The candidate account behind CAND — where the evidence actually lives. */
const ACCOUNT = 'acct-1';
const USER = 'user-1';
const VAC = 'vac-1';

describe('AiAnswerService', () => {
  let ai: any;
  let prisma: any;
  let service: AiAnswerService;
  let evidence: ReturnType<typeof evidenceLifecycleMock>;

  beforeEach(() => {
    ai = {
      answerQuestion: jest.fn().mockResolvedValue({
        answer: 'The documents describe Kubernetes work.',
        status: 'GROUNDED',
        citations: [
          {
            chunkId: 'c1',
            documentId: 'd1',
            fileName: 'cv.pdf',
            pageNumber: 2,
            section: 'experience',
            text: 'Kubernetes',
          },
        ],
        locale: 'en',
        rejectedCitations: [],
        evidenceConsidered: 5,
        durationMs: 900,
        model: 'claude-opus-5',
      }),
      summariseCandidate: jest.fn().mockResolvedValue({
        summary: 's',
        status: 'GROUNDED',
        citations: [],
        locale: 'en',
        rejectedCitations: [],
        durationMs: 10,
        model: 'claude-opus-5',
      }),
      interviewQuestions: jest.fn().mockResolvedValue({
        candidateId: CAND,
        vacancyId: VAC,
        questions: [],
        locale: 'en',
        durationMs: 10,
        model: 'claude-opus-5',
      }),
    };
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ preferredLocale: 'en' }),
      },
      // An org-side applicant record always resolves to the LIVE account that
      // owns the evidence; every AI surface reads by that account id.
      candidate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CAND, candidateAccount: { id: ACCOUNT } }),
      },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: VAC,
          title: 'Backend Engineer',
          status: 'OPEN',
          createdById: USER,
          requirements: [
            { id: 'r1', text: 'NestJS', type: 'SKILL', required: true },
          ],
        }),
      },
      application: {
        // The candidate HAS applied to the vacancy by default (the applicant
        // association is what every candidate-in-vacancy AI path requires).
        findFirst: jest.fn().mockResolvedValue({ id: 'assoc-1' }),
        // The org-wide universe: the applicant accounts of the caller's OWN
        // vacancies, resolved server-side.
        findMany: jest
          .fn()
          .mockResolvedValue([{ candidate: { candidateAccountId: ACCOUNT } }]),
      },
      // The org-wide Ask has no candidate to scope by, so it checks the
      // citations it got back against the sources that still exist. By default
      // the cited source DOES still exist — the ordinary case.
      document: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
      // A citation may name a professional link instead of a file; both source
      // kinds share one key space, so both tables are consulted.
      candidateLink: { findMany: jest.fn().mockResolvedValue([]) },
    };
    evidence = evidenceLifecycleMock();
    service = new AiAnswerService(
      ai,
      prisma,
      new TenantService(),
      new OwnedVacancyService(prisma),
      evidence as never,
    );
  });

  /**
   * The retrieval universe IS the authorization decision.
   *
   * Since the snapshot removal there is nothing org-owned to retrieve from:
   * every candidate's evidence lives once, in their own account-scoped
   * collection. What makes reading it lawful is no longer an organizationId
   * stamped on a copy, but the list of candidate accounts the backend resolved
   * from the caller's OWN applicant relationships. These tests hold that list
   * to the same standard the old organizationId was held to: it is derived
   * server-side from auth, never from anything the client sent, and an account
   * outside it is physically unreachable.
   */
  describe('authorized retrieval universe', () => {
    it('sends the applicant accounts of the CALLER’S OWN vacancies', async () => {
      await service.answer(ORG_A, USER, { query: 'Kubernetes?' });

      expect(ai.answerQuestion.mock.calls[0][0].candidateAccountIds).toEqual([
        ACCOUNT,
      ]);
      // Derived from auth on both axes: the active organization and personal
      // creation. A same-org colleague's applicants contribute nothing.
      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        source: 'DIRECT',
        vacancy: { organizationId: ORG_A, createdById: USER },
      });
    });

    it('cannot be redirected by anything in the payload', async () => {
      // The DTO declares no organizationId and the global ValidationPipe
      // rejects unknown properties; this asserts the service itself also
      // ignores a stray value rather than passing it on.
      await service.answer(ORG_A, USER, {
        query: 'x',
        organizationId: ORG_B,
      } as never);

      expect(prisma.application.findMany.mock.calls[0][0].where).toMatchObject({
        vacancy: { organizationId: ORG_A, createdById: USER },
      });
      // Nothing tenant-shaped travels to the AI service any more: the account
      // list is the whole filter.
      const payload = ai.answerQuestion.mock.calls[0][0];
      expect(payload).not.toHaveProperty('organizationId');
      expect(payload).not.toHaveProperty('candidateId');
      expect(payload.candidateAccountIds).toEqual([ACCOUNT]);
    });

    it('an account outside the universe is unreachable, whatever the client sends', async () => {
      // The caller's own vacancies have exactly one applicant. Even though
      // other accounts exist in the index, the filter sent to the AI service
      // names only this one.
      prisma.application.findMany.mockResolvedValue([
        { candidate: { candidateAccountId: 'acct-mine' } },
      ]);

      await service.answer(ORG_A, USER, {
        query: 'x',
        candidateAccountIds: ['acct-someone-else'],
      } as never);

      expect(ai.answerQuestion.mock.calls[0][0].candidateAccountIds).toEqual([
        'acct-mine',
      ]);
    });

    it('an empty universe still asks a well-formed, empty-scoped question', async () => {
      // Nobody has applied to any of my vacancies. The filter is `[]`, which
      // retrieves nothing — the AI service refuses rather than improvising.
      prisma.application.findMany.mockResolvedValue([]);

      await service.answer(ORG_A, USER, { query: 'x' });

      expect(ai.answerQuestion.mock.calls[0][0].candidateAccountIds).toEqual(
        [],
      );
    });

    it('dedupes accounts and drops applicants with no account row', async () => {
      // One person applying to three of my vacancies is one retrieval scope,
      // and a historical recruiter-made record (no account) is not part of the
      // universe at all.
      prisma.application.findMany.mockResolvedValue([
        { candidate: { candidateAccountId: ACCOUNT } },
        { candidate: { candidateAccountId: ACCOUNT } },
        { candidate: { candidateAccountId: 'acct-2' } },
        { candidate: { candidateAccountId: null } },
      ]);

      await service.answer(ORG_A, USER, { query: 'x' });

      expect(ai.answerQuestion.mock.calls[0][0].candidateAccountIds).toEqual([
        ACCOUNT,
        'acct-2',
      ]);
    });

    it('narrows to exactly ONE account when asking about a candidate', async () => {
      await service.answer(ORG_A, USER, {
        query: 'x',
        candidateId: CAND,
        vacancyId: VAC,
      });

      expect(ai.answerQuestion.mock.calls[0][0].candidateAccountIds).toEqual([
        ACCOUNT,
      ]);
      // Resolved from the org-side record, never taken from the request.
      expect(prisma.candidate.findFirst.mock.calls[0][0].where).toMatchObject({
        id: CAND,
        organizationId: ORG_A,
        candidateAccountId: { not: null },
      });
    });

    it('rejects a candidate filter from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.answer(ORG_A, USER, {
          query: 'x',
          candidateId: 'foreign',
          vacancyId: VAC,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('rejects a candidate whose account no longer exists', async () => {
      // The applicant predicate guarantees a candidateAccountId, but the
      // account row itself can be gone. No account means no evidence to read,
      // and a 404 rather than an unscoped retrieval.
      prisma.candidate.findFirst.mockResolvedValue({
        id: CAND,
        candidateAccount: null,
      });

      await expect(
        service.answer(ORG_A, USER, {
          query: 'x',
          candidateId: CAND,
          vacancyId: VAC,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('rejects a vacancy filter from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.answer(ORG_A, USER, { query: 'x', vacancyId: 'foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('refuses to summarise another organization candidate', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.summariseCandidate(ORG_A, USER, 'foreign', VAC),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.summariseCandidate).not.toHaveBeenCalled();
    });

    it('summary and interview questions address the ACCOUNT, not the org record', async () => {
      await service.summariseCandidate(ORG_A, USER, CAND, VAC);
      await service.interviewQuestions(ORG_A, USER, CAND, VAC);

      for (const payload of [
        ai.summariseCandidate.mock.calls[0][0],
        ai.interviewQuestions.mock.calls[0][0],
      ]) {
        expect(payload.candidateAccountId).toBe(ACCOUNT);
        expect(payload).not.toHaveProperty('organizationId');
        expect(payload).not.toHaveProperty('candidateId');
      }
    });
  });

  describe('locale handling (precedence: explicit → preferred → en)', () => {
    it('falls back to the USER preferred locale when the request sends none', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLocale: 'uz' });

      await service.answer(ORG_A, USER, { query: 'x' });

      expect(ai.answerQuestion.mock.calls[0][0].locale).toBe('uz');
      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
        id: USER,
      });
    });

    it('an EXPLICIT request locale always wins over the preference', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLocale: 'ko' });

      await service.answer(ORG_A, USER, { query: 'x', locale: 'ru' });

      expect(ai.answerQuestion.mock.calls[0][0].locale).toBe('ru');
      // No lookup needed when the client stated the language.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('defaults to English only as the last resort', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.answer(ORG_A, USER, { query: 'x' });

      expect(ai.answerQuestion.mock.calls[0][0].locale).toBe('en');
    });

    it('summaries and interview questions use the same precedence', async () => {
      prisma.user.findUnique.mockResolvedValue({ preferredLocale: 'ko' });

      await service.summariseCandidate(ORG_A, USER, CAND, VAC, undefined);
      expect(ai.summariseCandidate.mock.calls[0][0].locale).toBe('ko');

      await service.interviewQuestions(ORG_A, USER, CAND, VAC, undefined);
      expect(ai.interviewQuestions.mock.calls[0][0].locale).toBe('ko');
    });

    it.each(['en', 'ko', 'ru', 'uz'] as const)(
      'passes %s through',
      async (locale) => {
        await service.answer(ORG_A, USER, { query: 'x', locale });
        expect(ai.answerQuestion.mock.calls[0][0].locale).toBe(locale);
      },
    );

    it('recognises exactly the four supported locales', () => {
      expect(['en', 'ko', 'ru', 'uz'].every(isSupportedLocale)).toBe(true);
      expect(isSupportedLocale('fr')).toBe(false);
      expect(isSupportedLocale('zh')).toBe(false);
    });
  });

  describe('results', () => {
    it('passes through the grounded answer and its citations', async () => {
      const result = await service.answer(ORG_A, USER, {
        query: 'Kubernetes?',
      });

      expect(result.status).toBe('GROUNDED');
      expect(result.citations[0].pageNumber).toBe(2);
      expect(result.citations[0].fileName).toBe('cv.pdf');
    });

    it('sends the vacancy requirements when generating questions', async () => {
      await service.interviewQuestions(ORG_A, USER, CAND, VAC, 'ko');

      const payload = ai.interviewQuestions.mock.calls[0][0];
      expect(payload.requirements).toEqual([
        { requirementId: 'r1', text: 'NestJS', type: 'SKILL', required: true },
      ]);
      expect(payload.locale).toBe('ko');
    });
  });

  describe('AI availability (§43)', () => {
    it('reports 503 when generation is not configured', async () => {
      ai.answerQuestion.mockRejectedValue(new AiServiceDisabledError('answer'));

      await expect(
        service.answer(ORG_A, USER, { query: 'x' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('never fabricates an answer when the provider fails', async () => {
      ai.answerQuestion.mockRejectedValue(new Error('provider timeout'));

      await expect(service.answer(ORG_A, USER, { query: 'x' })).rejects.toThrow(
        'provider timeout',
      );
    });
  });

  describe('vacancy-scoped workspace rule', () => {
    it('asking ABOUT a candidate requires a selected vacancy', async () => {
      await expect(
        service.answer(ORG_A, USER, { query: 'x', candidateId: CAND }),
      ).rejects.toMatchObject({ status: 400 });
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('Ask sends the selected vacancy as generation grounding', async () => {
      await service.answer(ORG_A, USER, {
        query: 'Does the candidate know NestJS?',
        candidateId: CAND,
        vacancyId: VAC,
      });

      expect(ai.answerQuestion.mock.calls[0][0].vacancy).toEqual({
        vacancyId: VAC,
        title: 'Backend Engineer',
        requirements: [{ text: 'NestJS', required: true }],
      });
    });

    it('the org-wide AI Search grounded answer stays lawful without a vacancy', async () => {
      await service.answer(ORG_A, USER, { query: 'kubernetes experience' });

      expect(ai.answerQuestion.mock.calls[0][0].vacancy).toBeNull();
    });

    it("a same-org colleague's vacancy is refused for Ask/summary/questions", async () => {
      prisma.vacancy.findFirst.mockResolvedValue({
        id: VAC,
        title: 'Backend Engineer',
        status: 'OPEN',
        createdById: 'someone-else',
        requirements: [],
      });

      await expect(
        service.answer(ORG_A, USER, { query: 'x', vacancyId: VAC }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.summariseCandidate(ORG_A, USER, CAND, VAC),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.interviewQuestions(ORG_A, USER, CAND, VAC),
      ).rejects.toMatchObject({ status: 403 });
      expect(ai.summariseCandidate).not.toHaveBeenCalled();
      expect(ai.interviewQuestions).not.toHaveBeenCalled();
    });

    it('a candidate outside the selected vacancy is refused everywhere', async () => {
      prisma.application.findFirst.mockResolvedValue(null);

      await expect(
        service.summariseCandidate(ORG_A, USER, CAND, VAC),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.interviewQuestions(ORG_A, USER, CAND, VAC),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        service.answer(ORG_A, USER, {
          query: 'x',
          candidateId: CAND,
          vacancyId: VAC,
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('the summary is grounded in the SELECTED vacancy requirements', async () => {
      await service.summariseCandidate(ORG_A, USER, CAND, VAC);

      expect(ai.summariseCandidate.mock.calls[0][0].vacancy).toEqual({
        vacancyId: VAC,
        title: 'Backend Engineer',
        requirements: [{ text: 'NestJS', required: true }],
      });
    });
  });

  describe('withdrawn evidence can never be cited', () => {
    it('sends the candidate’s surviving PERSONAL source ids when asking about one candidate', async () => {
      // The allowlist is now the candidate's own current files and links —
      // there are no application-time copies to enumerate instead.
      evidence.activePersonalSourceIds.mockResolvedValue(['d1', 'link-9']);

      await service.answer(ORG_A, USER, {
        query: 'Kubernetes?',
        candidateId: CAND,
        vacancyId: VAC,
      });

      expect(evidence.activePersonalSourceIds).toHaveBeenCalledWith(ACCOUNT);
      expect(ai.answerQuestion.mock.calls[0][0].allowedSourceIds).toEqual([
        'd1',
        'link-9',
      ]);
    });

    it('sends NO allowlist for the organization-wide question', async () => {
      // There is no candidate to scope by, and an allowlist of every source
      // every applicant owns would be an unbounded filter that degrades
      // silently.
      await service.answer(ORG_A, USER, { query: 'Who knows Kubernetes?' });

      expect(ai.answerQuestion.mock.calls[0][0].allowedSourceIds).toBeNull();
    });

    it('drops an organization-wide citation whose source no longer exists', async () => {
      // Nothing resolves: the cited source was withdrawn between indexing and
      // this question.
      prisma.document.findMany.mockResolvedValue([]);

      const result = await service.answer(ORG_A, USER, {
        query: 'Who knows Kubernetes?',
      });

      expect(result.citations).toEqual([]);
      // With no surviving citation the answer cannot be reported as grounded.
      expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    });

    it('keeps a surviving citation and flags the answer for review', async () => {
      ai.answerQuestion.mockResolvedValue({
        answer: 'Two candidates describe Kubernetes work.',
        status: 'GROUNDED',
        citations: [
          {
            chunkId: 'c1',
            documentId: 'd1',
            fileName: 'cv.pdf',
            pageNumber: 1,
            section: null,
            text: 'k8s',
          },
          {
            chunkId: 'c2',
            documentId: 'gone',
            fileName: 'old.pdf',
            pageNumber: 1,
            section: null,
            text: 'k8s',
          },
        ],
        locale: 'en',
        rejectedCitations: [],
        evidenceConsidered: 2,
        durationMs: 1,
        model: 'test',
      });
      prisma.document.findMany.mockResolvedValue([{ id: 'd1' }]);

      const result = await service.answer(ORG_A, USER, {
        query: 'Who knows Kubernetes?',
      });

      expect(
        result.citations.map((c: { documentId: string }) => c.documentId),
      ).toEqual(['d1']);
      // The prose may have been shaped by the withdrawn passage, so it is not
      // presented as fully grounded.
      expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
    });

    it('a citation naming a live professional LINK survives too', async () => {
      // Files and links share one key space, so survival is asked of both
      // tables; a link-backed citation must not be dropped as "unknown".
      prisma.document.findMany.mockResolvedValue([]);
      prisma.candidateLink.findMany.mockResolvedValue([{ id: 'd1' }]);

      const result = await service.answer(ORG_A, USER, {
        query: 'Who knows Kubernetes?',
      });

      expect(result.status).toBe('GROUNDED');
      expect(result.citations).toHaveLength(1);
    });

    it('asks for survival only within the caller’s universe, and only of PERSONAL rows', async () => {
      // The isolation property, restated for the account-scoped world: a
      // source that exists but belongs to an account outside the universe
      // cannot vouch for a citation, so a leaked chunk id cannot be laundered
      // into a legitimate-looking answer. `organizationId: null` keeps the
      // question about the candidate's own copy — the only one there is.
      prisma.application.findMany.mockResolvedValue([
        { candidate: { candidateAccountId: ACCOUNT } },
        { candidate: { candidateAccountId: 'acct-2' } },
      ]);

      await service.answer(ORG_A, USER, { query: 'Who knows Kubernetes?' });

      expect(prisma.document.findMany.mock.calls[0][0].where).toMatchObject({
        id: { in: ['d1'] },
        candidateAccountId: { in: [ACCOUNT, 'acct-2'] },
        organizationId: null,
      });
      expect(
        prisma.candidateLink.findMany.mock.calls[0][0].where,
      ).toMatchObject({
        id: { in: ['d1'] },
        candidateAccountId: { in: [ACCOUNT, 'acct-2'] },
      });
    });

    it('leaves a clean organization-wide answer untouched', async () => {
      prisma.document.findMany.mockResolvedValue([{ id: 'd1' }]);

      const result = await service.answer(ORG_A, USER, {
        query: 'Who knows Kubernetes?',
      });

      expect(result.status).toBe('GROUNDED');
      expect(result.citations).toHaveLength(1);
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

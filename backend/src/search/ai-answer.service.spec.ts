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
const USER = 'user-1';
const VAC = 'vac-1';

describe('AiAnswerService', () => {
  let ai: any;
  let prisma: any;
  let service: AiAnswerService;

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
      candidate: { findFirst: jest.fn().mockResolvedValue({ id: CAND }) },
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
      },
    };
    service = new AiAnswerService(
      ai,
      prisma,
      new TenantService(),
      new OwnedVacancyService(prisma),
    );
  });

  describe('tenant identity', () => {
    it('always sends the organization from auth', async () => {
      await service.answer(ORG_A, USER, { query: 'Kubernetes?' });
      expect(ai.answerQuestion.mock.calls[0][0].organizationId).toBe(ORG_A);
    });

    it('ignores any organizationId in the payload', async () => {
      await service.answer(ORG_A, USER, {
        query: 'x',
        organizationId: ORG_B,
      } as never);
      expect(ai.answerQuestion.mock.calls[0][0].organizationId).toBe(ORG_A);
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
});

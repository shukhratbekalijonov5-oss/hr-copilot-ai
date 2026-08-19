import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiAnswerService } from './ai-answer.service';
import { TenantService } from '../common/tenant/tenant.service';
import {
  AiServiceDisabledError,
  isSupportedLocale,
} from '../ai/ai-service.client';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CAND = 'cand-1';
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
      candidate: { findFirst: jest.fn().mockResolvedValue({ id: CAND }) },
      vacancy: {
        findFirst: jest.fn().mockResolvedValue({
          id: VAC,
          requirements: [
            { id: 'r1', text: 'NestJS', type: 'SKILL', required: true },
          ],
        }),
      },
    };
    service = new AiAnswerService(ai, prisma, new TenantService());
  });

  describe('tenant identity', () => {
    it('always sends the organization from auth', async () => {
      await service.answer(ORG_A, { query: 'Kubernetes?' });
      expect(ai.answerQuestion.mock.calls[0][0].organizationId).toBe(ORG_A);
    });

    it('ignores any organizationId in the payload', async () => {
      await service.answer(ORG_A, {
        query: 'x',
        organizationId: ORG_B,
      } as never);
      expect(ai.answerQuestion.mock.calls[0][0].organizationId).toBe(ORG_A);
    });

    it('rejects a candidate filter from another organization', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.answer(ORG_A, { query: 'x', candidateId: 'foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('rejects a vacancy filter from another organization', async () => {
      prisma.vacancy.findFirst.mockResolvedValue(null);

      await expect(
        service.answer(ORG_A, { query: 'x', vacancyId: 'foreign' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.answerQuestion).not.toHaveBeenCalled();
    });

    it('refuses to summarise another organization candidate', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);

      await expect(
        service.summariseCandidate(ORG_A, 'foreign'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ai.summariseCandidate).not.toHaveBeenCalled();
    });
  });

  describe('locale handling', () => {
    it('defaults to English', async () => {
      await service.answer(ORG_A, { query: 'x' });
      expect(ai.answerQuestion.mock.calls[0][0].locale).toBe('en');
    });

    it.each(['en', 'ko', 'ru', 'uz'] as const)(
      'passes %s through',
      async (locale) => {
        await service.answer(ORG_A, { query: 'x', locale });
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
      const result = await service.answer(ORG_A, { query: 'Kubernetes?' });

      expect(result.status).toBe('GROUNDED');
      expect(result.citations[0].pageNumber).toBe(2);
      expect(result.citations[0].fileName).toBe('cv.pdf');
    });

    it('sends the vacancy requirements when generating questions', async () => {
      await service.interviewQuestions(ORG_A, CAND, VAC, 'ko');

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
        service.answer(ORG_A, { query: 'x' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('never fabricates an answer when the provider fails', async () => {
      ai.answerQuestion.mockRejectedValue(new Error('provider timeout'));

      await expect(service.answer(ORG_A, { query: 'x' })).rejects.toThrow(
        'provider timeout',
      );
    });
  });
});

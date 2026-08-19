import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import {
  AiServiceClient,
  AiServiceDisabledError,
  type SupportedLocale,
} from '../ai/ai-service.client';

/**
 * Grounded AI answers, candidate summaries and interview questions.
 *
 * Everything here is tenant-scoped from the authenticated user, and every
 * candidate or vacancy id supplied by the client is verified against that
 * organization *before* it reaches the AI service.
 */
@Injectable()
export class AiAnswerService {
  private readonly logger = new Logger(AiAnswerService.name);

  constructor(
    private readonly ai: AiServiceClient,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async answer(
    organizationId: string,
    input: {
      query: string;
      candidateId?: string;
      vacancyId?: string;
      locale?: SupportedLocale;
      limit?: number;
    },
  ) {
    if (input.candidateId) {
      await this.assertCandidate(organizationId, input.candidateId);
    }
    if (input.vacancyId) {
      await this.assertVacancy(organizationId, input.vacancyId);
    }

    return this.guard('answer questions', () =>
      this.ai.answerQuestion({
        organizationId,
        query: input.query,
        candidateId: input.candidateId ?? null,
        vacancyId: input.vacancyId ?? null,
        locale: input.locale ?? 'en',
        limit: input.limit,
      }),
    );
  }

  async summariseCandidate(
    organizationId: string,
    candidateId: string,
    locale: SupportedLocale = 'en',
  ) {
    await this.assertCandidate(organizationId, candidateId);

    return this.guard('summarise candidates', () =>
      this.ai.summariseCandidate({ organizationId, candidateId, locale }),
    );
  }

  async interviewQuestions(
    organizationId: string,
    candidateId: string,
    vacancyId: string,
    locale: SupportedLocale = 'en',
  ) {
    await this.assertCandidate(organizationId, candidateId);
    const vacancy = await this.assertVacancy(organizationId, vacancyId);

    return this.guard('generate interview questions', () =>
      this.ai.interviewQuestions({
        organizationId,
        candidateId,
        vacancyId,
        requirements: vacancy.requirements.map((r) => ({
          requirementId: r.id,
          text: r.text,
          type: r.type,
          required: r.required,
        })),
        locale,
      }),
    );
  }

  /**
   * Turns an unconfigured AI service into a clear 503.
   *
   * Note this only wraps *generation*. Semantic search and evidence mapping
   * deliberately do not depend on the LLM, so they keep working when it is
   * unavailable.
   */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AiServiceDisabledError) {
        throw new ServiceUnavailableException(
          `Cannot ${operation}: the AI service is not configured`,
        );
      }
      throw error;
    }
  }

  private async assertCandidate(organizationId: string, candidateId: string) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { id: candidateId, ...this.tenant.scope(organizationId) },
      select: { id: true },
    });
    return this.tenant.assertFound(candidate, 'Candidate');
  }

  private async assertVacancy(organizationId: string, vacancyId: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id: vacancyId, ...this.tenant.scope(organizationId) },
      select: {
        id: true,
        requirements: {
          select: { id: true, text: true, type: true, required: true },
        },
      },
    });
    return this.tenant.assertFound(vacancy, 'Vacancy');
  }
}

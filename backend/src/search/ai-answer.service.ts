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
  isSupportedLocale,
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
    userId: string,
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
    const locale = await this.resolveLocale(userId, input.locale);

    return this.guard('answer questions', () =>
      this.ai.answerQuestion({
        organizationId,
        query: input.query,
        candidateId: input.candidateId ?? null,
        vacancyId: input.vacancyId ?? null,
        locale,
        limit: input.limit,
      }),
    );
  }

  /**
   * Locale precedence (documented product rule):
   *   explicit request locale → the user's preferredLocale → 'en'.
   * The client's explicit choice always wins; the account-level preference
   * only fills the gap when the client sent none. Nothing here detects the
   * query's language — language selection is a user setting, not a guess.
   */
  private async resolveLocale(
    userId: string,
    requested: SupportedLocale | undefined,
  ): Promise<SupportedLocale> {
    if (requested) return requested;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredLocale: true },
    });
    const resolved =
      user && isSupportedLocale(user.preferredLocale)
        ? user.preferredLocale
        : 'en';
    // Safe metadata only — no query text, no tokens.
    this.logger.log(
      `AI generation locale: requested=none resolved=${resolved}`,
    );
    return resolved;
  }

  async summariseCandidate(
    organizationId: string,
    userId: string,
    candidateId: string,
    locale?: SupportedLocale,
  ) {
    await this.assertCandidate(organizationId, candidateId);
    const resolved = await this.resolveLocale(userId, locale);

    return this.guard('summarise candidates', () =>
      this.ai.summariseCandidate({
        organizationId,
        candidateId,
        locale: resolved,
      }),
    );
  }

  async interviewQuestions(
    organizationId: string,
    userId: string,
    candidateId: string,
    vacancyId: string,
    locale?: SupportedLocale,
  ) {
    await this.assertCandidate(organizationId, candidateId);
    const vacancy = await this.assertVacancy(organizationId, vacancyId);
    const resolvedLocale = await this.resolveLocale(userId, locale);

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
        locale: resolvedLocale,
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

import {
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiServiceClient } from '../../ai/ai-service.client';
import type { SupportedLocale } from '../../ai/ai-service.client';
import { ExternalPremiumAiContextService } from './external-premium-ai.context';
import { PremiumAiCacheService } from './premium-ai.cache';
import {
  AI_INTERVIEW_PREP_UNAVAILABLE,
  INTERVIEW_PREP_VERSION,
  MAX_FOCUS_AREAS,
  MAX_INTERVIEW_QUESTIONS,
} from './external-premium-ai.policy';

export interface InterviewPrepQuestion {
  question: string;
  whyAsked: string;
  preparation: string;
}

export interface InterviewFocusArea {
  title: string;
  guidance: string;
}

export interface InterviewPrepResult {
  jobId: string;
  version: string;
  locale: SupportedLocale;
  questions: InterviewPrepQuestion[];
  focusAreas: InterviewFocusArea[];
  cached: boolean;
  generatedAt: Date;
}

interface CachedInterviewPrep {
  questions: InterviewPrepQuestion[];
  focusAreas: InterviewFocusArea[];
  generatedAt: string;
}

/**
 * Job-specific interview preparation — same premium architecture as
 * why-match and the cover letter: ONE grounded context from
 * `ExternalPremiumAiContextService`, ONE fingerprint-keyed cache entry per
 * (candidate state, job content, locale), failure contained to this surface,
 * and no side effect beyond the cache write.
 *
 * ## Bounds are upper bounds
 *
 * The prompt asks for 5-8 questions and 2-4 focus areas. This layer clamps
 * at 8 and 4 and drops malformed items — but it never pads upward, and it
 * accepts an honest 3-question answer for a thin posting. The one thing it
 * refuses is ZERO questions: a preparation with nothing to prepare is a
 * failed generation, and caching it would make the failure permanent.
 */
@Injectable()
export class ExternalInterviewPrepService {
  private readonly logger = new Logger(ExternalInterviewPrepService.name);

  constructor(
    private readonly context: ExternalPremiumAiContextService,
    private readonly ai: AiServiceClient,
    private readonly cache: PremiumAiCacheService,
  ) {}

  async interviewPrep(
    userId: string,
    externalJobId: string,
    requestedLocale?: SupportedLocale,
  ): Promise<InterviewPrepResult> {
    const grounded = await this.context.load(userId, externalJobId);
    const locale =
      requestedLocale ?? (await this.cache.preferredLocale(userId));
    const key = this.cache.key(
      INTERVIEW_PREP_VERSION,
      locale,
      grounded.fingerprint,
    );

    const cached = await this.read(key);
    if (cached) {
      return {
        jobId: externalJobId,
        version: INTERVIEW_PREP_VERSION,
        locale,
        questions: cached.questions,
        focusAreas: cached.focusAreas,
        cached: true,
        generatedAt: new Date(cached.generatedAt),
      };
    }

    if (!this.ai.enabled) throw this.unavailable();

    let questions: InterviewPrepQuestion[];
    let focusAreas: InterviewFocusArea[];
    try {
      const response = await this.ai.externalInterviewPrep({
        jobId: externalJobId,
        locale,
        candidate: grounded.candidate,
        job: {
          title: grounded.job.title,
          company: grounded.job.company,
          status: grounded.job.status,
          locationLabel: grounded.job.locationLabel,
          workMode: grounded.job.workMode,
          employmentType: grounded.job.employmentType,
          seniorityLevel: grounded.job.seniorityLevel,
          salaryLabel: grounded.job.salaryLabel,
          skills: grounded.job.skills,
          languages: grounded.job.languages,
          benefits: grounded.job.benefits,
          description: grounded.job.description,
          requirementsText: grounded.job.requirementsText,
        },
        facts: grounded.facts,
      });
      questions = boundedQuestions(response.questions);
      focusAreas = boundedFocusAreas(response.focusAreas);
    } catch (error) {
      this.logger.warn(
        `Interview-prep generation failed for job ${externalJobId} ` +
          `(account ${grounded.candidateAccountId}): ${
            (error as Error).name || 'Error'
          }`,
      );
      throw this.unavailable();
    }

    if (questions.length === 0) {
      this.logger.warn(
        `Interview-prep generation returned no usable questions for job ${externalJobId}`,
      );
      throw this.unavailable();
    }

    const generatedAt = new Date();
    await this.cache.write(key, {
      questions,
      focusAreas,
      generatedAt: generatedAt.toISOString(),
    } satisfies CachedInterviewPrep);

    return {
      jobId: externalJobId,
      version: INTERVIEW_PREP_VERSION,
      locale,
      questions,
      focusAreas,
      cached: false,
      generatedAt,
    };
  }

  private async read(key: string): Promise<CachedInterviewPrep | null> {
    const parsed = await this.cache.read<CachedInterviewPrep>(key);
    if (!parsed?.generatedAt) return null;
    const questions = boundedQuestions(parsed.questions);
    if (questions.length === 0) return null;
    return {
      questions,
      focusAreas: boundedFocusAreas(parsed.focusAreas),
      generatedAt: parsed.generatedAt,
    };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'The interview preparation could not be generated right now.',
      code: AI_INTERVIEW_PREP_UNAVAILABLE,
    });
  }
}

/** Drop items with any missing part, clamp the rest. Never pad. */
function boundedQuestions(items: unknown): InterviewPrepQuestion[] {
  if (!Array.isArray(items)) return [];
  const out: InterviewPrepQuestion[] = [];
  for (const item of items) {
    const record = item as Partial<InterviewPrepQuestion> | null;
    const question = text(record?.question);
    const whyAsked = text(record?.whyAsked);
    const preparation = text(record?.preparation);
    if (!question || !whyAsked || !preparation) continue;
    out.push({ question, whyAsked, preparation });
    if (out.length === MAX_INTERVIEW_QUESTIONS) break;
  }
  return out;
}

function boundedFocusAreas(items: unknown): InterviewFocusArea[] {
  if (!Array.isArray(items)) return [];
  const out: InterviewFocusArea[] = [];
  for (const item of items) {
    const record = item as Partial<InterviewFocusArea> | null;
    const title = text(record?.title);
    const guidance = text(record?.guidance);
    if (!title || !guidance) continue;
    out.push({ title, guidance });
    if (out.length === MAX_FOCUS_AREAS) break;
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

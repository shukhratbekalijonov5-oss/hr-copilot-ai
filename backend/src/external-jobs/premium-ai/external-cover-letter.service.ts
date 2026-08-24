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
  AI_COVER_LETTER_UNAVAILABLE,
  COVER_LETTER_VERSION,
  MAX_COVER_LETTER_CHARS,
  MAX_COVER_LETTER_SUBJECT_CHARS,
} from './external-premium-ai.policy';

export interface CoverLetterResult {
  jobId: string;
  version: string;
  locale: SupportedLocale;
  subject: string;
  content: string;
  cached: boolean;
  generatedAt: Date;
}

/** What actually goes in Redis: the draft, plus when it was written. */
interface CachedCoverLetter {
  subject: string;
  content: string;
  generatedAt: string;
}

/**
 * A job-specific cover letter draft — generated once per (candidate state,
 * job content, locale), then reused.
 *
 * Same architecture as why-match, deliberately: the grounded context comes
 * from `ExternalPremiumAiContextService` (the candidate's CURRENT profile,
 * ONE canonical job, the deterministic facts — Rule N1 by construction), the
 * cache key carries that context's fingerprint (so a profile edit, evidence
 * deletion, preference change or job content/lifecycle change makes the old
 * draft unreachable), and failure is contained to this one surface.
 *
 * ## What generating a letter must never do
 *
 * Nothing here writes to Postgres. Asking for a draft does not create an
 * Application, does not mark anything applied, does not save the job, does
 * not touch a tracker, and cannot move a ranking — the only side effect is
 * one Redis entry under the premium-ai namespace.
 *
 * ## Honesty at this layer
 *
 * The anti-fabrication rules live in the AI service's system prompt; what
 * THIS layer enforces is the part prose cannot: bounds (a runaway letter is
 * clipped), emptiness-as-failure (an empty draft is a 503, never a cached
 * ""), and the guarantee that the model saw only supplied facts.
 */
@Injectable()
export class ExternalCoverLetterService {
  private readonly logger = new Logger(ExternalCoverLetterService.name);

  constructor(
    private readonly context: ExternalPremiumAiContextService,
    private readonly ai: AiServiceClient,
    private readonly cache: PremiumAiCacheService,
  ) {}

  async coverLetter(
    userId: string,
    externalJobId: string,
    requestedLocale?: SupportedLocale,
  ): Promise<CoverLetterResult> {
    // Throws 404 for an id that is not an external job, before any model or
    // cache work happens.
    const grounded = await this.context.load(userId, externalJobId);
    const locale =
      requestedLocale ?? (await this.cache.preferredLocale(userId));
    const key = this.cache.key(
      COVER_LETTER_VERSION,
      locale,
      grounded.fingerprint,
    );

    const cached = await this.read(key);
    if (cached) {
      return {
        jobId: externalJobId,
        version: COVER_LETTER_VERSION,
        locale,
        subject: cached.subject,
        content: cached.content,
        cached: true,
        generatedAt: new Date(cached.generatedAt),
      };
    }

    if (!this.ai.enabled) throw this.unavailable();

    let subject: string;
    let content: string;
    try {
      const response = await this.ai.externalCoverLetter({
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
      // Bounded again on this side. The AI service already clamps; a
      // contract is not a place to trust one layer's discipline.
      subject = clip(response.subject, MAX_COVER_LETTER_SUBJECT_CHARS);
      content = clip(response.content, MAX_COVER_LETTER_CHARS);
    } catch (error) {
      // Error TYPE and ids only — no provider message, no prompt, no text.
      this.logger.warn(
        `Cover-letter generation failed for job ${externalJobId} ` +
          `(account ${grounded.candidateAccountId}): ${
            (error as Error).name || 'Error'
          }`,
      );
      throw this.unavailable();
    }

    if (!subject || !content) {
      // A structurally valid but empty draft is a failed generation, not a
      // result. Caching it would make the emptiness permanent.
      this.logger.warn(
        `Cover-letter generation returned an empty draft for job ${externalJobId}`,
      );
      throw this.unavailable();
    }

    const generatedAt = new Date();
    await this.cache.write(key, {
      subject,
      content,
      generatedAt: generatedAt.toISOString(),
    } satisfies CachedCoverLetter);

    return {
      jobId: externalJobId,
      version: COVER_LETTER_VERSION,
      locale,
      subject,
      content,
      cached: false,
      generatedAt,
    };
  }

  private async read(key: string): Promise<CachedCoverLetter | null> {
    const parsed = await this.cache.read<CachedCoverLetter>(key);
    if (!parsed?.subject || !parsed.content || !parsed.generatedAt) {
      return null;
    }
    return {
      subject: clip(parsed.subject, MAX_COVER_LETTER_SUBJECT_CHARS),
      content: clip(parsed.content, MAX_COVER_LETTER_CHARS),
      generatedAt: parsed.generatedAt,
    };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'The cover letter could not be generated right now.',
      code: AI_COVER_LETTER_UNAVAILABLE,
    });
  }
}

/** Trim, and clamp a runaway value. Never pads. */
function clip(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit).trimEnd();
}

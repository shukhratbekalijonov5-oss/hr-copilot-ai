import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { AiServiceClient } from '../../ai/ai-service.client';
import type { SupportedLocale } from '../../ai/ai-service.client';
import { ExternalPremiumAiContextService } from './external-premium-ai.context';
import { PremiumAiCacheService } from './premium-ai.cache';
import {
  AI_EXPLANATION_UNAVAILABLE,
  MAX_GAPS,
  MAX_STRENGTHS,
  WHY_MATCH_VERSION,
} from './external-premium-ai.policy';

export interface WhyMatchItem {
  title: string;
  explanation: string;
}

export interface WhyMatchResult {
  jobId: string;
  version: string;
  locale: SupportedLocale;
  summary: string;
  strengths: WhyMatchItem[];
  gaps: WhyMatchItem[];
  cached: boolean;
  generatedAt: Date;
}

/** What actually goes in Redis: the answer, plus when it was written. */
interface CachedWhyMatch {
  summary: string;
  strengths: WhyMatchItem[];
  gaps: WhyMatchItem[];
  generatedAt: string;
}

/**
 * "Why does this external job match me?" — generated once, then reused.
 *
 * ## The flow, and why it is lazy
 *
 * External search returns deterministic results immediately and calls nothing
 * here. A person then clicks one job and asks for the explanation, and only
 * that click reaches a model: one user action, one generation. Pre-generating
 * a page of twenty would multiply cost and latency by twenty to produce
 * nineteen paragraphs nobody opened.
 *
 * ## The cache key IS the Rule N1 mechanism
 *
 * The key contains a fingerprint of the candidate's current state (profile
 * revision, evidence revision, newest evidence timestamp, stated intent) and
 * of the job's canonical content revision. When a candidate edits their
 * headline or deletes a portfolio link, the fingerprint changes, the old key
 * is never looked up again, and the explanation written from the old profile
 * becomes unreachable rather than stale-but-served.
 *
 * TTL exists only so Redis eventually forgets entries nobody will ask for
 * again. Correctness never depends on it — an expiry that never fired would
 * still not serve a stale explanation. The key/read/write/locale plumbing is
 * shared with Cover Letter and Interview Prep (`PremiumAiCacheService`) so
 * the degradation contract cannot drift between features.
 *
 * ## Failure is contained
 *
 * This is the only surface that can fail when the model is down. Search,
 * detail, saved jobs and apply tracking never call this service, so a Gemini
 * outage costs a candidate one paragraph, not the product.
 */
@Injectable()
export class ExternalWhyMatchService {
  private readonly logger = new Logger(ExternalWhyMatchService.name);

  constructor(
    private readonly context: ExternalPremiumAiContextService,
    private readonly ai: AiServiceClient,
    private readonly cache: PremiumAiCacheService,
  ) {}

  /**
   * @param requestedLocale the caller's explicit choice, or undefined to use
   * the account's own preferred language. Resolved server-side either way —
   * the locale decides only what language the prose is written in, never what
   * facts it is written from.
   */
  async whyMatch(
    userId: string,
    externalJobId: string,
    requestedLocale?: SupportedLocale,
  ): Promise<WhyMatchResult> {
    // Throws 404 for an id that is not an external job, before any model or
    // cache work happens.
    const grounded = await this.context.load(userId, externalJobId);
    const locale =
      requestedLocale ?? (await this.cache.preferredLocale(userId));
    const key = this.cache.key(WHY_MATCH_VERSION, locale, grounded.fingerprint);

    const cached = await this.read(key);
    if (cached) {
      return {
        jobId: externalJobId,
        version: WHY_MATCH_VERSION,
        locale,
        summary: cached.summary,
        strengths: cached.strengths,
        gaps: cached.gaps,
        cached: true,
        generatedAt: new Date(cached.generatedAt),
      };
    }

    if (!this.ai.enabled) throw this.unavailable();

    let generated: {
      summary: string;
      strengths: WhyMatchItem[];
      gaps: WhyMatchItem[];
    };
    try {
      const response = await this.ai.externalWhyMatch({
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
      generated = {
        summary: (response.summary ?? '').trim(),
        // Bounded again on this side. The AI service already clamps; a
        // contract is not a place to trust one layer's discipline.
        strengths: bounded(response.strengths, MAX_STRENGTHS),
        gaps: bounded(response.gaps, MAX_GAPS),
      };
    } catch (error) {
      /*
       * The provider's own message never reaches a user: it can carry model
       * names, quota details and upstream URLs. The server-side log keeps the
       * error TYPE and the ids needed to investigate, and nothing else — no
       * prompt, no candidate text, no key.
       */
      this.logger.warn(
        `Why-match generation failed for job ${externalJobId} ` +
          `(account ${grounded.candidateAccountId}): ${
            (error as Error).name || 'Error'
          }`,
      );
      throw this.unavailable();
    }

    if (!generated.summary) {
      // A structurally valid but empty answer is a failed generation, not a
      // result. Caching it would make the emptiness permanent.
      this.logger.warn(
        `Why-match generation returned an empty summary for job ${externalJobId}`,
      );
      throw this.unavailable();
    }

    const generatedAt = new Date();
    await this.write(key, {
      summary: generated.summary,
      strengths: generated.strengths,
      gaps: generated.gaps,
      generatedAt: generatedAt.toISOString(),
    });

    return {
      jobId: externalJobId,
      version: WHY_MATCH_VERSION,
      locale,
      summary: generated.summary,
      strengths: generated.strengths,
      gaps: generated.gaps,
      cached: false,
      generatedAt,
    };
  }

  /** Shared plumbing validates JSON; the SHAPE is this feature's to check. */
  private async read(key: string): Promise<CachedWhyMatch | null> {
    const parsed = await this.cache.read<CachedWhyMatch>(key);
    if (!parsed?.summary || !parsed.generatedAt) return null;
    return {
      summary: parsed.summary,
      strengths: bounded(parsed.strengths, MAX_STRENGTHS),
      gaps: bounded(parsed.gaps, MAX_GAPS),
      generatedAt: parsed.generatedAt,
    };
  }

  private async write(key: string, value: CachedWhyMatch): Promise<void> {
    await this.cache.write(key, value);
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'The explanation could not be generated right now.',
      code: AI_EXPLANATION_UNAVAILABLE,
    });
  }
}

/** Drop half-empty items, clamp the rest. Never pad. */
function bounded(items: unknown, limit: number): WhyMatchItem[] {
  if (!Array.isArray(items)) return [];
  const out: WhyMatchItem[] = [];
  for (const item of items) {
    const record = item as Partial<WhyMatchItem> | null;
    const title = record?.title?.trim();
    const explanation = record?.explanation?.trim();
    if (!title || !explanation) continue;
    out.push({ title, explanation });
    if (out.length === limit) break;
  }
  return out;
}

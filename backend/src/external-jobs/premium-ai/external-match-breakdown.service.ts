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
  deriveBreakdownDimensions,
  type BreakdownDimension,
  type BreakdownStatus,
} from './match-breakdown.dimensions';
import {
  AI_MATCH_BREAKDOWN_UNAVAILABLE,
  MATCH_BREAKDOWN_VERSION,
  MAX_BREAKDOWN_DIMENSIONS,
  MAX_BREAKDOWN_VALUES,
} from './external-premium-ai.policy';

export interface MatchBreakdownDimension {
  key: string;
  label: string;
  status: BreakdownStatus;
  explanation: string;
  matched: string[];
  missing: string[];
}

export interface MatchBreakdownResult {
  jobId: string;
  version: string;
  locale: SupportedLocale;
  summary: string;
  dimensions: MatchBreakdownDimension[];
  cached: boolean;
  generatedAt: Date;
}

interface CachedBreakdown {
  summary: string;
  dimensions: MatchBreakdownDimension[];
  generatedAt: string;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'STRONG',
  'PARTIAL',
  'GAP',
  'UNKNOWN',
]);

/**
 * The Advanced Match Breakdown — the fifth and last MAX premium feature, and
 * the one where the deterministic/generated split is most explicit:
 *
 *   1. `ExternalPremiumAiContextService` loads the grounded context (same
 *      loader as why-match, cover letter, interview prep — no new loader).
 *   2. `deriveBreakdownDimensions` classifies every dimension STRONG /
 *      PARTIAL / GAP / UNKNOWN from stored values and the shared matchers'
 *      own raw verdicts. This happens HERE, deterministically, before any
 *      model exists in the story.
 *   3. Gemini contributes prose only: a summary and one explanation per
 *      decided dimension. Its response schema has no status field, so the
 *      classification cannot be overridden — a missing explanation falls
 *      back to the deterministic reason, never to invented text.
 *
 * Cache, locale, Rule N1 fingerprinting and failure containment are the
 * shared premium plumbing, unchanged.
 */
@Injectable()
export class ExternalMatchBreakdownService {
  private readonly logger = new Logger(ExternalMatchBreakdownService.name);

  constructor(
    private readonly context: ExternalPremiumAiContextService,
    private readonly ai: AiServiceClient,
    private readonly cache: PremiumAiCacheService,
  ) {}

  async matchBreakdown(
    userId: string,
    externalJobId: string,
    requestedLocale?: SupportedLocale,
  ): Promise<MatchBreakdownResult> {
    const grounded = await this.context.load(userId, externalJobId);
    const locale =
      requestedLocale ?? (await this.cache.preferredLocale(userId));
    const key = this.cache.key(
      MATCH_BREAKDOWN_VERSION,
      locale,
      grounded.fingerprint,
    );

    const cached = await this.read(key);
    if (cached) {
      return {
        jobId: externalJobId,
        version: MATCH_BREAKDOWN_VERSION,
        locale,
        summary: cached.summary,
        dimensions: cached.dimensions,
        cached: true,
        generatedAt: new Date(cached.generatedAt),
      };
    }

    if (!this.ai.enabled) throw this.unavailable();

    // Decided BEFORE the model is called, from the same context the model
    // will see. The derivation is pure and reads only stored facts.
    const decided = deriveBreakdownDimensions(grounded);

    let summary: string;
    let explanations: Map<string, string>;
    try {
      const response = await this.ai.externalMatchBreakdown({
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
        dimensions: decided,
      });
      summary =
        typeof response.summary === 'string' ? response.summary.trim() : '';
      explanations = new Map(
        (Array.isArray(response.explanations) ? response.explanations : [])
          .filter(
            (entry): entry is { key: string; explanation: string } =>
              typeof entry?.key === 'string' &&
              typeof entry?.explanation === 'string',
          )
          .map((entry) => [entry.key, entry.explanation.trim()]),
      );
    } catch (error) {
      this.logger.warn(
        `Match-breakdown generation failed for job ${externalJobId} ` +
          `(account ${grounded.candidateAccountId}): ${
            (error as Error).name || 'Error'
          }`,
      );
      throw this.unavailable();
    }

    if (!summary) {
      this.logger.warn(
        `Match-breakdown generation returned an empty summary for job ${externalJobId}`,
      );
      throw this.unavailable();
    }

    // Merge: the STATUS side is entirely ours; the model contributes only
    // the explanation, and only for keys we decided. A dimension the model
    // did not explain keeps its deterministic reason as the explanation.
    const dimensions = decided.map((dimension) =>
      toResponseDimension(dimension, explanations.get(dimension.key)),
    );

    const generatedAt = new Date();
    await this.cache.write(key, {
      summary,
      dimensions,
      generatedAt: generatedAt.toISOString(),
    } satisfies CachedBreakdown);

    return {
      jobId: externalJobId,
      version: MATCH_BREAKDOWN_VERSION,
      locale,
      summary,
      dimensions,
      cached: false,
      generatedAt,
    };
  }

  private async read(key: string): Promise<CachedBreakdown | null> {
    const parsed = await this.cache.read<CachedBreakdown>(key);
    if (!parsed?.summary || !parsed.generatedAt) return null;
    if (!Array.isArray(parsed.dimensions)) return null;
    const dimensions: MatchBreakdownDimension[] = [];
    for (const entry of parsed.dimensions) {
      if (
        !entry ||
        typeof entry.key !== 'string' ||
        typeof entry.label !== 'string' ||
        typeof entry.explanation !== 'string' ||
        !VALID_STATUSES.has(entry.status)
      ) {
        return null; // A malformed cache entry is a miss, never a guess.
      }
      dimensions.push({
        key: entry.key,
        label: entry.label,
        status: entry.status,
        explanation: entry.explanation,
        matched: stringList(entry.matched),
        missing: stringList(entry.missing),
      });
      if (dimensions.length === MAX_BREAKDOWN_DIMENSIONS) break;
    }
    return {
      summary: parsed.summary,
      dimensions,
      generatedAt: parsed.generatedAt,
    };
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'The match breakdown could not be generated right now.',
      code: AI_MATCH_BREAKDOWN_UNAVAILABLE,
    });
  }
}

function toResponseDimension(
  decided: BreakdownDimension,
  explanation: string | undefined,
): MatchBreakdownDimension {
  return {
    key: decided.key,
    label: decided.label,
    // The deterministic classification, verbatim. Nothing the model
    // returned can reach this field.
    status: decided.status,
    explanation: explanation || decided.reason,
    matched: decided.matched.slice(0, MAX_BREAKDOWN_VALUES),
    missing: decided.missing.slice(0, MAX_BREAKDOWN_VALUES),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, MAX_BREAKDOWN_VALUES);
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiServiceClient,
  type AiJobMatch,
  type AiCandidateProfile,
  type SupportedLocale,
} from '../ai/ai-service.client';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { VacancyStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';

/**
 * How many missing vacancies one ranking run will queue for re-indexing.
 *
 * Bounded so a large backlog cannot turn one candidate's page load into a
 * flood of queue jobs; the remainder is picked up by the next run.
 */
const MAX_RECONCILE_PER_RUN = 25;

/**
 * How long a PAGE request waits for freshly generated prose.
 *
 * Short on purpose. One batched call for twenty matches measured 11-44s
 * against the live provider, and a "show more" click that stalls that long is
 * a worse experience than a card showing its deterministic reason immediately.
 */
const EXPLANATION_WAIT_MS = 2_500;

/** Requirement rows come back from Json columns as `unknown`. */
function asChecks(
  value: unknown,
): { text: string; required: boolean; reason: string }[] {
  return Array.isArray(value)
    ? (value as { text: string; required: boolean; reason: string }[])
    : [];
}

/**
 * The candidate's ranked job list: computing it, storing it, paging through it.
 *
 * ## Why a stored snapshot
 *
 * Pagination has to mean "the next slice of the ranking you already have". If
 * page 2 were a fresh computation, a vacancy could appear on both pages or on
 * neither, and the list would reshuffle under the reader's scroll. So a run is
 * computed once, in full, and stored; pages are `LIMIT/OFFSET` over that.
 *
 * ## What decides the universe
 *
 * This service does, from the database: every OPEN vacancy. Not the vector
 * index. The index drifts — a cascade-deleted organization leaves its
 * vacancies' points behind, and 238 of the 391 "OPEN" entries in the index had
 * no OPEN row behind them — so it can accelerate retrieval but must never
 * decide what exists. Ranking every eligible id makes a stale point
 * unreachable rather than merely unlikely.
 *
 * ## When it recomputes
 *
 * On a change to either input, detected by comparing two cheap values:
 *
 *  - `evidenceRevision` — the candidate's files and links (already maintained
 *    by CandidateEvidenceLifecycleService);
 *  - `vacancyFingerprint` — the count of OPEN vacancies plus the latest
 *    mutation timestamp among them, so an opened, edited or closed vacancy
 *    invalidates without needing a per-vacancy event.
 *
 * Explanations are stored per locale on the ranking rows rather than as four
 * parallel rankings: the ranking compares evidence to requirements and is
 * locale-independent, so four copies of it could only drift apart.
 */
@Injectable()
export class JobMatchRankingService {
  private readonly logger = new Logger(JobMatchRankingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    private readonly producer: DocumentProcessingProducer,
  ) {}

  /**
   * Every vacancy this candidate may see.
   *
   * OPEN is the whole eligibility rule today: the public job board shows every
   * OPEN vacancy to every signed-in candidate, so there is no per-candidate
   * visibility to apply. Written as its own method because that is exactly
   * where a future rule (region, source, blocklist) belongs — and so a reader
   * can see there is no hidden filter here.
   */
  async eligibleVacancyIds(): Promise<string[]> {
    const rows = await this.prisma.vacancy.findMany({
      where: { status: VacancyStatus.OPEN },
      select: { id: true },
      // Deterministic, so the same catalogue produces the same request.
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /**
   * A cheap value that changes whenever the eligible catalogue changes.
   *
   * Count catches opening and closing; the latest `updatedAt` catches edits.
   * Together they miss only the case where a vacancy is edited and another
   * closed within the same millisecond, which recomputes on the next change.
   */
  async vacancyFingerprint(): Promise<string> {
    const [count, newest] = await Promise.all([
      this.prisma.vacancy.count({ where: { status: VacancyStatus.OPEN } }),
      this.prisma.vacancy.findFirst({
        where: { status: VacancyStatus.OPEN },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    return `${count}:${newest?.updatedAt.toISOString() ?? 'none'}`;
  }

  /** The stored ranking, if it still describes the current inputs. */
  async currentRun(
    candidateAccountId: string,
    evidenceRevision: number,
    fingerprint: string,
  ) {
    const run = await this.prisma.candidateJobMatchRun.findUnique({
      where: { candidateAccountId },
      select: {
        id: true,
        evidenceRevision: true,
        vacancyFingerprint: true,
        totalRanked: true,
        totalEligible: true,
        capability: true,
        generatedAt: true,
      },
    });
    if (!run) return null;
    if (run.evidenceRevision !== evidenceRevision) return null;
    if (run.vacancyFingerprint !== fingerprint) return null;
    return run;
  }

  /**
   * Runs the full ranking and replaces the candidate's stored snapshot.
   *
   * The replacement is a delete-then-insert inside one transaction: a reader
   * paging through the old run must never see half of it merged with half of
   * the new one.
   */
  async computeRun(input: {
    candidateAccountId: string;
    profile: AiCandidateProfile;
    locale: SupportedLocale;
    evidenceRevision: number;
    allowedSourceIds: string[];
    explainLimit: number;
  }) {
    const [eligible, fingerprint] = await Promise.all([
      this.eligibleVacancyIds(),
      this.vacancyFingerprint(),
    ]);

    const result = await this.ai.candidateJobMatches({
      candidateAccountId: input.candidateAccountId,
      profile: input.profile,
      locale: input.locale,
      eligibleVacancyIds: eligible,
      // Prose for the first page only; the rest is ranked either way and gets
      // its explanation when the reader actually scrolls to it.
      explainOffset: 0,
      explainLimit: input.explainLimit,
      allowedSourceIds: input.allowedSourceIds,
    });

    const runId = await this.prisma.$transaction(async (tx) => {
      await tx.candidateJobMatchRun.deleteMany({
        where: { candidateAccountId: input.candidateAccountId },
      });
      const run = await tx.candidateJobMatchRun.create({
        data: {
          candidateAccountId: input.candidateAccountId,
          evidenceRevision: input.evidenceRevision,
          vacancyFingerprint: fingerprint,
          totalRanked: result.matches.length,
          totalEligible: result.eligibleConsidered ?? eligible.length,
          capability: (result.capability ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      if (result.matches.length > 0) {
        await tx.candidateJobMatchEntry.createMany({
          data: result.matches.map((match) =>
            this.toEntry(run.id, match, input.locale),
          ),
        });
      }
      return run.id;
    });

    this.logger.log(
      `Ranked ${result.matches.length} vacancy/vacancies for candidate account ` +
        `${input.candidateAccountId} (eligible ${eligible.length}, ` +
        `indexed ${result.vacanciesConsidered}, ${result.durationMs}ms)`,
    );

    // An eligible vacancy that never reached the index cannot be ranked, and
    // silently dropping it is the failure this whole rewrite is about. Queue
    // a re-sync so the gap closes itself: this run is still short, the next
    // one is not.
    //
    // Vacancy CRUD already queues a sync on every mutation, so a gap means
    // something bypassed it — a cascade delete's sibling rows, a queue outage,
    // or a vacancy that predates the index. Reconciling here beats waiting for
    // someone to notice.
    await this.reconcileMissing(
      eligible,
      new Set(result.matches.map((match) => match.vacancyId)),
    );

    return {
      runId,
      totalRanked: result.matches.length,
      totalEligible: eligible.length,
      indexedConsidered: result.vacanciesConsidered,
      capability: result.capability ?? {},
      generated: result.generated,
      fingerprint,
    };
  }

  /**
   * Queues indexing for eligible vacancies the ranking could not see.
   *
   * Best effort and bounded: a large backlog is queued a batch at a time so
   * one candidate's page load cannot flood the worker. Failure is logged, not
   * raised — the ranking that WAS produced is still correct and useful.
   */
  private async reconcileMissing(
    eligible: string[],
    ranked: Set<string>,
  ): Promise<void> {
    const missing = eligible.filter((id) => !ranked.has(id));
    if (missing.length === 0) return;

    const batch = missing.slice(0, MAX_RECONCILE_PER_RUN);
    this.logger.warn(
      `${missing.length} eligible vacancy/vacancies were not in the job index; ` +
        `queueing ${batch.length} for re-indexing`,
    );
    await Promise.all(
      batch.map((vacancyId) =>
        this.producer
          .enqueueVacancyIndexSync({ vacancyId })
          .catch(() => undefined),
      ),
    );
  }

  private toEntry(
    runId: string,
    match: AiJobMatch,
    locale: SupportedLocale,
  ): Prisma.CandidateJobMatchEntryCreateManyInput {
    return {
      runId,
      vacancyId: match.vacancyId,
      rank: match.rank,
      score: match.score,
      tier: match.match,
      signals: match.signals ?? {},
      matchedSkills: match.matchedSkills ?? [],
      missingSkills: match.missingSkills ?? [],
      supportedRequirements:
        match.supportedRequirements as unknown as Prisma.InputJsonValue,
      unsupportedRequirements:
        match.unsupportedRequirements as unknown as Prisma.InputJsonValue,
      unclearRequirements:
        match.unclearRequirements as unknown as Prisma.InputJsonValue,
      evidence: match.evidence as unknown as Prisma.InputJsonValue,
      // Only the explained window arrives with prose; the rest is filled in
      // when a reader pages to it.
      explanations: match.explanation
        ? { [locale]: match.explanation }
        : Prisma.DbNull,
    };
  }

  /**
   * One page of a stored ranking, ordered by rank.
   *
   * Ordered by `rank` rather than re-sorting by score, because rank is the
   * order the run committed to — re-deriving it on every page would risk two
   * pages disagreeing about equal scores.
   */
  async page(runId: string, skip: number, take: number) {
    return this.prisma.candidateJobMatchEntry.findMany({
      where: { runId },
      orderBy: { rank: 'asc' },
      skip,
      take,
    });
  }

  /**
   * Prose for the entries on ONE page, in one locale.
   *
   * Reads what is already stored first and only asks the model about entries
   * that have nothing in this locale yet, so revisiting a page — or switching
   * back to a language already generated — costs nothing.
   *
   * Failure is swallowed on purpose: the ranking is deterministic and already
   * stored, and a provider hiccup must not turn a good page of results into an
   * error. The cards render without prose, which the response reports honestly
   * through `generated`.
   */
  async explainPage(
    entries: {
      id: string;
      vacancyId: string;
      tier: string;
      matchedSkills: string[];
      missingSkills: string[];
      supportedRequirements: unknown;
      unsupportedRequirements: unknown;
      unclearRequirements: unknown;
      explanations: unknown;
    }[],
    locale: SupportedLocale,
    /**
     * How long to wait for FRESH prose before serving the page without it.
     *
     * The initial run waits properly — the candidate pressed "Find my matches"
     * and expects to. A "show more" click does not: it takes what is ready,
     * and the background write means the next look has the rest.
     */
    waitMs = EXPLANATION_WAIT_MS,
  ): Promise<{ prose: Map<string, string>; pending: boolean }> {
    const resolved = new Map<string, string>();
    const missing: typeof entries = [];

    for (const entry of entries) {
      const stored = (entry.explanations ?? {}) as Record<string, string>;
      const text = stored[locale];
      if (text) resolved.set(entry.vacancyId, text);
      else missing.push(entry);
    }
    // `pending` is what lets the UI say "still being written" instead of
    // "unavailable". They look the same from a card's point of view and mean
    // opposite things to a reader.
    if (missing.length === 0) return { prose: resolved, pending: false };
    if (!this.ai.enabled) return { prose: resolved, pending: false };

    // Titles come from the database rather than the ranking row, so the prose
    // always names the job by its CURRENT title.
    const titles = new Map(
      (
        await this.prisma.vacancy.findMany({
          where: { id: { in: missing.map((entry) => entry.vacancyId) } },
          select: { id: true, title: true },
        })
      ).map((vacancy) => [vacancy.id, vacancy.title]),
    );

    /*
      Generation is STARTED here, persisted whenever it lands, and waited on
      only briefly.

      One batched call for twenty matches measured 11-44 seconds against the
      live provider. Blocking a "show more" click on that turns scrolling into
      a series of long stalls — while the deterministic half of a match card
      (score, tier, matched technologies, which requirements are supported and
      which are not) is ready instantly and IS the match reason. So the page is
      served with whatever prose exists, the rest is written in the background,
      and the next look has it. Nothing is lost and nothing waits.

      The initial run is unaffected: its first page is explained inside the
      ranking call, so by the time this runs that prose is already stored.
    */
    const write: Promise<Record<string, string>> = this.ai
      .matchExplanations({
        locale,
        items: missing.map((entry) => ({
          vacancyId: entry.vacancyId,
          title: titles.get(entry.vacancyId) ?? '',
          match: entry.tier as 'STRONG' | 'PARTIAL' | 'WEAK',
          matchedSkills: entry.matchedSkills,
          missingSkills: entry.missingSkills,
          supportedRequirements: asChecks(entry.supportedRequirements),
          unsupportedRequirements: asChecks(entry.unsupportedRequirements),
          unclearRequirements: asChecks(entry.unclearRequirements),
        })),
      })
      .then(async (response) => {
        const generated = response.explanations ?? {};
        await Promise.all(
          missing.map(async (entry) => {
            const text = generated[entry.vacancyId];
            if (!text) return;
            const stored = (entry.explanations ?? {}) as Record<string, string>;
            await this.prisma.candidateJobMatchEntry
              .update({
                where: { id: entry.id },
                data: { explanations: { ...stored, [locale]: text } },
              })
              .catch(() => undefined);
          }),
        );
        return generated;
      })
      .catch((error: unknown) => {
        // The ranking is already stored and correct; a provider outage costs
        // prose, never the page.
        this.logger.warn(
          `Explanations unavailable for this page: ${(error as Error).message}`,
        );
        return {};
      });

    const generated: Record<string, string> = await Promise.race([
      write,
      new Promise<Record<string, string>>((resolve) => {
        setTimeout(() => resolve({}), waitMs);
      }),
    ]);
    for (const entry of missing) {
      const text = generated[entry.vacancyId];
      if (text) resolved.set(entry.vacancyId, text);
    }
    // Anything still absent is being written in the background right now, or
    // failed and will be retried on the next visit. Either way "not here yet"
    // is the truthful thing to tell the reader.
    return {
      prose: resolved,
      pending: missing.some((entry) => !resolved.has(entry.vacancyId)),
    };
  }

  /** Discards a candidate's ranking. Used when their evidence changes. */
  async invalidate(candidateAccountId: string): Promise<void> {
    await this.prisma.candidateJobMatchRun
      .deleteMany({ where: { candidateAccountId } })
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not invalidate the job-match ranking for ${candidateAccountId}: ` +
            `${(error as Error).message}`,
        );
      });
  }
}

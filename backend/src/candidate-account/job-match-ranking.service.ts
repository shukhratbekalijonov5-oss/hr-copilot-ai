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
import type { CandidateJobIntent } from '../candidate-preferences/candidate-job-intent';
import {
  RANKING_VACANCY_SELECT,
  normalizedJobFeatures,
  type NormalizedJobFeatures,
  type RankingVacancyRow,
} from '../matching/normalized-job-features';
import {
  partitionByHardConstraints,
  type HardConstraintPartition,
} from '../matching/hard-constraints';
import {
  alignIntent,
  type IntentAlignment,
} from '../matching/intent-alignment';
import {
  MATCH_ALGORITHM_VERSION,
  canonicalScore,
  compareRanked,
  intentScoreFrom,
} from '../matching/match-policy';
import {
  intentFingerprint,
  vacancyRankingFingerprint,
} from '../matching/ranking-fingerprint';
import { FxRateService } from '../fx/fx-rate.service';
import type { RateTable } from '../fx/money';

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

/**
 * How many prose generations may be in flight across the whole process.
 *
 * Measured, not guessed: the AI service runs a single uvicorn worker, and one
 * batched explanation call for twenty matches takes 11-44 seconds. Paging
 * through a 154-job ranking used to start a background generation per page,
 * so eight of them piled onto that one worker and the NEXT ranking request
 * timed out at 120 seconds — a candidate's search failing because someone was
 * scrolling. Prose is optional enrichment; ranking is the product. So
 * generation is capped, and over the cap a page simply renders with the
 * deterministic reasons it already has.
 */
const MAX_CONCURRENT_EXPLANATIONS = 2;

/**
 * Entries handed to the model in one request.
 *
 * A page may legitimately be 50 rows; explaining fifty at once is a long call
 * whose tail nobody reads before scrolling on. The rest keep their
 * deterministic reasons and get prose on a later visit.
 */
const MAX_EXPLAINED_PER_REQUEST = 20;

/**
 * One load of the OPEN catalogue: the raw ranking-relevant rows, their
 * provider-neutral normalization, and the fingerprint of that exact state.
 */
export interface RankingUniverse {
  rows: RankingVacancyRow[];
  features: NormalizedJobFeatures[];
  fingerprint: string;
}

/** One vacancy after capability and intent have been combined, pre-rank. */
interface CombinedEntry {
  match: AiJobMatch;
  alignments: IntentAlignment[];
  capabilityScore: number;
  intentScore: number | null;
  canonicalScore: number;
}

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
 * On a change to ANY ranking input, detected by comparing stored values:
 *
 *  - `evidenceRevision` — the candidate's files and links (already maintained
 *    by CandidateEvidenceLifecycleService);
 *  - `vacancyFingerprint` — a semantic hash of every ranking-relevant field
 *    of the OPEN catalogue, so an opened, closed or meaningfully edited
 *    vacancy invalidates while a display-only edit does not;
 *  - `intentFingerprint` — a semantic hash of the candidate's CURRENT job
 *    preferences. Preferences are current-only (Rule N1): the instant they
 *    change, the old snapshot — scores, order, and every stored alignment
 *    reason — becomes unreachable and the next request recomputes;
 *  - `algorithmVersion` — a weights or logic change strands every stored run
 *    even when no data moved.
 *
 * Explanations are stored per locale on the ranking rows rather than as four
 * parallel rankings: the ranking compares evidence to requirements and is
 * locale-independent, so four copies of it could only drift apart.
 */
@Injectable()
export class JobMatchRankingService {
  private readonly logger = new Logger(JobMatchRankingService.name);
  /** Prose generations currently running. See MAX_CONCURRENT_EXPLANATIONS. */
  private explanationsInFlight = 0;

  /**
   * Ranking computations in progress, by candidate account.
   *
   * Concurrent callers for the same candidate share one run rather than each
   * starting their own. See computeRun.
   */
  private readonly runsInFlight = new Map<
    string,
    Promise<
      Awaited<ReturnType<JobMatchRankingService['computeRunUncoordinated']>>
    >
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    private readonly producer: DocumentProcessingProducer,
    private readonly fx: FxRateService,
  ) {}

  /**
   * The candidate's whole job universe: every OPEN vacancy, with the exact
   * fields the ranking reads, plus the fingerprint of that state.
   *
   * OPEN is the whole BUSINESS eligibility rule today: the public job board
   * shows every OPEN vacancy to every signed-in candidate, so there is no
   * per-candidate visibility to apply here. The only thing that shrinks this
   * set afterwards is the candidate's own explicit exclusions
   * (`partitionByHardConstraints`, in computeRun) — never a score, never a
   * similarity threshold, never the vector index. One query serves three
   * needs at once: the fingerprint for staleness checks, the features for
   * hard constraints and intent alignment, and the id list handed to the
   * ranker — so all three describe the same instant of the catalogue.
   */
  async loadUniverse(): Promise<RankingUniverse> {
    const rows = (await this.prisma.vacancy.findMany({
      where: { status: VacancyStatus.OPEN },
      select: RANKING_VACANCY_SELECT,
      // Deterministic, so the same catalogue produces the same request.
      orderBy: { id: 'asc' },
    })) as RankingVacancyRow[];
    return {
      rows,
      features: rows.map(normalizedJobFeatures),
      fingerprint: vacancyRankingFingerprint(rows),
    };
  }

  /**
   * The current rate snapshot, for surfaces that display converted pay.
   *
   * Exposed here rather than injecting FxRateService in three more places, so
   * "which rates is the product using" has one answer on the candidate side.
   */
  async fxSnapshot() {
    return this.fx.current();
  }

  /** The candidate's current intent hash — Rule N1's key into the cache. */
  intentHash(intent: CandidateJobIntent): string {
    return intentFingerprint(intent);
  }

  /**
   * The stored ranking, if it still describes the current inputs — the
   * candidate's evidence, the candidate's CURRENT intent, the
   * ranking-relevant catalogue state, and the algorithm itself. A mismatch on
   * ANY of the four means the snapshot describes a world that no longer
   * exists, and it is never served: this is where a Seoul-era ranking dies
   * the moment the candidate's intent says Toronto.
   */
  async currentRun(
    candidateAccountId: string,
    evidenceRevision: number,
    fingerprint: string,
    intentHash: string,
  ) {
    const run = await this.prisma.candidateJobMatchRun.findUnique({
      where: { candidateAccountId },
      select: {
        id: true,
        evidenceRevision: true,
        vacancyFingerprint: true,
        intentFingerprint: true,
        algorithmVersion: true,
        fxSnapshotVersion: true,
        fxFetchedAt: true,
        totalRanked: true,
        totalEligible: true,
        totalExcluded: true,
        capability: true,
        generatedAt: true,
      },
    });
    if (!run) return null;
    if (run.evidenceRevision !== evidenceRevision) return null;
    if (run.vacancyFingerprint !== fingerprint) return null;
    if (run.intentFingerprint !== intentHash) return null;
    if (run.algorithmVersion !== MATCH_ALGORITHM_VERSION) return null;
    return run;
  }

  /**
   * Runs the full ranking and replaces the candidate's stored snapshot.
   *
   * The pipeline, in the order the invariants demand:
   *
   *  1. HARD CONSTRAINTS carve the universe — the candidate's own explicit
   *     exclusions (company / title / structured location), exact-match only.
   *     This is the ONLY place a job leaves the rankable set. What remains is
   *     `totalEligible`, and every one of them WILL be in the stored ranking.
   *  2. The ai-service scores CAPABILITY for every eligible id — the same
   *     five evidence signals as before, unchanged by this version.
   *  3. INTENT alignment runs here, per vacancy, against the candidate's
   *     current intent (resolved once by the caller — never per-vacancy).
   *  4. The canonical score combines the two (capability-dominant, see
   *     match-policy.ts) and decides ORDER, never existence: a 0/100 entry is
   *     stored and paginatable like any other.
   *  5. An eligible vacancy the index could not rank (a sync gap) is NOT
   *     dropped: it enters the ranking with zero capability signal and its
   *     real intent alignment, sinks to the bottom, and a re-index is queued.
   *     Qdrant accelerates scoring; it never defines the universe.
   *
   * The replacement is a delete-then-insert inside one transaction: a reader
   * paging through the old run must never see half of it merged with half of
   * the new one.
   */
  /**
   * One ranking per candidate at a time.
   *
   * Two tabs, a double-click on "Find my matches", or a page that prefetches
   * while the reader clicks all arrive together — and after a preference
   * change every one of them sees a stale fingerprint and starts its own
   * recompute. That used to mean N identical 155-vacancy runs against a
   * single-worker model, and then a 500: each transaction deleted a row none
   * of the others could see yet, and the second INSERT hit the one-run-per-
   * candidate unique index.
   *
   * Sharing the in-flight promise fixes both halves. The first caller does the
   * work, the rest await the same answer, and identical inputs cannot produce
   * conflicting rows because only one write happens.
   */
  async computeRun(input: {
    candidateAccountId: string;
    profile: AiCandidateProfile;
    locale: SupportedLocale;
    evidenceRevision: number;
    allowedSourceIds: string[];
    explainLimit: number;
    universe: RankingUniverse;
    intent: CandidateJobIntent;
  }) {
    /*
     * Keyed by the INPUTS, not just the candidate: two callers only share an
     * answer when they would have computed the same one. If the reader changed
     * a preference between the two requests the fingerprints differ, so the
     * second caller does its own run and gets a ranking built from what it
     * actually asked about — never a neighbour's stale intent.
     */
    const key = [
      input.candidateAccountId,
      input.evidenceRevision,
      input.universe.fingerprint,
      intentFingerprint(input.intent),
      input.locale,
    ].join('|');

    const inFlight = this.runsInFlight.get(key);
    if (inFlight) return inFlight;

    const started = this.computeRunUncoordinated(input).finally(() => {
      this.runsInFlight.delete(key);
    });
    this.runsInFlight.set(key, started);
    return started;
  }

  private async computeRunUncoordinated(input: {
    candidateAccountId: string;
    profile: AiCandidateProfile;
    locale: SupportedLocale;
    evidenceRevision: number;
    allowedSourceIds: string[];
    explainLimit: number;
    universe: RankingUniverse;
    intent: CandidateJobIntent;
  }) {
    const partition = partitionByHardConstraints(
      input.universe.features,
      input.intent,
    );
    const eligibleIds = partition.eligible.map((f) => f.jobId);
    const intentHash = intentFingerprint(input.intent);

    /*
     * Exchange rates: read ONCE for the whole run, never per vacancy.
     *
     * Ranking 154 jobs must cost zero provider calls — the snapshot is
     * refreshed on a schedule and simply read here. `ensureSnapshot` fetches
     * only when nothing usable is cached, and even then only one caller wins
     * the lock. A null table is a perfectly good outcome: same-currency
     * salaries still compare, and cross-currency ones report NOT_COMPARABLE
     * without changing a single job's eligibility.
     */
    const fxView = input.intent.compensation
      ? await this.fx.ensureSnapshot()
      : {
          snapshot: null as {
            snapshotVersion: string;
            fetchedAt: string;
          } | null,
          table: null as RateTable | null,
        };

    const result = await this.ai.candidateJobMatches({
      candidateAccountId: input.candidateAccountId,
      profile: input.profile,
      locale: input.locale,
      eligibleVacancyIds: eligibleIds,
      // Prose for the first page only; the rest is ranked either way and gets
      // its explanation when the reader actually scrolls to it.
      explainOffset: 0,
      explainLimit: input.explainLimit,
      allowedSourceIds: input.allowedSourceIds,
    });

    const ranked = this.combine(
      partition,
      result.matches,
      input.intent,
      fxView.table,
    );

    /*
     * Replace this candidate's run.
     *
     * The in-flight map above serializes this process, but a second API
     * instance has its own map and no knowledge of ours. Both would then
     * delete a row the other cannot see yet and both would INSERT, and one
     * loses on the unique index. Losing that race is harmless — the winner
     * stored a ranking computed from the same current state — so it is
     * retried once rather than surfaced as a failed job search.
     */
    const persist = () =>
      this.prisma.$transaction(async (tx) => {
        await tx.candidateJobMatchRun.deleteMany({
          where: { candidateAccountId: input.candidateAccountId },
        });
        const run = await tx.candidateJobMatchRun.create({
          data: {
            candidateAccountId: input.candidateAccountId,
            evidenceRevision: input.evidenceRevision,
            vacancyFingerprint: input.universe.fingerprint,
            intentFingerprint: intentHash,
            algorithmVersion: MATCH_ALGORITHM_VERSION,
            totalRanked: ranked.length,
            totalEligible: eligibleIds.length,
            totalExcluded: partition.excluded.length,
            excluded: partition.excluded,
            // Which rates this ranking's salary figures came from. Recorded so
            // the numbers a candidate reads and the numbers that produced the
            // order are provably the same ones — never re-derived later against
            // a newer table.
            fxSnapshotVersion: fxView.snapshot?.snapshotVersion ?? null,
            fxFetchedAt: fxView.snapshot?.fetchedAt
              ? new Date(fxView.snapshot.fetchedAt)
              : null,
            capability: (result.capability ?? {}) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });

        if (ranked.length > 0) {
          await tx.candidateJobMatchEntry.createMany({
            data: ranked.map((entry, index) =>
              this.toEntry(run.id, entry, index + 1, input.locale),
            ),
          });
        }
        return run.id;
      });

    let runId: string;
    try {
      runId = await persist();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      // The other writer has committed by now, so the delete can see its row.
      this.logger.warn(
        `Concurrent ranking write for candidate account ` +
          `${input.candidateAccountId}; retrying once`,
      );
      runId = await persist();
    }

    this.logger.log(
      `Ranked ${ranked.length} vacancy/vacancies for candidate account ` +
        `${input.candidateAccountId} (eligible ${eligibleIds.length}, ` +
        `hard-excluded ${partition.excluded.length}, ` +
        `indexed ${result.vacanciesConsidered}, ${result.durationMs}ms)`,
    );

    // An eligible vacancy that never reached the index is ranked anyway (with
    // no capability signal), but the gap should still heal. Queue a re-sync:
    // vacancy CRUD already queues one on every mutation, so a gap means
    // something bypassed it — a cascade delete's sibling rows, a queue outage,
    // or a vacancy that predates the index.
    await this.reconcileMissing(
      eligibleIds,
      new Set(result.matches.map((match) => match.vacancyId)),
    );

    return {
      runId,
      totalRanked: ranked.length,
      totalEligible: eligibleIds.length,
      totalExcluded: partition.excluded.length,
      indexedConsidered: result.vacanciesConsidered,
      capability: result.capability ?? {},
      generated: result.generated,
      fingerprint: input.universe.fingerprint,
      intentFingerprint: intentHash,
    };
  }

  /**
   * Capability results + current intent → the full canonical ranking.
   *
   * Every eligible vacancy comes out exactly once: scored ones carry their
   * evidence analysis, index-gap ones carry zero capability and empty
   * evidence (never invented), and both get real intent alignment. Sorting is
   * the one comparator in match-policy.ts — canonical desc, then capability,
   * then intent, then vacancyId — so equal scores cannot swap between pages.
   */
  private combine(
    partition: HardConstraintPartition,
    matches: AiJobMatch[],
    intent: CandidateJobIntent,
    fxTable: RateTable | null,
  ): CombinedEntry[] {
    const featureById = new Map(
      partition.eligible.map((features) => [features.jobId, features]),
    );
    const combined: CombinedEntry[] = [];

    for (const match of matches) {
      const features = featureById.get(match.vacancyId);
      // Not in the eligible set (defensive: the ranker is fetch-by-id, so
      // this would mean a contract break) — never resurrect an excluded job.
      if (!features) continue;
      featureById.delete(match.vacancyId);
      const alignments = alignIntent(features, intent, fxTable);
      const intentScore = intentScoreFrom(alignments);
      combined.push({
        match,
        alignments,
        capabilityScore: match.score,
        intentScore,
        canonicalScore: canonicalScore(match.score, intentScore),
      });
    }

    // Whatever the index could not see still exists. LOW MATCH ≠ HIDDEN JOB
    // applies even to a vacancy with no capability signal yet: it ranks at
    // the bottom honestly (zero evidence signal, empty analysis) instead of
    // vanishing because a sync job hasn't run.
    for (const features of featureById.values()) {
      const alignments = alignIntent(features, intent, fxTable);
      const intentScore = intentScoreFrom(alignments);
      combined.push({
        match: {
          vacancyId: features.jobId,
          organizationId: '',
          title: features.title,
          match: 'WEAK',
          score: 0,
          rank: 0,
          signals: {},
          matchedSkills: [],
          missingSkills: [],
          explanation: null,
          supportedRequirements: [],
          unsupportedRequirements: [],
          unclearRequirements: [],
          evidence: [],
        },
        alignments,
        capabilityScore: 0,
        intentScore,
        canonicalScore: canonicalScore(0, intentScore),
      });
    }

    combined.sort((a, b) =>
      compareRanked(
        { vacancyId: a.match.vacancyId, ...a },
        { vacancyId: b.match.vacancyId, ...b },
      ),
    );
    return combined;
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
    entry: CombinedEntry,
    rank: number,
    locale: SupportedLocale,
  ): Prisma.CandidateJobMatchEntryCreateManyInput {
    const match = entry.match;
    return {
      runId,
      vacancyId: match.vacancyId,
      rank,
      // The CANONICAL score — order, never existence. `tier` stays derived
      // from capability: the label narrates what the evidence showed, and a
      // preference match must not dress a weak-evidence job up as STRONG.
      score: entry.canonicalScore,
      capabilityScore: entry.capabilityScore,
      intentScore: entry.intentScore,
      alignments: entry.alignments as unknown as Prisma.InputJsonValue,
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

    /*
     * THE CONCURRENCY GATE.
     *
     * Over the cap, this page is served from what is already stored and asks
     * for nothing new. That is a deliberate trade: the deterministic reasons
     * (band, score, which requirements are supported, which preference
     * dimensions matched and why) are already on the card and are the primary
     * explanation — prose only says it in sentences. Letting a scroll queue
     * up generations behind a single-worker model is how one candidate's
     * browsing made another candidate's ranking time out.
     */
    // Check AND reserve in the same synchronous step. Reserving later — after
    // the title lookup below, say — would let every concurrent caller read a
    // count of zero before any of them incremented it, and the gate would
    // admit all of them.
    if (this.explanationsInFlight >= MAX_CONCURRENT_EXPLANATIONS) {
      this.logger.debug?.(
        `Explanation generation at capacity (${this.explanationsInFlight}); ` +
          'serving this page from stored prose only',
      );
      return { prose: resolved, pending: true };
    }
    this.explanationsInFlight += 1;

    // One request, one bounded batch. Anything beyond it keeps its
    // deterministic reasons and gets prose on a later visit.
    const batch = missing.slice(0, MAX_EXPLAINED_PER_REQUEST);

    // Titles come from the database rather than the ranking row, so the prose
    // always names the job by its CURRENT title.
    let titles: Map<string, string>;
    try {
      titles = new Map(
        (
          await this.prisma.vacancy.findMany({
            where: { id: { in: batch.map((entry) => entry.vacancyId) } },
            select: { id: true, title: true },
          })
        ).map((vacancy) => [vacancy.id, vacancy.title]),
      );
    } catch (error) {
      // Give the slot back: a failed lookup must not permanently consume one
      // of the two generation slots for the life of the process.
      this.explanationsInFlight = Math.max(0, this.explanationsInFlight - 1);
      this.logger.warn(
        `Could not read vacancy titles for explanations: ${(error as Error).message}`,
      );
      return { prose: resolved, pending: true };
    }

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
        items: batch.map((entry) => ({
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
          batch.map(async (entry) => {
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
      })
      .finally(() => {
        // Released when the generation actually finishes, not when the
        // response is sent — the whole point is to bound what is RUNNING.
        this.explanationsInFlight = Math.max(0, this.explanationsInFlight - 1);
      });

    const generated: Record<string, string> = await Promise.race([
      write,
      new Promise<Record<string, string>>((resolve) => {
        setTimeout(() => resolve({}), waitMs);
      }),
    ]);
    for (const entry of batch) {
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

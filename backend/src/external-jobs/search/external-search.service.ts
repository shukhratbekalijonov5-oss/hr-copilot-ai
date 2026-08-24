import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { AiServiceClient } from '../../ai/ai-service.client';
import { FxRateService } from '../../fx/fx-rate.service';
import { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import { resolveJobSearchIntent } from '../../candidate-preferences/job-search-context';
import { intentFingerprint } from '../../matching/ranking-fingerprint';
import { evaluateHardConstraints } from '../../matching/hard-constraints';
import type { SearchSecondaryFilters } from '../../matching/search-alignment';
import {
  ExternalSearchRetrieval,
  LEXICAL_LIMIT,
  MAX_CANDIDATES,
  SEMANTIC_LIMIT,
  type ExternalSearchRow,
  type ExternalSearchScope,
} from './external-search.retrieval';
import {
  rankExternalJobs,
  searchRowFeatures,
  type ScoredExternalJob,
} from './external-search.ranking';
import {
  DEFAULT_EXTERNAL_SEARCH_SORT,
  EXTERNAL_SEARCH_ALGORITHM_VERSION,
  type ExternalSearchSort,
} from './external-search.policy';
import type { ExternalJobSearchDto } from './dto/external-job-search.dto';
import type { CandidateJobIntent } from '../../candidate-preferences/candidate-job-intent';
import {
  CandidateExternalFlagsService,
  type ExternalTrackingSummary,
} from '../candidate/candidate-external-flags.service';

/**
 * Candidate-facing search over the external job catalogue.
 *
 * ## The pipeline, and what owns each step
 *
 *     saved preferences + this request
 *       → resolved intent            (CandidatePreferencesService — shared)
 *       → hard scope                 (query + explicit countries only)
 *       → indexed retrieval          (Postgres lexical ∪ Qdrant semantic)
 *       → PostgreSQL revalidation    ← the only authority on existence
 *       → deterministic ranking      (shared matchers + versioned policy)
 *       → stored snapshot            ← the only thing pagination reads
 *
 * ## Three invariants worth stating outright
 *
 * **Postgres decides what exists.** Qdrant is a way to avoid scoring a
 * million jobs, and nothing more. Every id it proposes is re-read from
 * Postgres under the same status and location predicates before anyone sees
 * it, so a point left behind by a job that closed an hour ago produces
 * nothing at all.
 *
 * **Nothing here asks a model anything.** Not what the query means, not which
 * jobs are relevant, not how to order them, not how to explain them. The
 * embedding is a similarity function over stored text; every decision made
 * from its output is arithmetic in this file and in the policy module.
 *
 * **Saved preferences rank; they never hide.** The only inputs that shrink
 * the universe are the text the candidate typed, the countries they chose for
 * this search, and their own explicit exclusions. A saved preferred country,
 * work mode, employment type, seniority or salary floor changes the ORDER of
 * the same list. Reintroducing the alternative — a saved city silently
 * filtering a search — is a bug this product has already fixed once on the
 * internal side, and the whole hard/soft split exists to keep it fixed.
 */

/** How long a stored search stays reusable. A search is a moment. */
const SNAPSHOT_TTL_MS = 30 * 60_000;

export interface ExternalSearchPage {
  runId: string;
  algorithmVersion: string;
  /** The order actually applied. Echoed so a UI never has to infer it. */
  sort: ExternalSearchSort;
  /**
   * When this response was produced.
   *
   * Relative ages — "Posted 3 days ago" — are measured against THIS, not
   * against whatever clock the renderer happens to read. Two reasons, and the
   * second is the load-bearing one: it ties the wording to the moment the data
   * was computed, and it gives a server-rendered page and its browser
   * hydration one shared reference. Reading the clock in a component instead
   * lets the two passes disagree across a midnight boundary, which React
   * reports as a hydration mismatch and this app has already paid for once.
   */
  asOf: Date;
  /** What was actually applied, so a UI can show it back honestly. */
  applied: {
    query: string | null;
    countries: { value: string[]; source: string };
    workModes: { value: string[]; source: string };
    employmentTypes: { value: string[]; source: string };
    seniorityLevels: { value: string[]; source: string };
    compensation: { stated: boolean; source: string };
  };
  /**
   * How many results this snapshot holds — exactly what pagination covers.
   *
   * NOT the number of jobs matching the filters, which is `matched`. A pager
   * built on the larger number would offer pages that do not exist.
   */
  total: number;
  /**
   * How many jobs answer the hard constraints, counted in the database.
   *
   * Usually larger than `total` when the retrieval funnel truncated — and
   * occasionally SMALLER, because semantic retrieval can propose a relevant
   * job whose text does not contain the query at all. Both are honest numbers
   * about different questions, which is why there are two of them.
   */
  matched: number;
  ranked: number;
  truncated: boolean;
  page: number;
  pageSize: number;
  /** True when semantic retrieval was unavailable and this ran lexical-only. */
  degraded: boolean;
  results: ExternalSearchResult[];
  diagnostics: {
    lexicalCandidates: number;
    semanticCandidates: number;
    revalidated: number;
    durationMs: number;
    fromCache: boolean;
  };
}

export interface ExternalSearchResult {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  status: string;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additionalLocations: unknown;
  workMode: string | null;
  /**
   * Countries a REMOTE role may be worked from, when the employer said so.
   *
   * Empty is UNKNOWN geography and never "worldwide". It is in the response
   * because a card that renders `workMode: REMOTE` alone has to choose between
   * saying nothing about where, and implying anywhere — and the second is a
   * claim no source made. It is display only: the location matcher already
   * consumed the same column during retrieval and ranking.
   */
  remoteCountriesAllowed: string[];
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  };
  /**
   * When the EMPLOYER's source says this listing was published, or null.
   *
   * Never a crawler timestamp. `firstSeenAt`, `lastSeenAt` and the row's own
   * `createdAt` are all absent from this response precisely so that no client
   * can render one of them as "Posted 2 days ago" — a job discovered today may
   * have been published months ago, and the difference is invisible once it
   * reaches a screen.
   */
  employerPostedAt: Date | null;
  score: number;
  band: string;
  textScore: number | null;
  intentScore: number | null;
  reasons: unknown;
  /** Where a candidate applies. Always a stored, validated provider URL. */
  applyUrl: string | null;
  provenance: {
    /** The most authoritative source label, for "Source: …". */
    primarySource: string | null;
    /** Who receives the application, for "Apply via: …". */
    applyVia: string | null;
    /** How many independent sources observed this job. NEVER a score input. */
    sourceCount: number;
  };
  /**
   * Whether the CALLER bookmarked this job. Decoration, not ranking: looked
   * up in bulk for the page AFTER the stored order is read, absent from the
   * snapshot and the fingerprint, so saving a job never moves it and never
   * invalidates a search.
   */
  saved: boolean;
  /** The caller's own self-reported tracker on this job, or null. Same rule. */
  applicationTracking: ExternalTrackingSummary | null;
}

@Injectable()
export class ExternalSearchService {
  private readonly logger = new Logger(ExternalSearchService.name);

  /**
   * Identical in-flight searches, coalesced.
   *
   * The unique index on (candidateAccountId, requestFingerprint) is the real
   * guarantee; this is the cheap half that stops two concurrent identical
   * requests from both doing the retrieval, the embedding call and the write
   * before one of them loses the race.
   */
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: ExternalSearchRetrieval,
    private readonly preferences: CandidatePreferencesService,
    private readonly fx: FxRateService,
    private readonly ai: AiServiceClient,
    private readonly flags: CandidateExternalFlagsService,
  ) {}

  async search(
    userId: string,
    dto: ExternalJobSearchDto,
  ): Promise<ExternalSearchPage> {
    const started = Date.now();
    const candidateAccountId = await this.preferences.requireAccountId(userId);

    /*
     * Rule N1: the CURRENT intent, read now. Never a copy stored with an older
     * run — a candidate who deleted their preferences must get a search that
     * knows nothing about them, and the fingerprint below is what makes the
     * old snapshot unreachable rather than merely unused.
     */
    const intent = await this.preferences.resolveIntent(candidateAccountId);
    const resolved = resolveJobSearchIntent(intent, {
      query: dto.query ?? null,
      countries: dto.countries?.map((code) => code.toUpperCase()),
      workModes: dto.workModes,
      employmentTypes: dto.employmentTypes,
      seniorityLevels: dto.seniorityLevels,
      minCompensation: dto.minCompensation
        ? {
            minAmount: dto.minCompensation.minAmount,
            maxAmount: dto.minCompensation.maxAmount ?? null,
            currency: dto.minCompensation.currency,
            payPeriod: dto.minCompensation.payPeriod,
          }
        : null,
    });

    /*
     * THE hard/soft boundary, in one expression.
     *
     * Only a country the candidate chose FOR THIS REQUEST narrows the
     * universe. `source === 'PREFERENCE'` means it came from their saved
     * profile, and a saved country ranks — it is passed to the soft filters
     * below instead, exactly as internal Find Jobs does it.
     */
    const strictCountries =
      resolved.countries.source === 'REQUEST' ? resolved.countries.value : [];

    const sort: ExternalSearchSort = dto.sort ?? DEFAULT_EXTERNAL_SEARCH_SORT;

    const scope: ExternalSearchScope = {
      query: resolved.query.value,
      strictCountries,
      workModes: resolved.workModes.value,
      employmentTypes: resolved.employmentTypes.value,
      seniorityLevels: resolved.seniorityLevels.value,
    };

    const soft: SearchSecondaryFilters = {
      workModes: resolved.workModes.value,
      employmentTypes: resolved.employmentTypes.value,
      seniorityLevels: resolved.seniorityLevels.value,
      compensation: resolved.compensation.value,
      // Saved locations, and only saved ones: a country chosen for this search
      // already removed the jobs it excludes, and scoring it again would
      // double-count the same statement.
      preferredLocations:
        resolved.countries.source === 'PREFERENCE' ? intent.locations : [],
    };

    const universeRevision = await this.retrieval.universeRevision();
    const requestFingerprint = this.fingerprint({
      scope,
      soft,
      sort,
      intentHash: intentFingerprint(intent),
      universeRevision,
    });

    const key = `${candidateAccountId}|${requestFingerprint}`;
    const existing = await this.findReusableRun(
      candidateAccountId,
      requestFingerprint,
    );

    let runId: string;
    let fromCache = true;
    if (existing) {
      runId = existing;
    } else {
      fromCache = false;
      const pending =
        this.inFlight.get(key) ??
        this.compute({
          candidateAccountId,
          requestFingerprint,
          universeRevision,
          intentHash: intentFingerprint(intent),
          scope,
          soft,
          sort,
          intent,
        }).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
      runId = await pending;
    }

    return this.readPage(
      candidateAccountId,
      runId,
      resolved,
      dto,
      sort,
      started,
      fromCache,
    );
  }

  /**
   * A stored run that is still current.
   *
   * The fingerprint already covers the request, the intent, the universe
   * revision and the algorithm version, so a match here means recomputing
   * would produce the same order. The TTL is the backstop for everything a
   * fingerprint cannot see.
   */
  private async findReusableRun(
    candidateAccountId: string,
    requestFingerprint: string,
  ): Promise<string | null> {
    const run = await this.prisma.candidateExternalSearchRun.findUnique({
      where: {
        candidateAccountId_requestFingerprint: {
          candidateAccountId,
          requestFingerprint,
        },
      },
      select: { id: true, expiresAt: true, algorithmVersion: true },
    });
    if (!run) return null;
    if (run.algorithmVersion !== EXTERNAL_SEARCH_ALGORITHM_VERSION) return null;
    if (run.expiresAt.getTime() <= Date.now()) return null;
    return run.id;
  }

  /** Retrieval → revalidation → ranking → one stored snapshot. */
  private async compute(input: {
    candidateAccountId: string;
    requestFingerprint: string;
    universeRevision: string;
    intentHash: string;
    scope: ExternalSearchScope;
    soft: SearchSecondaryFilters;
    sort: ExternalSearchSort;
    intent: CandidateJobIntent;
  }): Promise<string> {
    const started = Date.now();
    const newest = input.sort === 'NEWEST';

    /*
     * Two retrieval strategies, because they answer different questions.
     *
     * RELEVANCE needs the best-SCORING jobs, which only a scoring funnel can
     * find. NEWEST needs the most recently PUBLISHED ones, which only the
     * database can order — asking the relevance funnel and then sorting its
     * output by date returns the newest of the 300 most relevant, silently
     * missing the job posted this morning.
     *
     * NEWEST also skips semantic retrieval entirely. Its purpose is to widen
     * recall for a ranking that rewards meaning; in a date-ordered list it
     * would instead lift jobs that do not contain the query above ones that
     * do, purely because they are newer. So the newest list is exactly the
     * jobs the hard text universe already counts — which is also why it never
     * runs degraded.
     */
    const [hardUniverseSize, lexical, semantic, newestIds] = await Promise.all([
      this.retrieval.countHardUniverse(input.scope),
      newest
        ? Promise.resolve([])
        : this.retrieval.lexicalCandidates(input.scope, LEXICAL_LIMIT),
      newest
        ? Promise.resolve({ hits: [], degraded: false })
        : this.semanticCandidates(input.scope),
      newest
        ? this.retrieval.newestCandidates(input.scope, MAX_CANDIDATES)
        : Promise.resolve([]),
    ]);

    const lexicalScores = new Map(
      lexical.map((hit) => [hit.externalJobId, hit.score]),
    );
    const semanticScores = new Map(
      semantic.hits.map((hit) => [hit.externalJobId, hit.similarity]),
    );

    /*
     * The union, capped. Lexical ids come first so that when the cap bites it
     * is the weakest SEMANTIC suggestions that fall off — a job whose title
     * literally contains the query has stronger evidence than one an embedding
     * placed nearby, and if only some can be scored those are the ones.
     */
    const candidateIds = newest
      ? newestIds
      : [...new Set([...lexicalScores.keys(), ...semanticScores.keys()])].slice(
          0,
          MAX_CANDIDATES,
        );

    // POSTGRES DECIDES. Everything proposed above is a suggestion until it
    // comes back from here.
    const rows = await this.retrieval.revalidate(candidateIds, input.scope);

    /*
     * The candidate's own explicit exclusions, applied to what survived.
     * These are the only preference-shaped thing that removes a job, and they
     * are removals the candidate asked for by name.
     */
    const allowed = rows.filter(
      (row) =>
        evaluateHardConstraints(searchRowFeatures(row), input.intent)
          .eligibility === 'ELIGIBLE',
    );

    // Rates are read once per run, not per job: 500 comparisons against one
    // table, and the version travels with the snapshot for traceability.
    const { table, snapshot } = await this.fx.current();

    const ranked = rankExternalJobs({
      rows: allowed,
      lexical: lexicalScores,
      semantic: semanticScores,
      /*
       * NEWEST never computes a text score: its candidate set comes from the
       * date index, not the scoring funnel, so there is no lexical rank to
       * report. Null rather than zero — see `scoreText`.
       */
      scoreText: !newest && input.scope.query !== null,
      soft: input.soft,
      rates: table,
      features: searchRowFeatures,
      sort: input.sort,
    });

    const runId = await this.persist({
      ...input,
      hardUniverseSize,
      ranked,
      lexicalCount: lexical.length,
      semanticCount: semantic.hits.length,
      degraded: semantic.degraded,
      fx: snapshot,
    });

    this.logger.log(
      `External search [${input.sort}] for candidate account ${input.candidateAccountId}: ` +
        `hardUniverse=${hardUniverseSize} lexical=${lexical.length} ` +
        `semantic=${semantic.hits.length} union=${candidateIds.length} ` +
        `revalidated=${rows.length} ranked=${ranked.length} ` +
        `degraded=${semantic.degraded} ${Date.now() - started}ms`,
    );
    return runId;
  }

  /**
   * Semantic candidates, or an honest nothing.
   *
   * A search must not fail because a vector database is down. Losing this
   * stage costs RECALL — a job phrased differently from the query may not be
   * proposed — and costs nothing else: the lexical stage is independently
   * indexed, and Postgres decides existence either way. So the failure is
   * caught, reported as `degraded`, and the search continues.
   */
  private async semanticCandidates(scope: ExternalSearchScope): Promise<{
    hits: { externalJobId: string; similarity: number }[];
    degraded: boolean;
  }> {
    if (!scope.query) {
      // Embedding an empty string returns the catalogue's centroid — the
      // least-specific jobs there are. A browse is answered by structure and
      // recency instead; see `zeroQueryCandidates`.
      return { hits: [], degraded: false };
    }
    if (!this.ai.enabled) return { hits: [], degraded: true };

    try {
      const hits = await this.ai.searchExternalJobs({
        query: scope.query,
        limit: SEMANTIC_LIMIT,
        statuses: ['ACTIVE', 'STALE'],
      });
      return { hits: this.retrieval.filterSemantic(hits), degraded: false };
    } catch (error) {
      this.logger.warn(
        `Semantic retrieval unavailable; search continues on the lexical ` +
          `index only: ${(error as Error).message}`,
      );
      return { hits: [], degraded: true };
    }
  }

  /**
   * Write the snapshot, tolerating a concurrent identical write.
   *
   * Two requests that raced past the in-flight map collide on the unique
   * index. That is the database doing its job, and the loser simply reads the
   * winner's run — both computed the same ranking from the same inputs, so
   * there is nothing to reconcile.
   */
  private async persist(input: {
    candidateAccountId: string;
    requestFingerprint: string;
    universeRevision: string;
    intentHash: string;
    scope: ExternalSearchScope;
    hardUniverseSize: number;
    ranked: ScoredExternalJob[];
    sort: ExternalSearchSort;
    lexicalCount: number;
    semanticCount: number;
    degraded: boolean;
    fx: { snapshotVersion: string; fetchedAt: string } | null;
  }): Promise<string> {
    const write = () =>
      this.prisma.$transaction(async (tx) => {
        await tx.candidateExternalSearchRun.deleteMany({
          where: {
            candidateAccountId: input.candidateAccountId,
            requestFingerprint: input.requestFingerprint,
          },
        });
        const run = await tx.candidateExternalSearchRun.create({
          data: {
            candidateAccountId: input.candidateAccountId,
            requestFingerprint: input.requestFingerprint,
            intentFingerprint: input.intentHash,
            universeRevision: input.universeRevision,
            algorithmVersion: EXTERNAL_SEARCH_ALGORITHM_VERSION,
            sort: input.sort,
            query: input.scope.query,
            strictCountries: input.scope.strictCountries,
            hardUniverseSize: input.hardUniverseSize,
            totalRanked: input.ranked.length,
            // Deeper matches exist that this run did not score. Surfaced
            // rather than hidden: a silent cap reads as "that is everything".
            truncated: input.ranked.length < input.hardUniverseSize,
            lexicalCandidates: input.lexicalCount,
            semanticCandidates: input.semanticCount,
            semanticDegraded: input.degraded,
            fxSnapshotVersion: input.fx?.snapshotVersion ?? null,
            fxFetchedAt: input.fx ? new Date(input.fx.fetchedAt) : null,
            expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS),
          },
          select: { id: true },
        });
        if (input.ranked.length > 0) {
          await tx.candidateExternalSearchEntry.createMany({
            data: input.ranked.map((entry, index) => ({
              runId: run.id,
              externalJobId: entry.externalJobId,
              rank: index + 1,
              score: entry.score,
              band: entry.band,
              textScore: entry.textScore,
              intentScore: entry.intentScore,
              reasons: entry.reasons as unknown as Prisma.InputJsonValue,
            })),
          });
        }
        return run.id;
      });

    try {
      return await write();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
      const winner = await this.prisma.candidateExternalSearchRun.findUnique({
        where: {
          candidateAccountId_requestFingerprint: {
            candidateAccountId: input.candidateAccountId,
            requestFingerprint: input.requestFingerprint,
          },
        },
        select: { id: true },
      });
      if (winner) return winner.id;
      // The other writer rolled back after all; ours may now proceed.
      return write();
    }
  }

  /**
   * One page of a stored run, joined to the CURRENT job rows.
   *
   * The snapshot holds the order; the job facts are read live. A title edited
   * since the search was run therefore displays correctly instead of being
   * frozen — and a job that left the universe between two page requests
   * disappears from the page rather than being shown as still open. The
   * ranking is a decision that was made at a moment; the job's facts are not.
   */
  private async readPage(
    candidateAccountId: string,
    runId: string,
    resolved: ReturnType<typeof resolveJobSearchIntent>,
    dto: ExternalJobSearchDto,
    sort: ExternalSearchSort,
    startedAt: number,
    fromCache: boolean,
  ): Promise<ExternalSearchPage> {
    const page = Math.max(1, dto.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, dto.pageSize ?? 20));

    const run = await this.prisma.candidateExternalSearchRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        algorithmVersion: true,
        hardUniverseSize: true,
        totalRanked: true,
        truncated: true,
        lexicalCandidates: true,
        semanticCandidates: true,
        semanticDegraded: true,
        query: true,
      },
    });
    if (!run) throw new NotFoundException('Search run not found');

    const entries = await this.prisma.candidateExternalSearchEntry.findMany({
      where: { runId },
      orderBy: { rank: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        externalJobId: true,
        score: true,
        band: true,
        textScore: true,
        intentScore: true,
        reasons: true,
      },
    });

    const ids = entries.map((e) => e.externalJobId);
    /*
     * Job facts and the caller's own marks, in parallel — three indexed
     * bulk reads for the whole page, never one query per card. The marks are
     * decoration: they arrive after the stored order is read and cannot
     * change it.
     */
    const [jobs, marks] = await Promise.all([
      this.loadJobs(ids),
      this.flags.flagsFor(candidateAccountId, ids),
    ]);

    const results: ExternalSearchResult[] = [];
    for (const entry of entries) {
      const job = jobs.get(entry.externalJobId);
      // Gone from the universe since the run was computed. Dropped rather
      // than shown: a snapshot orders jobs, it does not keep them alive.
      if (!job) continue;
      results.push({
        ...job,
        ...entryFields(entry),
        saved: marks.saved.has(entry.externalJobId),
        applicationTracking: marks.tracking.get(entry.externalJobId) ?? null,
      });
    }

    return {
      runId: run.id,
      algorithmVersion: run.algorithmVersion,
      asOf: new Date(),
      /*
       * Echoed back rather than left for the caller to infer from its own URL.
       * A UI that guessed would eventually disagree with the order it was
       * handed — after a normalized bad value, or a default that moved — and
       * would then label a relevance-ordered list "Newest".
       */
      sort,
      applied: {
        query: resolved.query.value,
        countries: {
          value: resolved.countries.value,
          source: resolved.countries.source,
        },
        workModes: {
          value: resolved.workModes.value,
          source: resolved.workModes.source,
        },
        employmentTypes: {
          value: resolved.employmentTypes.value,
          source: resolved.employmentTypes.source,
        },
        seniorityLevels: {
          value: resolved.seniorityLevels.value,
          source: resolved.seniorityLevels.source,
        },
        compensation: {
          stated: resolved.compensation.value !== null,
          source: resolved.compensation.source,
        },
      },
      total: run.totalRanked,
      matched: run.hardUniverseSize,
      ranked: run.totalRanked,
      truncated: run.truncated,
      page,
      pageSize,
      degraded: run.semanticDegraded,
      results,
      diagnostics: {
        lexicalCandidates: run.lexicalCandidates,
        semanticCandidates: run.semanticCandidates,
        revalidated: run.totalRanked,
        durationMs: Date.now() - startedAt,
        fromCache,
      },
    };
  }

  /**
   * The card data for one page of jobs, read live.
   *
   * Provenance is summarized, not dumped: a candidate is told which kind of
   * source published the role and where the application goes, and nothing
   * about ingestion runs, fingerprints or payloads. `sourceCount` is
   * displayed and never scored — two observations of a job make it better
   * evidenced, not a better job.
   */
  private async loadJobs(ids: string[]): Promise<Map<string, LoadedJobFields>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.externalJob.findMany({
      where: { id: { in: ids }, status: { in: ['ACTIVE', 'STALE'] } },
      select: {
        id: true,
        title: true,
        status: true,
        countryCode: true,
        region: true,
        city: true,
        additionalLocations: true,
        workMode: true,
        remoteCountriesAllowed: true,
        employmentType: true,
        seniorityLevel: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
        payPeriod: true,
        employerPostedAt: true,
        canonicalUrl: true,
        company: { select: { name: true, websiteUrl: true } },
        sources: {
          select: { provider: true, originalUrl: true, sourceUrl: true },
          where: { status: 'ACTIVE' },
        },
      },
    });

    const out = new Map<string, LoadedJobFields>();
    for (const row of rows) {
      const applySource =
        row.sources.find(
          (source) =>
            (source.originalUrl ?? source.sourceUrl) === row.canonicalUrl,
        ) ?? row.sources[0];
      out.set(row.id, {
        externalJobId: row.id,
        title: row.title,
        company: row.company.name,
        companyWebsiteUrl: row.company.websiteUrl,
        status: row.status,
        location: {
          countryCode: row.countryCode,
          region: row.region,
          city: row.city,
        },
        additionalLocations: row.additionalLocations ?? [],
        workMode: row.workMode,
        remoteCountriesAllowed: row.remoteCountriesAllowed,
        employmentType: row.employmentType,
        seniorityLevel: row.seniorityLevel,
        salary: {
          min: row.salaryMin,
          max: row.salaryMax,
          currency: row.currency,
          payPeriod: row.payPeriod,
        },
        employerPostedAt: row.employerPostedAt,
        /*
         * Straight from the stored canonical URL, which every provider
         * validated at ingestion. Never assembled from anything the caller
         * sent, and never proxied: applying happens on the employer's site.
         */
        applyUrl: row.canonicalUrl,
        provenance: {
          primarySource: row.sources[0]?.provider ?? null,
          applyVia: applySource?.provider ?? null,
          sourceCount: row.sources.length,
        },
      });
    }
    return out;
  }

  /**
   * The semantic hash of everything that decided a ranking.
   *
   * Sorted before hashing, so ticking Remote then Hybrid is the same search as
   * Hybrid then Remote and reuses the same snapshot. The universe revision is
   * in here rather than checked separately because it is an INPUT: the same
   * query against a changed catalogue is a different search.
   */
  private fingerprint(input: {
    scope: ExternalSearchScope;
    soft: SearchSecondaryFilters;
    sort: ExternalSearchSort;
    intentHash: string;
    universeRevision: string;
  }): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          v: EXTERNAL_SEARCH_ALGORITHM_VERSION,
          /*
           * The sort is an INPUT, not a view of one stored answer: the two
           * orders are computed from different candidate sets, so they are
           * different runs and must never share a snapshot.
           */
          sort: input.sort,
          query: input.scope.query?.trim().toLowerCase() ?? null,
          countries: [...input.scope.strictCountries].sort(),
          workModes: [...input.soft.workModes].sort(),
          employmentTypes: [...input.soft.employmentTypes].sort(),
          seniorityLevels: [...input.soft.seniorityLevels].sort(),
          compensation: input.soft.compensation,
          preferredLocations: input.soft.preferredLocations
            .map((place) =>
              [place.countryCode, place.region, place.city]
                .filter(Boolean)
                .join('/')
                .toLowerCase(),
            )
            .sort(),
          intent: input.intentHash,
          universe: input.universeRevision,
        }),
      )
      .digest('hex');
  }
}

/** The job facts `loadJobs` supplies — everything but scoring and marks. */
type LoadedJobFields = Omit<
  ExternalSearchResult,
  keyof EntryFields | 'saved' | 'applicationTracking'
>;

type EntryFields = {
  score: number;
  band: string;
  textScore: number | null;
  intentScore: number | null;
  reasons: unknown;
};

function entryFields(entry: {
  score: number;
  band: string;
  textScore: number | null;
  intentScore: number | null;
  reasons: unknown;
}): EntryFields {
  return {
    score: entry.score,
    band: entry.band,
    textScore: entry.textScore,
    intentScore: entry.intentScore,
    reasons: entry.reasons,
  };
}

export type { ExternalSearchRow };

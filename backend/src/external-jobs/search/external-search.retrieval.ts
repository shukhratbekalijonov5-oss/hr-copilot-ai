import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CURRENT_EXTERNAL_STATUSES } from '../lifecycle';
import { MIN_SEMANTIC_SIMILARITY } from './external-search.policy';
import type {
  EmploymentType,
  SeniorityLevel,
  WorkMode,
} from '../../generated/prisma/enums';

/**
 * Turning a search into a BOUNDED set of candidate jobs, without ever reading
 * the whole catalogue.
 *
 * ## The architecture this file exists to avoid
 *
 *     SELECT * FROM external_jobs WHERE status IN (...)   -- 1,000,000 rows
 *       → score every one in JavaScript
 *       → sort
 *       → slice page 1
 *
 * That works beautifully at 1,775 jobs and stops working entirely somewhere
 * around 50,000, at which point the fix is a rewrite rather than a tuning
 * change. So the funnel is built the other way round from the start: every
 * stage is an INDEXED, LIMITED query, and the amount of work a search does is
 * governed by the retrieval caps rather than by how big the catalogue got.
 *
 *     current universe   →  hard constraints  (indexed COUNT)
 *                        →  lexical top-K     (GIN, LIMIT)
 *                        ∪  semantic top-K    (Qdrant, LIMIT)
 *                        →  Postgres revalidation of the union
 *
 * ## Why the lexical stage is a UNION of branches, not one OR
 *
 * `WHERE status IN (…) AND (fulltext OR trigram OR company)` is correct, and
 * PostgreSQL is free to answer it with a plan that filters 1M rows — measured:
 * at this catalogue size it chooses exactly that, because scanning 1,775 rows
 * is genuinely cheaper than combining three bitmaps. The planner is right
 * today and would be catastrophically wrong later, and a query whose safety
 * depends on table statistics is not safe.
 *
 * Each branch is therefore its own indexed, ordered, LIMITed query, and the
 * union happens afterwards. Verified with EXPLAIN: full-text uses
 * `external_jobs_searchDocument_idx`, trigram uses `external_jobs_title_idx`
 * (including for `개발자`), and the location filter uses
 * `external_jobs_additionalLocations_idx`.
 */

/** The candidate-facing universe: current jobs only. */
const SEARCHABLE_STATUSES = CURRENT_EXTERNAL_STATUSES;

/**
 * How many candidates each retrieval branch may return.
 *
 * The whole search costs O(K log N), not O(N). Raising these buys depth at a
 * linear cost in scoring time; it never changes correctness, because
 * everything retrieved is revalidated against Postgres afterwards.
 */
export const LEXICAL_LIMIT = 300;
export const SEMANTIC_LIMIT = 150;
/** The most jobs one search will score and store. See the snapshot model. */
export const MAX_CANDIDATES = 500;

/**
 * Trigram floor for the title fallback.
 *
 * `<%` compares the query against the closest word-boundary extent of the
 * title, which is what makes it useful for the cases the tokenizer misses:
 * Korean particles (`개발자를`), closed-up compounds (`백엔드개발자`) and
 * ordinary typos. The operator uses PostgreSQL's own
 * `pg_trgm.word_similarity_threshold`, left at its default 0.6 — deliberately
 * strict, because this branch exists to catch near-identical text, not to
 * widen the search.
 */
export interface ExternalSearchScope {
  /** The candidate's text query. Null means "no text constraint". */
  query: string | null;
  /**
   * Countries chosen FOR THIS SEARCH. The only location input that removes
   * jobs — a saved country is a ranking signal and never reaches here.
   */
  strictCountries: string[];
  /** Soft dimensions, used only to steer the zero-query candidate set. */
  workModes: WorkMode[];
  employmentTypes: EmploymentType[];
  seniorityLevels: SeniorityLevel[];
}

export interface LexicalCandidate {
  externalJobId: string;
  /** 0..1 lexical relevance. */
  score: number;
}

@Injectable()
export class ExternalSearchRetrieval {
  private readonly logger = new Logger(ExternalSearchRetrieval.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The search-universe revision: a row count and the latest search-relevant
   * edit, over the current universe.
   *
   * Two index lookups on `(status, searchableUpdatedAt)`, not a hash of the
   * catalogue — hashing a million jobs on every request would cost more than
   * the search. It moves when a job enters or leaves the universe or has a
   * searchable field edited, and deliberately NOT when a provider sweep merely
   * re-observes a posting, which happens every few hours and changes nothing a
   * searcher could see.
   */
  async universeRevision(): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      { count: bigint; latest: Date | null }[]
    >`
      SELECT count(*)::bigint AS count, max("searchableUpdatedAt") AS latest
      FROM external_jobs
      WHERE status = ANY(${SEARCHABLE_STATUSES}::"ExternalJobStatus"[])
    `;
    const row = rows[0];
    return `${Number(row?.count ?? 0)}:${row?.latest?.toISOString() ?? 'none'}`;
  }

  /**
   * The SQL predicate for "this job is currently searchable and passes the
   * hard location constraint".
   *
   * ## Location, and the field that has been waiting since Task 4B.3
   *
   * A job is in a country when ANY of three things is true:
   *
   *   1. its primary location is there;
   *   2. one of its `additionalLocations` is there — a real requisition open
   *      in New York AND Toronto answers a search for Canada, and querying the
   *      primary column alone would silently exclude a candidate the employer
   *      would have hired;
   *   3. it is REMOTE and the employer explicitly listed that country as one
   *      a remote worker may live in.
   *
   * ## Remote is not worldwide
   *
   * Clause 3 requires `remoteCountriesAllowed` to actually CONTAIN the
   * country. A remote job whose employer never said where you may live does
   * not match a search for Canada — it matches nothing, because nobody said it
   * did. That distinction is the whole reason the column exists.
   *
   * ## Unknown location is excluded by an explicit filter
   *
   * A job with no stated country does not satisfy "must be in Canada". This
   * matches internal Find Jobs (`evaluateHardConstraints`, `strictCountries`)
   * exactly, and the alternative was considered and rejected: including
   * unknowns would mean a candidate who filtered for Canada is shown jobs that
   * may well be anywhere, which is not what they asked and not something the
   * result could honestly be labelled. Unknown location remains fully
   * reachable in any search that does not filter by country.
   */
  private scopeWhere(scope: ExternalSearchScope): Prisma.Sql {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`j.status = ANY(${SEARCHABLE_STATUSES}::"ExternalJobStatus"[])`,
    ];

    if (scope.strictCountries.length > 0) {
      const countries = scope.strictCountries.map((code) => code.toUpperCase());
      const additional = countries.map(
        (code) =>
          Prisma.sql`j."additionalLocations" @> ${JSON.stringify([
            { countryCode: code },
          ])}::jsonb`,
      );
      clauses.push(Prisma.sql`(
        j."countryCode" = ANY(${countries}::text[])
        OR ${Prisma.join(additional, ' OR ')}
        OR (j."workMode" = 'REMOTE'
            AND j."remoteCountriesAllowed" && ${countries}::text[])
      )`);
    }

    return Prisma.join(clauses, ' AND ');
  }

  /**
   * How many jobs answer this search, before any retrieval cap.
   *
   * A COUNT rather than a length, so the honest total survives the funnel: a
   * search matching 4,000 jobs says 4,000 even though only the top few hundred
   * were ranked. Reporting the retrieved count as the total would tell a
   * candidate their search found less than it did.
   */
  async countHardUniverse(scope: ExternalSearchScope): Promise<number> {
    const where = this.scopeWhere(scope);
    const text = this.textPredicate(scope.query);
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM external_jobs j
      WHERE ${where}${text ? Prisma.sql` AND ${text}` : Prisma.empty}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  /** The text half of the hard universe, as one predicate. */
  private textPredicate(query: string | null): Prisma.Sql | null {
    if (!query) return null;
    return Prisma.sql`(
      j."searchDocument" @@ plainto_tsquery('simple', ${query})
      OR ${query} <% j.title
      OR EXISTS (
        SELECT 1 FROM external_companies c
        WHERE c.id = j."externalCompanyId" AND ${query} <% c.name
      )
    )`;
  }

  /**
   * Lexical candidates, as a union of independently-indexed branches.
   *
   * Each branch answers one question with one index and its own LIMIT; the
   * outer aggregation keeps the strongest score per job. Splitting them is
   * what makes the plan independent of table statistics — see the module
   * docstring.
   */
  async lexicalCandidates(
    scope: ExternalSearchScope,
    limit = LEXICAL_LIMIT,
  ): Promise<LexicalCandidate[]> {
    const where = this.scopeWhere(scope);

    if (!scope.query) return this.zeroQueryCandidates(scope, limit);

    const query = scope.query;
    const companyIds = await this.matchingCompanyIds(query);

    /*
     * `ts_rank_cd(..., 32)` normalizes to 0..1 as `rank / (rank + 1)`.
     * Deliberately an ABSOLUTE scale rather than "divide by the best hit in
     * this result set": a job's relevance to a query must not depend on which
     * other jobs happened to be retrieved alongside it, or the same job scores
     * differently on two pages of the same search.
     *
     * The weight vector {D,C,B,A} = {0.1, 0.2, 0.4, 1.0} is what makes a job
     * TITLED "Backend Engineer" outrank one whose description mentions backend
     * engineers — see the generated column for what carries which weight.
     */
    const rows = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
      WITH lexical AS (
        (
          SELECT j.id,
                 ts_rank_cd('{0.1,0.2,0.4,1.0}', j."searchDocument",
                            plainto_tsquery('simple', ${query}), 32) AS score
          FROM external_jobs j
          WHERE ${where}
            AND j."searchDocument" @@ plainto_tsquery('simple', ${query})
          ORDER BY score DESC
          LIMIT ${limit}
        )
        UNION ALL
        (
          SELECT j.id, word_similarity(${query}, j.title) AS score
          FROM external_jobs j
          WHERE ${where} AND ${query} <% j.title
          ORDER BY score DESC
          LIMIT ${limit}
        )
        UNION ALL
        (
          -- Company matches score as a weak signal: searching "Vercel" should
          -- surface Vercel's jobs, but a company match says nothing about
          -- which of its roles answers the query.
          SELECT j.id, 0.3::real AS score
          FROM external_jobs j
          WHERE ${where}
            AND j."externalCompanyId" = ANY(${companyIds}::text[])
          LIMIT ${limit}
        )
      )
      SELECT id, max(score)::float8 AS score
      FROM lexical
      GROUP BY id
      ORDER BY score DESC, id ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      externalJobId: row.id,
      score: Math.max(0, Math.min(1, Number(row.score))),
    }));
  }

  /** Companies whose NAME answers the query. Resolved first so the job query
   * gets a plain indexable `= ANY(...)` instead of a correlated subquery that
   * would force a sequential scan over the job table. */
  private async matchingCompanyIds(query: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM external_companies
      WHERE ${query} <% name
      LIMIT 50
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Candidates for a search with NO text query.
   *
   * There is no index that can pre-rank jobs by how well they match a set of
   * preferences, because that alignment is computed rather than stored. So
   * rather than scoring the catalogue, the funnel retrieves jobs that MATCH
   * each stated preference — every one of those lookups is index-backed on the
   * existing `(status, workMode)`, `(status, employmentType)` and
   * `(status, seniorityLevel)` indexes — and fills the rest by recency.
   *
   * The result is a candidate set biased TOWARDS what the candidate said they
   * want, which is the correct bias for a preference-only search, and bounded
   * regardless of catalogue size.
   */
  private async zeroQueryCandidates(
    scope: ExternalSearchScope,
    limit: number,
  ): Promise<LexicalCandidate[]> {
    const where = this.scopeWhere(scope);
    const perBranch = Math.max(50, Math.ceil(limit / 2));
    const branches: Prisma.Sql[] = [];

    if (scope.workModes.length > 0) {
      branches.push(Prisma.sql`(
        SELECT j.id FROM external_jobs j
        WHERE ${where} AND j."workMode" = ANY(${scope.workModes}::"WorkMode"[])
        ORDER BY j."firstSeenAt" DESC LIMIT ${perBranch}
      )`);
    }
    if (scope.employmentTypes.length > 0) {
      branches.push(Prisma.sql`(
        SELECT j.id FROM external_jobs j
        WHERE ${where}
          AND j."employmentType" = ANY(${scope.employmentTypes}::"EmploymentType"[])
        ORDER BY j."firstSeenAt" DESC LIMIT ${perBranch}
      )`);
    }
    if (scope.seniorityLevels.length > 0) {
      branches.push(Prisma.sql`(
        SELECT j.id FROM external_jobs j
        WHERE ${where}
          AND j."seniorityLevel" = ANY(${scope.seniorityLevels}::"SeniorityLevel"[])
        ORDER BY j."firstSeenAt" DESC LIMIT ${perBranch}
      )`);
    }
    // Always present: a search that stated nothing still has to return the
    // catalogue, and a search that stated something still has to be able to
    // reach jobs that do not match it. Preferences rank; they never hide.
    branches.push(Prisma.sql`(
      SELECT j.id FROM external_jobs j
      WHERE ${where}
      ORDER BY j."firstSeenAt" DESC LIMIT ${limit}
    )`);

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH pool AS (${Prisma.join(branches, ' UNION ALL ')})
      SELECT DISTINCT id FROM pool LIMIT ${limit}
    `;
    // No text query means no text relevance to report. Order comes entirely
    // from the soft alignment and the tie-break.
    return rows.map((row) => ({ externalJobId: row.id, score: 0 }));
  }

  /**
   * Candidates for a NEWEST-first search, taken in date order by the database.
   *
   * ## Why this does not reuse the relevance funnel
   *
   * That funnel retrieves the 300 best-SCORING jobs and then orders them. Ask
   * it for the newest and it answers with the newest of the 300 most relevant
   * — which is a different question, and wrong in a way nobody can see: the
   * job posted this morning is simply missing, and the list still looks
   * plausibly recent. Ordering has to happen in the index, before the cap.
   *
   * ## Two queries, not one
   *
   * `ORDER BY x DESC NULLS LAST` cannot use a `DESC` index, whose nulls sort
   * first. Splitting the pass keeps both halves index-backed: the dated half
   * walks `(status, employerPostedAt DESC)` forward and stops at the limit,
   * and the undated half runs only when there is room left. At any catalogue
   * size the work is bounded by the limit rather than by the number of jobs.
   *
   * ## One branch per status, for the same reason the lexical path has them
   *
   * `status = ANY('{ACTIVE,STALE}')` cannot produce ordered output from that
   * index: an index ordered within each status value has to merge two runs to
   * order across both, so the planner sorts — measured, at 1,775 rows and
   * again with `enable_seqscan=off`. One branch per status makes each an
   * ordered index scan that stops at its own LIMIT (`Index Scan using
   * external_jobs_status_employerPostedAt_idx`, no Sort node), and the outer
   * merge sees at most two limits' worth of rows. Today's table is small
   * enough that the planner picks a scan-and-sort anyway; the shape is what
   * makes the plan safe at a million rows rather than a lucky statistic.
   *
   * The second query is what keeps undated jobs REACHABLE. Half this
   * catalogue has no publication date, and a newest-first list that silently
   * dropped them would hide real vacancies from a reader who only changed the
   * sort.
   */
  async newestCandidates(
    scope: ExternalSearchScope,
    limit = MAX_CANDIDATES,
  ): Promise<string[]> {
    const where = this.scopeWhere(scope);
    const text = this.textPredicate(scope.query);
    const filter = text ? Prisma.sql`${where} AND ${text}` : where;

    const dated = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH ranked AS (${Prisma.join(
        SEARCHABLE_STATUSES.map(
          (status) => Prisma.sql`(
            SELECT j.id, j."employerPostedAt", j."firstSeenAt"
            FROM external_jobs j
            WHERE ${filter}
              AND j.status = ${status}::"ExternalJobStatus"
              AND j."employerPostedAt" IS NOT NULL
            ORDER BY j."employerPostedAt" DESC
            LIMIT ${limit}
          )`,
        ),
        ' UNION ALL ',
      )})
      SELECT id FROM ranked
      ORDER BY "employerPostedAt" DESC, "firstSeenAt" DESC, id ASC
      LIMIT ${limit}
    `;
    if (dated.length >= limit) return dated.map((row) => row.id);

    const undated = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id
      FROM external_jobs j
      WHERE ${filter} AND j."employerPostedAt" IS NULL
      ORDER BY j."firstSeenAt" DESC, j.id ASC
      LIMIT ${limit - dated.length}
    `;
    return [...dated, ...undated].map((row) => row.id);
  }

  /**
   * POSTGRES DECIDES WHAT EXISTS.
   *
   * Every id the funnel proposes — lexical or semantic — comes back through
   * here, and a job that is not currently in the universe simply does not come
   * back. That is what makes a stale Qdrant point harmless: the vector index
   * may still hold a posting that closed an hour ago, and this query is what
   * refuses to show it. The same applies in reverse to the hard location
   * filter, which is re-applied here rather than trusted from whichever stage
   * proposed the id.
   */
  async revalidate(
    externalJobIds: string[],
    scope: ExternalSearchScope,
  ): Promise<ExternalSearchRow[]> {
    if (externalJobIds.length === 0) return [];
    const where = this.scopeWhere(scope);

    return this.prisma.$queryRaw<ExternalSearchRow[]>`
      SELECT
        j.id                     AS "id",
        j.title                  AS "title",
        j.status::text           AS "status",
        j."countryCode"          AS "countryCode",
        j.region                 AS "region",
        j.city                   AS "city",
        j."additionalLocations"  AS "additionalLocations",
        j."workMode"::text       AS "workMode",
        j."remoteCountriesAllowed" AS "remoteCountriesAllowed",
        j."employmentType"::text AS "employmentType",
        j."seniorityLevel"::text AS "seniorityLevel",
        j."salaryMin"            AS "salaryMin",
        j."salaryMax"            AS "salaryMax",
        j.currency               AS "currency",
        j."payPeriod"::text      AS "payPeriod",
        j.benefits::text[]       AS "benefits",
        j.industries             AS "industries",
        j."canonicalUrl"         AS "canonicalUrl",
        j."employerPostedAt"     AS "employerPostedAt",
        j."firstSeenAt"          AS "firstSeenAt",
        j."lastSeenAt"           AS "lastSeenAt",
        j."expiresAt"            AS "expiresAt",
        c.name                   AS "companyName",
        c."websiteUrl"           AS "companyWebsiteUrl"
      FROM external_jobs j
      JOIN external_companies c ON c.id = j."externalCompanyId"
      WHERE ${where} AND j.id = ANY(${externalJobIds}::text[])
    `;
  }

  /**
   * Filter a set of semantic hits down to the ones worth proposing.
   *
   * Embedding similarity always returns SOMETHING for any query — a top-K is
   * a ranking, not a judgement — so an unfiltered semantic branch would fill
   * the candidate set with the least-unrelated jobs in the catalogue whenever
   * the query genuinely has no good answer. Returning three relevant results
   * is better than returning fifty of which forty-seven are noise.
   */
  filterSemantic(
    hits: { externalJobId: string; similarity: number }[],
  ): { externalJobId: string; similarity: number }[] {
    return hits.filter((hit) => hit.similarity >= MIN_SEMANTIC_SIMILARITY);
  }
}

/** One revalidated job, exactly as the search reads it. */
export interface ExternalSearchRow {
  id: string;
  title: string;
  status: string;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  additionalLocations: unknown;
  workMode: string | null;
  remoteCountriesAllowed: string[];
  employmentType: string | null;
  seniorityLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  payPeriod: string | null;
  benefits: string[];
  industries: string[];
  canonicalUrl: string | null;
  /** The employer's publication date, or null when no source stated one. */
  employerPostedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
  companyName: string;
  companyWebsiteUrl: string | null;
}

import type { RateTable } from '../../fx/money';
import type { NormalizedJobFeatures } from '../../matching/normalized-job-features';
import {
  searchAlignment,
  hasSecondaryPreferences,
  type SearchSecondaryFilters,
} from '../../matching/search-alignment';
import {
  compareByNewest,
  compareExternalResults,
  externalSearchBand,
  externalSearchReasons,
  externalSearchScore,
  SEMANTIC_TEXT_CEILING,
  type ExternalSearchReason,
  type ExternalSearchSort,
} from './external-search.policy';
import type { ExternalSearchRow } from './external-search.retrieval';
import type { MatchBand } from '../../matching/match-policy';

/**
 * Turning a revalidated candidate set into an order.
 *
 * ## What this deliberately does NOT compute
 *
 * Every comparison of a job against what the candidate wants — location, work
 * mode, employment type, seniority, salary — is delegated to the SAME
 * matchers that rank AI Job Match and internal Find Jobs. There is no second
 * seniority ladder here, no second currency conversion, no second opinion
 * about whether Toronto answers a preference for Canada.
 *
 * That is not code reuse for its own sake. A candidate who sees a job called
 * "senior enough" on one screen and not on another has been shown a bug they
 * cannot report, and the only durable fix is for there to be exactly one
 * implementation of each verdict in the product.
 *
 * What is genuinely NEW here is the text half — how well a job answers the
 * words someone typed — and how the two halves combine. Both live in
 * `external-search.policy.ts`, versioned.
 */

export interface ScoredExternalJob {
  externalJobId: string;
  score: number;
  band: MatchBand;
  textScore: number | null;
  intentScore: number | null;
  reasons: ExternalSearchReason[];
  row: ExternalSearchRow;
}

export interface RankInput {
  rows: ExternalSearchRow[];
  /** 0..1 lexical relevance per job id, from the indexed retrieval. */
  lexical: Map<string, number>;
  /** 0..1 cosine similarity per job id, from the semantic retrieval. */
  semantic: Map<string, number>;
  /**
   * Whether TEXT RELEVANCE is part of the score.
   *
   * False when there was no query — and also in NEWEST mode, where the
   * candidate set comes from the date index rather than the scoring funnel, so
   * no lexical score was ever computed. Reporting 0 there would say "this job
   * answers your words badly" about a job nobody measured; null says what
   * actually happened, and the score falls back to preference alignment.
   */
  scoreText: boolean;
  soft: SearchSecondaryFilters;
  /** The FX snapshot salary comparisons use. Null degrades salary to UNKNOWN. */
  rates: RateTable | null;
  /**
   * What the reader asked the list to be ordered by.
   *
   * Only the ORDER changes. The score, the band and the reasons are computed
   * identically either way — they describe the job against what was asked for,
   * which is true regardless of how the page happens to be sorted, and a
   * reader switching to Newest should not watch a job's salary verdict change.
   */
  sort: ExternalSearchSort;
  features: (row: ExternalSearchRow) => NormalizedJobFeatures;
}

/**
 * How well one job answers the typed query, 0–100.
 *
 * Two measures of the same thing, and the stronger one wins:
 *
 *   LEXICAL   the words are there — `ts_rank_cd` normalized to 0..1, or a
 *             trigram word-similarity when the tokenizer could not reach the
 *             text (Korean particles, closed-up compounds, typos).
 *   SEMANTIC  the meaning is there — "Server-side Engineer" for a search for
 *             "Backend Engineer".
 *
 * The semantic side is CAPPED below a perfect lexical match. A job literally
 * titled what the candidate searched for has answered the question; one an
 * embedding merely places nearby has offered an alternative, and an
 * alternative must not outrank the thing itself. Without the ceiling, a
 * 0.97-similarity near-miss would beat an exact title match at 0.95 — which
 * is how a semantic search starts feeling like it is ignoring what you typed.
 */
export function textRelevance(
  lexical: number | undefined,
  semantic: number | undefined,
): number {
  const fromLexical = lexical ?? 0;
  const fromSemantic = (semantic ?? 0) * SEMANTIC_TEXT_CEILING;
  return Math.round(Math.max(fromLexical, fromSemantic) * 100);
}

/**
 * Score and order the candidate set.
 *
 * Pure: the same inputs always produce the same order, which is what lets a
 * stored snapshot be trusted and a test assert on it.
 */
export function rankExternalJobs(input: RankInput): ScoredExternalJob[] {
  const soft = hasSecondaryPreferences(input.soft) ? input.soft : null;

  const scored = input.rows.map((row) => {
    const features = input.features(row);

    /*
     * Null, not zero, when the search had no query. Zero would mean "this job
     * answers your words badly"; there were no words. Collapsing the two would
     * make a browse-everything search look like a failed search.
     */
    const textScore = input.scoreText
      ? textRelevance(input.lexical.get(row.id), input.semantic.get(row.id))
      : null;

    const alignment = soft
      ? searchAlignment(features, soft, input.rates)
      : { score: null, alignments: [] };

    const score = externalSearchScore(textScore, alignment.score);

    return {
      externalJobId: row.id,
      score,
      band: externalSearchBand(score),
      textScore,
      intentScore: alignment.score,
      reasons: externalSearchReasons({
        textScore,
        // A job the lexical stage never returned was proposed by meaning
        // alone, and the reason it gives says so rather than implying the
        // candidate's words appeared in it.
        matchedLexically: input.lexical.has(row.id),
        alignments: alignment.alignments,
        isStale: row.status === 'STALE',
      }),
      row,
    };
  });

  const rankable = (entry: (typeof scored)[number]) => ({
    externalJobId: entry.externalJobId,
    score: entry.score,
    textScore: entry.textScore,
    intentScore: entry.intentScore,
    firstSeenAt: entry.row.firstSeenAt,
    employerPostedAt: entry.row.employerPostedAt,
  });

  const compare =
    input.sort === 'NEWEST' ? compareByNewest : compareExternalResults;
  return scored.sort((a, b) => compare(rankable(a), rankable(b)));
}

/**
 * An external row as the shared matcher reads it.
 *
 * A near-copy of `externalJobFeatures`, and deliberately its own function:
 * that one takes a Prisma-shaped row with a nested `company` relation, while
 * search reads a flat projection built by raw SQL — because selecting through
 * Prisma's relation loader for five hundred candidates costs a second query
 * per page. The mapping is identical field for field, and the enums are cast
 * from text because SQL returned them as text.
 */
export function searchRowFeatures(
  row: ExternalSearchRow,
): NormalizedJobFeatures {
  return {
    jobId: row.id,
    sourceType: 'EXTERNAL',
    title: row.title,
    organizationName: row.companyName,
    country: row.countryCode ? row.countryCode.toUpperCase() : null,
    region: row.region,
    city: row.city,
    workMode: row.workMode as NormalizedJobFeatures['workMode'],
    remoteCountriesAllowed: (row.remoteCountriesAllowed ?? []).map((code) =>
      code.toUpperCase(),
    ),
    // Untouched, in the currency the employer posted. Conversion happens once,
    // in the shared FX pipeline, at comparison time.
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    currency: row.currency,
    payPeriod: row.payPeriod as NormalizedJobFeatures['payPeriod'],
    employmentType:
      row.employmentType as NormalizedJobFeatures['employmentType'],
    seniorityLevel:
      row.seniorityLevel as NormalizedJobFeatures['seniorityLevel'],
    benefits: (row.benefits ?? []) as NormalizedJobFeatures['benefits'],
    industries: row.industries ?? [],
  };
}

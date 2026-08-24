import type { MatchBand } from '../../matching/match-policy';
import type { IntentAlignment } from '../../matching/intent-alignment';

/**
 * The ONE versioned policy for candidate-facing external job SEARCH.
 *
 * Every number that turns a query and a set of preferences into an order
 * lives here, so "what does external search do" has exactly one answer and
 * every change to it is a version bump that strands stored snapshots.
 *
 * ## Why this is not `match-policy.ts`
 *
 * AI Job Match and External Search answer different questions, and giving
 * them one policy would force one of them to lie.
 *
 *   AI Job Match     "given everything you can demonstrate, which of these
 *                     jobs fits you best?"  → capability dominates, 80/20.
 *   External Search  "you typed Backend Engineer — which jobs are those?"
 *                     → the query dominates, and preferences reorder.
 *
 * A candidate searching "Accountant" must not be shown engineering roles
 * because their resume is full of engineering evidence. So capability plays no
 * part here at all, the version is separate, and the two can evolve without
 * dragging each other along.
 *
 * ## What the score is NOT
 *
 * It is a 0–100 RELEVANCE number and it decides ORDER only. It is not a
 * probability of being hired, not a quality judgement of the employer, and no
 * threshold anywhere turns it back into a filter — a job that survives the
 * hard constraints is in the results however low it scores, on the last page.
 */

/**
 * v1: text relevance + soft intent alignment.
 *
 * Bump this for any change to the weights, the band thresholds, the text
 * scoring, the tie-break or the retrieval funnel's effect on ordering. Stored
 * runs carry the version and recompute when it moves, even though no data
 * changed — because the same data would now rank differently.
 */
export const EXTERNAL_SEARCH_ALGORITHM_VERSION = 'external-search-v1';

/**
 * How much of the score the TEXT QUERY keeps when both signals exist.
 *
 * The query is why the person is here. At 60/40 a job that answers the search
 * poorly cannot climb over one that answers it well on preferences alone —
 * a 90-relevance job with fully mismatched preferences still scores 54 and
 * beats a 20-relevance job with perfect preferences (48) — while preferences
 * still decide the order meaningfully among jobs of similar relevance, which
 * is where a candidate actually notices them.
 *
 * The shape mirrors AI Job Match (a dominant term plus a bounded adjustment)
 * without borrowing its ratio: there, evidence has to outrank stated wishes;
 * here, the typed query has to outrank saved ones.
 */
export const TEXT_SHARE = 0.6;
export const SEARCH_INTENT_SHARE = 1 - TEXT_SHARE;

/**
 * The neutral score for a search that asked nothing.
 *
 * With no query and no preferences every job scores the same and the order
 * falls to the tie-break. That is the honest answer — the catalogue in a
 * stable order — rather than an invented ranking of jobs against no criteria.
 */
export const NEUTRAL_SCORE = 50;

/**
 * The most a purely SEMANTIC match may claim as text relevance.
 *
 * Semantic retrieval proposes candidates; it does not get to declare them the
 * best answer. A job literally titled "Backend Engineer" must outrank one the
 * embedding merely thinks is nearby, so a semantic-only hit is capped below a
 * strong lexical one. Anything under `MIN_SEMANTIC_SIMILARITY` is not proposed
 * at all — see the retrieval module for why filling a top-K with noise is
 * worse than returning fewer results.
 */
export const SEMANTIC_TEXT_CEILING = 0.85;

/**
 * The floor a semantic hit must clear to be proposed at all.
 *
 * Set from measurement rather than taste. Against the live catalogue with
 * `paraphrase-multilingual-MiniLM-L12-v2`:
 *
 *   "server-side engineer"    0.531 … 0.502   Platform / Product Engineer
 *                                             — genuinely related, and NOT
 *                                             reachable lexically at all
 *   "someone to build APIs"   0.449 … 0.440   Product Support Specialist,
 *                                             Recruiting Ops — noise
 *
 * The gap between "related" and "nearest unrelated thing" is narrow, which is
 * the nature of cosine similarity in a compressed embedding space, and it is
 * why an unfiltered top-K is dangerous: the model always returns K results,
 * so a query with no good answer gets K bad ones. At 0.50 the first example
 * survives intact and the second is refused entirely — which is the right
 * trade, because returning three relevant jobs is better than returning fifty
 * of which forty-seven are noise.
 */
export const MIN_SEMANTIC_SIMILARITY = 0.5;

/**
 * Search bands, which are NOT match bands.
 *
 * The vocabulary is shared with AI Job Match on purpose — four labels in four
 * languages is enough for one product — but the thresholds are their own,
 * because the numbers mean different things. A 70 here is "this answers your
 * search well"; a 70 there is "your evidence covers this job well".
 *
 * Presentation only. No band filters, hides or removes anything.
 */
export const EXTERNAL_SEARCH_BAND_THRESHOLDS = {
  STRONG: 75,
  GOOD: 55,
  PARTIAL: 30,
} as const;

export function externalSearchBand(score: number): MatchBand {
  if (score >= EXTERNAL_SEARCH_BAND_THRESHOLDS.STRONG) return 'STRONG';
  if (score >= EXTERNAL_SEARCH_BAND_THRESHOLDS.GOOD) return 'GOOD';
  if (score >= EXTERNAL_SEARCH_BAND_THRESHOLDS.PARTIAL) return 'PARTIAL';
  return 'LOW';
}

/**
 * The 0–100 relevance score.
 *
 * Null and 0 differ in both inputs: a null text score means the search had no
 * query (not "nothing matched"), and a null intent score means the search
 * stated no soft preferences (not "this job matches none of them"). Treating
 * either absence as a zero would rank a search that asked less as though every
 * job had failed it.
 */
export function externalSearchScore(
  textScore: number | null,
  intentScore: number | null,
): number {
  if (textScore === null && intentScore === null) return NEUTRAL_SCORE;
  if (textScore === null) return Math.round(intentScore as number);
  if (intentScore === null) return Math.round(textScore);
  return Math.round(TEXT_SHARE * textScore + SEARCH_INTENT_SHARE * intentScore);
}

/**
 * Deterministic total order.
 *
 * score desc → text desc → intent desc → firstSeenAt desc → id asc.
 *
 * Every step exists because pagination slices this list: two jobs that compare
 * equal must compare equal on every request, or a reader paging forward sees
 * one job twice and never sees another. The last step is a total order over
 * distinct ids, so the comparison can never fall through.
 *
 * `firstSeenAt` is when THIS CATALOGUE first observed the posting, and it is
 * used only to break ties. It is deliberately not a scored recency signal:
 * no provider in this product states when an employer published a role, and
 * `lastSeenAt` — the obvious-looking substitute — is crawler freshness, so
 * ranking by it would sort employers by how recently our own sweep ran.
 */
export interface RankableExternalResult {
  externalJobId: string;
  score: number;
  textScore: number | null;
  intentScore: number | null;
  firstSeenAt: Date;
}

export function compareExternalResults(
  a: RankableExternalResult,
  b: RankableExternalResult,
): number {
  if (a.score !== b.score) return b.score - a.score;
  const aText = a.textScore ?? -1;
  const bText = b.textScore ?? -1;
  if (aText !== bText) return bText - aText;
  const aIntent = a.intentScore ?? -1;
  const bIntent = b.intentScore ?? -1;
  if (aIntent !== bIntent) return bIntent - aIntent;
  const aSeen = a.firstSeenAt.getTime();
  const bSeen = b.firstSeenAt.getTime();
  if (aSeen !== bSeen) return bSeen - aSeen;
  return a.externalJobId < b.externalJobId
    ? -1
    : a.externalJobId > b.externalJobId
      ? 1
      : 0;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * What the reader asked the list to be ordered by.
 *
 * RELEVANCE is the default and always will be: someone who typed a query is
 * asking which jobs answer it, and a job board whose default order is "most
 * recently posted" answers a question nobody asked.
 */
export const EXTERNAL_SEARCH_SORTS = ['RELEVANCE', 'NEWEST'] as const;
export type ExternalSearchSort = (typeof EXTERNAL_SEARCH_SORTS)[number];
export const DEFAULT_EXTERNAL_SEARCH_SORT: ExternalSearchSort = 'RELEVANCE';

export interface NewestRankable extends RankableExternalResult {
  /** The employer's publication date, or null when no source stated one. */
  employerPostedAt: Date | null;
}

/**
 * Newest-first, as a total order.
 *
 *   1. a job WITH a publication date, before one without
 *   2. `employerPostedAt` descending
 *   3. the relevance order, as a tie-break
 *
 * ## Why undated jobs come last rather than being excluded or dated
 *
 * Half this catalogue has no publication date, because half of it comes from
 * a provider that publishes none. Two tempting shortcuts are both wrong:
 * dropping those jobs would hide real vacancies from someone who only changed
 * the sort, and treating null as an old date (the epoch, or the crawl date)
 * would be inventing the very fact this whole feature exists to avoid
 * inventing. So they keep their place at the end of the list, reachable by
 * paging, in an order that still means something.
 *
 * ## Why relevance breaks ties
 *
 * Two jobs published in the same millisecond are vanishingly rare; two with
 * no date at all are half the catalogue. Falling through to the relevance
 * comparison gives that half a meaningful order instead of an arbitrary one,
 * and it ends on the id, so the whole thing is total — which is what
 * pagination needs. The date still decides everything above it: this is
 * newest-first with a sensible tail, not personalization wearing a date's
 * clothes.
 */
export function compareByNewest(a: NewestRankable, b: NewestRankable): number {
  const aDated = a.employerPostedAt !== null;
  const bDated = b.employerPostedAt !== null;
  if (aDated !== bDated) return aDated ? -1 : 1;

  if (aDated && bDated) {
    const byDate =
      (b.employerPostedAt as Date).getTime() -
      (a.employerPostedAt as Date).getTime();
    if (byDate !== 0) return byDate;
  }

  return compareExternalResults(a, b);
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * Why a job is where it is — as CODES, never prose.
 *
 * Two rules, both load-bearing:
 *
 *  1. **Every reason is derived from a score component that actually fired.**
 *     There is no path that can emit SALARY_WITHIN_DESIRED_RANGE for a job
 *     whose salary is unknown, because the code is read off the alignment the
 *     salary matcher returned. A reason that is not backed by a component is
 *     a reason this function cannot produce.
 *  2. **No language is stored.** The UI localizes these into en/ko/ru/uz. A
 *     snapshot written in English would be wrong for the same candidate on
 *     their next visit, and translating stored prose is not something a model
 *     should be called for.
 */
export type ExternalSearchReasonCode =
  | 'TEXT_STRONG_MATCH'
  | 'TEXT_TITLE_MATCH'
  | 'TEXT_PARTIAL_MATCH'
  | 'TEXT_SEMANTIC_MATCH'
  | 'STALE_LISTING';

export interface ExternalSearchReason {
  code: string;
  /** The score component this came from. `text` when it is not an alignment. */
  dimension: string;
  state: string;
}

/** How strong a text score has to be before it is called a strong match. */
export const TEXT_STRONG_THRESHOLD = 70;
export const TEXT_PARTIAL_THRESHOLD = 25;

/**
 * The reasons for one result, most informative first.
 *
 * Alignment reasons come through verbatim — `LOCATION_EXACT`,
 * `SALARY_BELOW_MINIMUM`, `WORK_MODE_MISMATCH` — because those enums already
 * exist and already mean exactly this on the AI Job Match surface. Inventing
 * parallel search-only names for the same verdicts would give the product two
 * vocabularies for one fact.
 */
export function externalSearchReasons(input: {
  textScore: number | null;
  matchedLexically: boolean;
  alignments: IntentAlignment[];
  isStale: boolean;
  limit?: number;
}): ExternalSearchReason[] {
  const reasons: ExternalSearchReason[] = [];

  if (input.textScore !== null) {
    const code: ExternalSearchReasonCode = !input.matchedLexically
      ? 'TEXT_SEMANTIC_MATCH'
      : input.textScore >= TEXT_STRONG_THRESHOLD
        ? 'TEXT_STRONG_MATCH'
        : input.textScore >= TEXT_PARTIAL_THRESHOLD
          ? 'TEXT_TITLE_MATCH'
          : 'TEXT_PARTIAL_MATCH';
    reasons.push({
      code,
      dimension: 'text',
      state: input.textScore >= TEXT_STRONG_THRESHOLD ? 'MATCH' : 'PARTIAL',
    });
  }

  /*
   * Ordered by how much they explain: a contradiction is the most useful thing
   * to tell someone about a result they did not expect, a match confirms what
   * they asked, and an absence is worth saying last but still worth saying —
   * "the employer did not state a salary" is information, and silently
   * omitting it reads as though the salary matched.
   */
  const rank = (state: string) =>
    state === 'MISMATCH'
      ? 0
      : state === 'MATCH'
        ? 1
        : state === 'PARTIAL'
          ? 2
          : 3;
  const sorted = [...input.alignments].sort(
    (a, b) => rank(a.state) - rank(b.state),
  );
  for (const alignment of sorted) {
    reasons.push({
      code: alignment.reason,
      dimension: alignment.dimension,
      state: alignment.state,
    });
  }

  if (input.isStale) {
    // Surfaced, not hidden: a STALE job is still shown, and the reader is
    // entitled to know nobody has re-observed it lately.
    reasons.push({
      code: 'STALE_LISTING',
      dimension: 'freshness',
      state: 'PARTIAL',
    });
  }

  return reasons.slice(0, input.limit ?? 6);
}

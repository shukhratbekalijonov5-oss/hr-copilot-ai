import Link from "next/link";
import { api } from "@/lib/api";
import { getTranslations } from "@/lib/i18n/server";
import { buttonStyles } from "@/components/ui/Button";
import {
  CandidateCard,
  CandidateEmptyState,
  SectionHeader,
} from "@/components/candidate/ui";
import {
  MatchBandChip,
  MatchScoreRing,
} from "@/components/candidate/ui/MatchScore";
import { Badge } from "@/components/ui/Badge";
import { MapPinIcon, SparkIcon } from "@/components/ui/icons";
import { bandFor } from "@/lib/candidate/dashboard";
import type { Locale } from "@/lib/i18n/locales";
import type { JobMatch } from "@/lib/types";

/**
 * The top few AI matches, streamed into the dashboard.
 *
 * ## An async server component on purpose
 *
 * Ranking is a POST that can touch the whole open catalogue, so it is the one
 * slow read on this page. Leaving it as its own async component lets the
 * dashboard paint without it and lets `Suspense` show a skeleton in its
 * place. It also keeps the call on the server: the browser never learns the
 * matching endpoint, and no ranking logic ships to it.
 *
 * ## Three cards, and no second opinion about them
 *
 * `limit: 3` and no `refresh` — this is a READ of the ranking the product
 * already computed, never a new run triggered by visiting a dashboard. The
 * band, the score and the order are all the server's; this file renames the
 * band for the palette and rounds the score for display, and does nothing
 * else to either.
 */
export async function DashboardMatches({
  locale,
  canUseInternalAiJobs,
  canRunJobMatch,
}: {
  locale: Locale;
  canUseInternalAiJobs: boolean;
  /** The account has evidence; without it the backend has nothing to rank. */
  canRunJobMatch: boolean;
}) {
  const d = await getTranslations();
  const copy = d.home.matches;

  const header = (
    <SectionHeader
      id="matches-title"
      title={
        <span className="inline-flex items-center gap-1.5">
          <SparkIcon className="size-4 text-ai-ink" />
          {copy.title}
        </span>
      }
      description={copy.description}
      action={
        <Link
          href="/job-matches"
          className="text-[12.5px] font-medium text-brand transition-colors duration-[var(--motion-fast)] hover:text-brand-hover"
        >
          {copy.viewAll}
        </Link>
      }
    />
  );

  /*
   * Two reasons not to call the API, both known before the request: the plan
   * does not include internal AI search, or the account has no evidence to
   * rank against. Either way the honest screen names the next step instead of
   * spending a ranking pass to display an empty list.
   */
  if (!canUseInternalAiJobs || !canRunJobMatch) {
    return (
      <section aria-labelledby="matches-title">
        {header}
        <CandidateEmptyState
          icon={<SparkIcon className="size-4.5" />}
          title={canUseInternalAiJobs ? copy.empty : copy.title}
          description={canUseInternalAiJobs ? copy.emptyHint : copy.lockedHint}
          action={
            <Link href="/job-matches" className={buttonStyles("secondary", "sm")}>
              {canUseInternalAiJobs ? copy.needsEvidence : copy.run}
            </Link>
          }
        />
      </section>
    );
  }

  let matches: JobMatch[] = [];
  let failed = false;
  try {
    const result = await api.getJobMatches({ locale, page: 1, limit: 3 });
    matches = result.matches;
  } catch {
    // Includes the plan refusal the session did not know about yet. Either
    // way this panel says so in its own space; the dashboard still renders.
    failed = true;
  }

  if (failed || matches.length === 0) {
    return (
      <section aria-labelledby="matches-title">
        {header}
        <CandidateEmptyState
          icon={<SparkIcon className="size-4.5" />}
          title={failed ? copy.unavailable : copy.empty}
          description={failed ? copy.unavailableHint : copy.emptyHint}
          action={
            <Link href="/job-matches" className={buttonStyles("secondary", "sm")}>
              {copy.run}
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="matches-title">
      {header}
      <ul className="flex flex-col gap-3">
        {matches.map((match) => {
          const band = bandFor(match.band);
          const percent = Math.round(match.score);
          const bandLabel = d.jobMatch.band[match.band] ?? match.band;

          return (
            <li key={match.vacancy.slug}>
              <CandidateCard interactive className="p-4">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <MatchBandChip band={band}>{bandLabel}</MatchBandChip>
                      <Badge tone="neutral">{copy.sourceInternal}</Badge>
                    </div>
                    <h3 className="mt-2 text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                      <Link
                        href={`/jobs/${match.vacancy.slug}`}
                        className="transition-colors duration-[var(--motion-fast)] hover:text-brand"
                      >
                        {match.vacancy.title}
                      </Link>
                    </h3>
                    <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                      {match.vacancy.organizationName}
                    </p>
                    {match.vacancy.location ? (
                      <p className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] text-ink-muted">
                        <MapPinIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{match.vacancy.location}</span>
                      </p>
                    ) : null}
                  </div>

                  {/*
                    The figure orders the list and nothing more, so it is a
                    44px ring beside the title rather than the loudest thing
                    on the card. The band beside the title is what a reader
                    is meant to act on.
                  */}
                  <MatchScoreRing
                    percent={percent}
                    band={band}
                    label={`${bandLabel} · ${percent}`}
                  />
                </div>

                <div className="mt-3 flex justify-end border-t border-line pt-3">
                  <Link
                    href={`/jobs/${match.vacancy.slug}`}
                    className={buttonStyles("secondary", "sm")}
                  >
                    {copy.view}
                  </Link>
                </div>
              </CandidateCard>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  EvidenceResults,
  EvidenceResultsSkeleton,
} from "@/components/search/EvidenceResults";
import {
  GroundedSummary,
  GroundedSummarySkeleton,
} from "@/components/search/GroundedSummary";
import { SearchForm } from "@/components/search/SearchForm";
import { getI18n } from "@/lib/i18n/server";
import {
  MIN_EVIDENCE_QUERY_LENGTH,
  runEvidenceSearch,
  runGroundedAnswer,
} from "@/lib/search/grounded-search";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.nav.aiSearch };
}

/**
 * Recruiter search: one query, two independent halves.
 *
 * The query lives in the URL. Both backend calls — evidence retrieval and the
 * grounded answer — are started here WITHOUT being awaited, then handed as
 * promises to client components inside separate Suspense boundaries. React
 * streams each section in when its call settles, so the passages appear in a
 * couple of seconds while generation takes its 20-30s, and neither side's
 * failure touches the other.
 *
 * Server Actions could not do this: Next dispatches actions one at a time per
 * client, so firing two from the browser would serialize them. Parallel
 * fetches in a Server Component are the documented way to run them
 * concurrently — through the same apiFetch, so a token expiring mid-flight
 * still refreshes once via the single-flight lock, not twice.
 *
 * The boundaries are keyed by the query so a new search shows fresh loading
 * states instead of holding last search's results on screen for 20 seconds.
 */
export default async function SearchPage(props: PageProps<"/search">) {
  await requireSession();
  const [{ locale, d }, searchParams] = await Promise.all([
    getI18n(),
    props.searchParams,
  ]);

  const raw = searchParams.q;
  const query = (typeof raw === "string" ? raw : "").trim();
  const active = query.length >= MIN_EVIDENCE_QUERY_LENGTH;

  // Deliberately not awaited — see above.
  const answer = active ? runGroundedAnswer(query, locale) : null;
  const evidence = active ? runEvidenceSearch(query) : null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={d.search.title} description={d.search.description} />
      <div className="flex flex-col gap-4">
        <SearchForm key={query} query={active ? query : ""} />

        {answer ? (
          <Suspense key={`answer-${query}`} fallback={<GroundedSummarySkeleton />}>
            <GroundedSummary result={answer} />
          </Suspense>
        ) : null}

        {evidence ? (
          <Suspense key={`evidence-${query}`} fallback={<EvidenceResultsSkeleton />}>
            <EvidenceResults result={evidence} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

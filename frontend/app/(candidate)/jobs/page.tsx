import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobBoard } from "@/components/jobs/JobBoard";
import {
  explicitFilters,
  readSearchParams,
  resolveJobQuery,
} from "@/lib/candidate/job-search-filters";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobs.title };
}

export default async function JobsPage(props: PageProps<"/jobs">) {
  const { session } = await requirePersonalWorkspace();
  const [d, locale, searchParams] = await Promise.all([
    getTranslations(),
    getLocale(),
    props.searchParams,
  ]);

  const params = readSearchParams(searchParams);

  /*
   * The candidate's SAVED intent, resolved against what they just typed.
   *
   * The backend owns the precedence (explicit request beats saved preference,
   * per dimension) so this page never re-implements it — and resolving is
   * read-only, so searching for Toronto today leaves a saved Seoul exactly
   * where it was. A candidate with no account or no preferences gets null,
   * which means "no restriction": the search is then whatever they typed and
   * nothing more.
   */
  const context = session.hasCandidateAccount
    ? await api
        .getJobSearchContext({ ...explicitFilters(params), locale })
        .catch(() => null)
    : null;
  const query = resolveJobQuery(params, context);

  /**
   * Saved state comes from the caller's own bookmarks, so every card can show
   * the right control on first paint. A user without a candidate account has
   * none — the endpoint requires one — and an empty list is the honest answer
   * rather than a failed page.
   */
  const [jobs, saved] = await Promise.all([
    api.getPublicJobs({ page: params.page, ...query }),
    session.hasCandidateAccount
      ? api.getSavedJobs(1, 100).catch(() => ({ saved: [] }))
      : Promise.resolve({ saved: [] }),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={d.jobs.title} description={d.jobs.description} />
      <JobBoard
        page={jobs}
        savedSlugs={saved.saved.map((item) => item.job.publicSlug)}
        params={params}
        usingPreferences={query.usingPreferences}
      />
    </div>
  );
}

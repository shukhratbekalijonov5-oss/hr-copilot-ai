import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobBoard } from "@/components/jobs/JobBoard";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobs.title };
}

export default async function JobsPage(props: PageProps<"/jobs">) {
  const { session } = await requirePersonalWorkspace();
  const [d, searchParams] = await Promise.all([
    getTranslations(),
    props.searchParams,
  ]);

  const asText = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : "";
  const search = asText(searchParams.search);
  const location = asText(searchParams.location);
  const page = Number(asText(searchParams.page)) || 1;

  /**
   * Saved state comes from the caller's own bookmarks, so every card can show
   * the right control on first paint. A user without a candidate account has
   * none — the endpoint requires one — and an empty list is the honest answer
   * rather than a failed page.
   */
  const [jobs, saved] = await Promise.all([
    api.getPublicJobs({ page, search, location }),
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
        search={search}
        location={location}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { SearchIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.personal.findJobs };
}

export default async function JobsPage() {
  await requirePersonalWorkspace();
  const d = await getTranslations();

  if (!BACKEND_CAPABILITIES.publicJobs) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title={d.personal.findJobs}
          description={d.personal.findJobsDescription}
        />
        <UnavailableState
          icon={<SearchIcon className="size-5" />}
          title={d.personal.findJobsUnavailable}
          description={d.personal.findJobsUnavailableHint}
          requires={d.personal.findJobsRequires}
        />
      </div>
    );
  }

  // Intentionally unreachable until the capability flag flips; the listing is
  // built against the real endpoint at that point, never against sample data.
  return null;
}

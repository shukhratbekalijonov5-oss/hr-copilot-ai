import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { FileIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.personal.savedJobs };
}

export default async function SavedJobsPage() {
  await requirePersonalWorkspace();
  const d = await getTranslations();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={d.personal.savedJobs}
        description={d.personal.savedJobsDescription}
      />

      {!BACKEND_CAPABILITIES.savedJobs ? (
        <UnavailableState
          icon={<FileIcon className="size-5" />}
          title={d.personal.savedJobsUnavailable}
          description={d.personal.savedJobsUnavailableHint}
          requires={d.personal.savedJobsRequires}
        />
      ) : null}
    </div>
  );
}

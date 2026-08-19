import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { BriefcaseIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.personal.job };
}

export default async function JobDetailPage(props: PageProps<"/jobs/[id]">) {
  await requirePersonalWorkspace();
  await props.params;
  const d = await getTranslations();

  if (!BACKEND_CAPABILITIES.publicJobs) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={d.personal.jobDetail}
          breadcrumbs={[
            { label: d.personal.findJobs, href: "/jobs" },
            { label: d.personal.job },
          ]}
        />
        <UnavailableState
          icon={<BriefcaseIcon className="size-5" />}
          title={d.personal.jobUnavailable}
          description={d.personal.jobUnavailableHint}
          requires={d.personal.jobRequires}
        />
      </div>
    );
  }

  return null;
}

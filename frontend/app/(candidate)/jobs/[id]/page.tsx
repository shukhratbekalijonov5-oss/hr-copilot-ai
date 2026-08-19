import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { BriefcaseIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Job" };

export default async function JobDetailPage(
  props: PageProps<"/jobs/[id]">,
) {
  await requirePersonalWorkspace();
  await props.params;

  if (!BACKEND_CAPABILITIES.publicJobs) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Job detail"
          breadcrumbs={[{ label: "Find jobs", href: "/jobs" }, { label: "Job" }]}
        />
        <UnavailableState
          icon={<BriefcaseIcon className="size-5" />}
          title="This job cannot be shown publicly yet"
          description="Reading a vacancy requires membership of the organization that posted it, so there is nothing a job seeker can open. The apply flow depends on the same contract."
          requires={[
            "A public vacancy detail endpoint exposing title, description, requirements, location and employment type only",
            "An endpoint that lets an authenticated job seeker apply to a vacancy for themselves",
          ]}
        />
      </div>
    );
  }

  return null;
}

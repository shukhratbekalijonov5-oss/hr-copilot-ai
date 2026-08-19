import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { FileIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Saved jobs" };

export default async function SavedJobsPage() {
  await requirePersonalWorkspace();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Saved jobs"
        description="Roles you want to come back to."
      />

      {!BACKEND_CAPABILITIES.savedJobs ? (
        <UnavailableState
          icon={<FileIcon className="size-5" />}
          title="Saving jobs is not available yet"
          description="Saved roles need to belong to your account so they follow you across devices — and to the mobile app later. Keeping them in this browser's storage would look like it works until you sign in somewhere else."
          requires={[
            "A saved-jobs collection on the CandidateAccount",
            "Endpoints to save, list and remove a saved vacancy",
          ]}
        />
      ) : null}
    </div>
  );
}

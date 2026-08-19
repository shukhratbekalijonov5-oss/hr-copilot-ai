import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { SearchIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = { title: "Find jobs" };

export default async function JobsPage() {
  await requirePersonalWorkspace();

  if (!BACKEND_CAPABILITIES.publicJobs) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Find jobs"
          description="Browse open roles and apply with the resume already on your profile."
        />
        <UnavailableState
          icon={<SearchIcon className="size-5" />}
          title="Job discovery is not open yet"
          description="Vacancies currently live inside each recruiting organization and are only readable by that organization's own team. There is no public listing to browse, and inventing one would show roles that nobody can actually apply to."
          requires={[
            "A public vacancy endpoint that returns only OPEN roles, with organization display name — never internal draft or archived postings",
            "A stable public identifier per vacancy so a job link can be shared outside the workspace",
          ]}
        />
      </div>
    );
  }

  // Intentionally unreachable until the capability flag flips; the listing is
  // built against the real endpoint at that point, never against sample data.
  return null;
}

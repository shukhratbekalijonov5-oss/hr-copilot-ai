import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { SavedJobsView } from "@/components/candidate/SavedJobsView";
import { CandidateAccountRequired } from "@/components/candidate/CandidateAccountRequired";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.savedJobs.title };
}

export default async function SavedJobsPage() {
  const { session } = await requirePersonalWorkspace();
  const d = await getTranslations();

  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={d.savedJobs.title}
          description={d.savedJobs.description}
        />
        <CandidateAccountRequired />
      </div>
    );
  }

  const page = await api.getSavedJobs(1, 50);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={d.savedJobs.title}
        description={d.savedJobs.description}
      />
      <SavedJobsView saved={page.saved} />
    </div>
  );
}

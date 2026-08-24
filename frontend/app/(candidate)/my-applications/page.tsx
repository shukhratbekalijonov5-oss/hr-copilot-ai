import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { CandidatePageHeader } from "@/components/candidate/ui";
import { MyApplicationsView } from "@/components/candidate/MyApplicationsView";
import { CandidateAccountRequired } from "@/components/candidate/CandidateAccountRequired";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.applications.title };
}

export default async function MyApplicationsPage() {
  const { session } = await requirePersonalWorkspace();
  const d = await getTranslations();

  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-4xl">
        <CandidatePageHeader
          eyebrow={d.nav.sectionCareer}
          title={d.applications.title}
          description={d.applications.description}
        />
        <CandidateAccountRequired />
      </div>
    );
  }

  const page = await api.getMyApplications(1, 50);

  return (
    <div className="mx-auto max-w-4xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionCareer}
        title={d.applications.title}
        description={d.applications.description}
      />
      <MyApplicationsView applications={page.applications} />
    </div>
  );
}

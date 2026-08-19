import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateListView } from "@/components/candidates/CandidateListView";
import { UploadPanel } from "@/components/upload/UploadPanel";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.candidates.title };
}

export default async function CandidatesPage(
  props: PageProps<"/candidates">,
) {
  await requireSession();
  const d = await getTranslations();

  const [candidates, vacancies, searchParams] = await Promise.all([
    api.getAllCandidates(),
    api.getAllVacancies(),
    props.searchParams,
  ]);

  const vacancyParam = searchParams.vacancy;
  const initialVacancyId =
    typeof vacancyParam === "string" ? vacancyParam : "all";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={d.candidates.title}
        description={d.candidates.description}
        actions={<UploadPanel />}
      />
      <CandidateListView
        candidates={candidates}
        vacancies={vacancies}
        initialVacancyId={initialVacancyId}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateListView } from "@/components/candidates/CandidateListView";
import { getTranslations } from "@/lib/i18n/server";
import { selectedVacancyId } from "@/lib/vacancy/selection";

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

  const initialVacancyId = selectedVacancyId(searchParams) ?? "all";

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={d.candidates.title}
        description={d.candidates.description}
      />
      <CandidateListView
        candidates={candidates}
        vacancies={vacancies}
        initialVacancyId={initialVacancyId}
      />
    </div>
  );
}

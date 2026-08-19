import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateListView } from "@/components/candidates/CandidateListView";
import { UploadPanel } from "@/components/upload/UploadPanel";

export const metadata: Metadata = { title: "Candidates" };

export default async function CandidatesPage(
  props: PageProps<"/candidates">,
) {
  await requireSession();

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
        title="Candidates"
        description="Everyone in your pipeline, with the state of their documents. Nobody is ranked or filtered by the model."
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

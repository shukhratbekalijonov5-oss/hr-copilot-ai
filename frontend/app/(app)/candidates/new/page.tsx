import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateForm } from "@/components/candidates/CandidateForm";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.candidates.add };
}

export default async function NewCandidatePage(
  props: PageProps<"/candidates/new">,
) {
  await requireSession();
  const d = await getTranslations();

  const [vacancies, searchParams] = await Promise.all([
    api.getAllVacancies(),
    props.searchParams,
  ]);

  const vacancyParam = searchParams.vacancy;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={d.candidates.add}
        description={d.vacancyDetail.newCandidateHint}
        breadcrumbs={[
          { label: d.candidates.title, href: "/candidates" },
          { label: d.vacancyDetail.breadcrumbNew },
        ]}
      />
      <CandidateForm
        vacancies={vacancies.filter((vacancy) => vacancy.status === "OPEN")}
        initialVacancyId={
          typeof vacancyParam === "string" ? vacancyParam : ""
        }
      />
    </div>
  );
}

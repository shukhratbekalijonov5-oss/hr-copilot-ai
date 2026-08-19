import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CandidateForm } from "@/components/candidates/CandidateForm";

export const metadata: Metadata = { title: "Add candidate" };

export default async function NewCandidatePage(
  props: PageProps<"/candidates/new">,
) {
  await requireSession();

  const [vacancies, searchParams] = await Promise.all([
    api.getAllVacancies(),
    props.searchParams,
  ]);

  const vacancyParam = searchParams.vacancy;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Add candidate"
        description="Create the person first, then upload their resume on the next screen."
        breadcrumbs={[
          { label: "Candidates", href: "/candidates" },
          { label: "New" },
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

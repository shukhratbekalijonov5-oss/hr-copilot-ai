import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { VacancyForm } from "@/components/vacancies/VacancyForm";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.vacancyDetail.newVacancyTitle };
}

export default async function NewVacancyPage() {
  const d = await getTranslations();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={d.vacancyDetail.newVacancyTitle}
        description={d.vacancyDetail.newVacancyHint}
        breadcrumbs={[
          { label: d.vacancies.title, href: "/vacancies" },
          { label: d.vacancyDetail.breadcrumbNew },
        ]}
      />
      <VacancyForm />
    </div>
  );
}

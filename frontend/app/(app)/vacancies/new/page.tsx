import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { VacancyForm } from "@/components/vacancies/VacancyForm";

export const metadata: Metadata = { title: "New vacancy" };

export default function NewVacancyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Create vacancy"
        description="Requirements you add here are what every uploaded resume gets checked against."
        breadcrumbs={[
          { label: "Vacancies", href: "/vacancies" },
          { label: "New" },
        ]}
      />
      <VacancyForm />
    </div>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonStyles } from "@/components/ui/Button";
import { PlusIcon } from "@/components/ui/icons";
import { VacancyListView } from "@/components/vacancies/VacancyListView";

export const metadata: Metadata = { title: "Vacancies" };

export default async function VacanciesPage() {
  const [vacancies, departments] = await Promise.all([
    api.getVacancies(),
    api.getDepartments(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Vacancies"
        description="Every role you are hiring for, and the requirements each resume is checked against."
        actions={
          <Link href="/vacancies/new" className={buttonStyles("primary", "md")}>
            <PlusIcon className="size-4" />
            Create vacancy
          </Link>
        }
      />
      <VacancyListView vacancies={vacancies} departments={departments} />
    </div>
  );
}

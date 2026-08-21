import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonStyles } from "@/components/ui/Button";
import { PlusIcon } from "@/components/ui/icons";
import { VacancyListView } from "@/components/vacancies/VacancyListView";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.vacancies.title };
}

export default async function VacanciesPage() {
  await requireSession();
  const d = await getTranslations();

  /**
   * The catalog stays organization-wide — every member may SEE a colleague's
   * vacancy. `/vacancies/mine` is loaded alongside it purely to mark which
   * rows the caller may operate on, so the list can hide selection and delete
   * controls that would only ever 403.
   */
  const [vacancies, mine] = await Promise.all([
    api.getAllVacancies(),
    api.getAllMyVacancies(),
  ]);

  // The API has no departments endpoint; the filter is built from what the
  // loaded vacancies actually use.
  const departments = [
    ...new Set(
      vacancies
        .map((vacancy) => vacancy.department)
        .filter((department): department is string => Boolean(department)),
    ),
  ].sort();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={d.vacancies.title}
        description={d.vacancies.description}
        actions={
          <Link href="/vacancies/new" className={buttonStyles("primary", "md")}>
            <PlusIcon className="size-4" />
            {d.vacancies.create}
          </Link>
        }
      />
      <VacancyListView
        vacancies={vacancies}
        departments={departments}
        ownedIds={mine.map((vacancy) => vacancy.id)}
      />
    </div>
  );
}

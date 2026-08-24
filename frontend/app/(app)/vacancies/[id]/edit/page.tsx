import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { VacancyForm } from "@/components/vacancies/VacancyForm";
import { getI18n } from "@/lib/i18n/server";
import type { Vacancy } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.vacancyForm.editTitle };
}

/**
 * Edit one vacancy.
 *
 * Reachable only from the vacancy's own page, where the link is rendered for
 * the creator alone — but that is presentation. The PATCH behind this form is
 * re-authorized server-side on every request, so opening this URL for a
 * colleague's vacancy produces a refusal, not an edit.
 */
export default async function EditVacancyPage(
  props: PageProps<"/vacancies/[id]/edit">,
) {
  await requireSession();
  const { d } = await getI18n();
  const { id } = await props.params;

  let vacancy: Vacancy;
  try {
    vacancy = await api.getVacancy(id);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        breadcrumbs={[
          { label: d.vacancies.title, href: "/vacancies" },
          { label: vacancy.title, href: `/vacancies/${vacancy.id}` },
          { label: d.vacancyForm.editTitle },
        ]}
        title={d.vacancyForm.editTitle}
        description={d.vacancyForm.editHint}
      />
      <VacancyForm vacancy={vacancy} />
    </div>
  );
}

import { NotFoundState } from "@/components/ui/NotFoundState";
import { getTranslations } from "@/lib/i18n/server";

export default async function VacancyNotFound() {
  const d = await getTranslations();

  return (
    <NotFoundState
      title={d.vacancies.notFound}
      description={d.vacancyDetail.deletedOrWrongLink}
      backHref="/vacancies"
      backLabel={d.vacancies.backToVacancies}
    />
  );
}

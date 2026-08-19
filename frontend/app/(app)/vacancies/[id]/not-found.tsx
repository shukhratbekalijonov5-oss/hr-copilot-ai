import { NotFoundState } from "@/components/ui/NotFoundState";

export default function VacancyNotFound() {
  return (
    <NotFoundState
      title="Vacancy not found"
      description="This vacancy may have been deleted, or the link is wrong."
      backHref="/vacancies"
      backLabel="Back to vacancies"
    />
  );
}

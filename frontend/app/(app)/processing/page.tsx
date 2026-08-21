import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { MyVacancySelector } from "@/components/vacancies/MyVacancySelector";
import { ProcessingView } from "@/components/processing/ProcessingView";
import { getTranslations } from "@/lib/i18n/server";
import { selectedVacancyId } from "@/lib/vacancy/selection";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.processing.title };
}

/**
 * Processing stays document-centric and organization-wide by default: one
 * document is one job, shared by every vacancy its candidate joins, and jobs
 * for documents with no candidate link are only visible unfiltered. The
 * vacancy filter narrows that view to one owned pipeline — it never duplicates
 * a job per vacancy, and "All" remains available for lawful monitoring.
 */
export default async function ProcessingPage(props: PageProps<"/processing">) {
  await requireOrganizationWorkspace();
  const [d, vacancies, searchParams] = await Promise.all([
    getTranslations(),
    api.getAllMyVacancies(),
    props.searchParams,
  ]);

  const requested = selectedVacancyId(searchParams);
  // Unlike the working surfaces, an unknown id here just falls back to the
  // unfiltered view: this screen is monitoring, and showing everything is a
  // safe superset rather than another vacancy's data.
  const vacancyId = vacancies.some((v) => v.id === requested) ? requested : null;

  const [{ jobs }, summary] = await Promise.all([
    api.getProcessingJobs({ limit: 100, vacancyId: vacancyId ?? undefined }),
    api.getProcessingSummary(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={d.processing.title}
        description={d.processing.description}
      />
      {vacancies.length > 0 ? (
        <div className="mb-4">
          <MyVacancySelector
            vacancies={vacancies}
            value={vacancyId}
            allowEmpty
          />
        </div>
      ) : null}
      <ProcessingView key={vacancyId ?? "all"} jobs={jobs} summary={summary} />
    </div>
  );
}

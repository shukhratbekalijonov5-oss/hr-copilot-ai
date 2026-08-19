import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompareWorkspace } from "@/components/compare/CompareWorkspace";
import { MIN_COMPARE_CANDIDATES } from "@/lib/constants";
import type { ComparisonResult } from "@/lib/types";

export const metadata: Metadata = { title: "Compare" };

export default async function ComparePage(props: PageProps<"/compare">) {
  await requireSession();

  const [vacancies, candidates, searchParams] = await Promise.all([
    api.getAllVacancies(),
    api.getAllCandidates(),
    props.searchParams,
  ]);

  const comparable = vacancies.filter((vacancy) => vacancy.candidateCount > 0);
  const vacancyParam = searchParams.vacancy;
  const requestedId = typeof vacancyParam === "string" ? vacancyParam : "";

  const selectedVacancy =
    comparable.find((vacancy) => vacancy.id === requestedId) ?? comparable[0];

  // The default selection and its comparison are resolved here so the table is
  // present on first paint instead of appearing after a client round-trip.
  const pool = selectedVacancy
    ? candidates.filter(
        (candidate) =>
          candidate.primaryVacancyId === selectedVacancy.id &&
          candidate.processingStatus === "COMPLETED",
      )
    : [];
  const initialSelected = pool.slice(0, 3).map((candidate) => candidate.id);

  let initialResult: ComparisonResult | null = null;
  if (selectedVacancy && initialSelected.length >= MIN_COMPARE_CANDIDATES) {
    initialResult = await api.compareCandidates(
      selectedVacancy.id,
      initialSelected,
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Compare candidates"
        description="Line up requirement evidence side by side, with the source passage behind every cell."
      />
      <CompareWorkspace
        vacancies={comparable}
        candidates={candidates}
        initialVacancyId={selectedVacancy?.id ?? ""}
        initialSelected={initialSelected}
        initialResult={initialResult}
      />
    </div>
  );
}

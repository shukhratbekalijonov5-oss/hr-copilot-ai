import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompareWorkspace } from "@/components/compare/CompareWorkspace";
import { MIN_COMPARE_CANDIDATES } from "@/lib/constants";
import { getTranslations } from "@/lib/i18n/server";
import {
  resolveVacancySelection,
  selectedVacancyId,
} from "@/lib/vacancy/selection";
import type { ComparisonResult, VacancyCandidate } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.nav.compare };
}

/**
 * Compare — vacancy first, end to end.
 *
 * The picker is `/vacancies/mine` and the candidate pool is
 * `/vacancies/:id/candidates`: the org-wide candidate directory is no longer
 * loaded and filtered in the browser, so the pool is exactly the set the
 * backend will accept for evidence mapping (owned vacancy + associated
 * candidate) — every row is somebody who applied to it.
 *
 * The selection lives in `?vacancyId=`, so switching vacancy re-runs this
 * component and remounts the workspace — which is what drops the previous
 * candidate selection, comparison table and error state.
 */
export default async function ComparePage(props: PageProps<"/compare">) {
  await requireOrganizationWorkspace();
  const [d, vacancies, searchParams] = await Promise.all([
    getTranslations(),
    api.getAllMyVacancies(),
    props.searchParams,
  ]);

  const requested = selectedVacancyId(searchParams);
  const { selected: vacancy, invalid } = resolveVacancySelection(
    vacancies,
    requested,
  );

  let rows: VacancyCandidate[] = [];
  if (vacancy) {
    const page = await api
      .getVacancyCandidates(vacancy.id, { limit: 100 })
      .catch(() => null);
    rows = page?.rows ?? [];
  }

  // Comparable = in this vacancy with something indexed to compare.
  const pool = rows.filter((row) => row.candidate.documentCount > 0);
  const initialSelected = pool.slice(0, 3).map((row) => row.candidate.id);

  // Resolved here so the table is present on first paint rather than after a
  // client round-trip.
  let initialResult: ComparisonResult | null = null;
  if (vacancy && initialSelected.length >= MIN_COMPARE_CANDIDATES) {
    initialResult = await api
      .compareCandidates(vacancy.id, initialSelected)
      .catch(() => null);
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={d.compare.title} description={d.compare.description} />
      <CompareWorkspace
        // A vacancy switch is a remount, so no state from the previous
        // vacancy can survive into the next one.
        key={vacancy?.id ?? "none"}
        vacancies={vacancies}
        vacancyCandidates={rows}
        activeVacancyId={vacancy?.id ?? null}
        invalidSelection={invalid}
        initialSelected={initialSelected}
        initialResult={initialResult}
      />
    </div>
  );
}

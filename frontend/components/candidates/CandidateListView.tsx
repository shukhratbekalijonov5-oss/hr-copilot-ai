"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { CandidateCard } from "@/components/candidates/CandidateCard";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Field";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { SearchIcon, UsersIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { SplitView } from "@/components/workspace/SplitView";
import { CandidatePreview } from "@/components/candidates/CandidatePreview";
import { DOCUMENT_STATUSES } from "@/lib/types";
import type { Candidate, CandidateSortKey, Vacancy } from "@/lib/types";

interface CandidateListViewProps {
  candidates: Candidate[];
  vacancies: Vacancy[];
  initialVacancyId?: string;
}

export function CandidateListView({
  candidates,
  vacancies,
  initialVacancyId = "all",
}: CandidateListViewProps) {
  const { d, f, p } = useI18n();
  const [search, setSearch] = useState("");
  const [vacancyId, setVacancyId] = useState(initialVacancyId);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<CandidateSortKey>("recent");
  /*
   * The previewed candidate, by id rather than by object, so a re-filter or a
   * re-sort cannot leave a stale row selected — the id is looked up against
   * the CURRENT filtered set on every render, and a selection filtered out
   * simply falls back to no selection.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Rebuilt per locale rather than hoisted to module scope.
  const sortOptions = useMemo<{ value: CandidateSortKey; label: string }[]>(
    () => [
      { value: "recent", label: d.candidates.sortRecent },
      { value: "name", label: d.tables.sortNameAZ },
      { value: "experience", label: d.tables.sortExperienceYears },
    ],
    [d],
  );

  const statusOptions = useMemo(
    () => [
      { value: "all", label: d.tables.allProcessingStates },
      { value: "none", label: d.tables.noDocumentsFilter },
      ...DOCUMENT_STATUSES.map((status) => ({
        value: status,
        label: d.status.document[status],
      })),
    ],
    [d],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    const rows = candidates.filter((candidate) => {
      if (vacancyId !== "all" && candidate.primaryVacancyId !== vacancyId) {
        return false;
      }
      if (status === "none" && candidate.processingStatus !== null) return false;
      if (
        status !== "all" &&
        status !== "none" &&
        candidate.processingStatus !== status
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        candidate.fullName,
        candidate.currentTitle,
        candidate.location,
      ].some((field) => (field ?? "").toLowerCase().includes(needle));
    });

    const sorters: Record<CandidateSortKey, (a: Candidate, b: Candidate) => number> = {
      recent: (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      name: (a, b) => a.fullName.localeCompare(b.fullName),
      experience: (a, b) =>
        (b.totalExperienceYears ?? -1) - (a.totalExperienceYears ?? -1),
    };

    return [...rows].sort(sorters[sort]);
  }, [candidates, search, vacancyId, status, sort]);

  const columns: Column<Candidate>[] = [
    {
      key: "name",
      header: d.tables.candidate,
      render: (candidate) => (
        <div className="flex items-center gap-2.5">
          <Avatar
            name={candidate.fullName}
            src={candidate.avatarUrl}
            size="sm"
          />
          <div className="min-w-0">
            <Link
              href={`/candidates/${candidate.id}`}
              className="block truncate font-medium text-ink hover:text-brand"
            >
              {candidate.fullName}
            </Link>
            <p className="truncate text-[12.5px] text-ink-muted">
              {candidate.currentTitle ?? d.common.notSet}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "experience",
      header: d.tables.experience,
      align: "right",
      hideBelow: "lg",
      render: (candidate) => (
        <span className="whitespace-nowrap tabular-nums text-ink-muted">
          {candidate.totalExperienceYears === null
            ? d.tables.empty
            : p(d.tables.yearsShort, candidate.totalExperienceYears)}
        </span>
      ),
    },
    {
      key: "location",
      header: d.tables.location,
      hideBelow: "xl",
      render: (candidate) => (
        <span className="text-ink-muted">{candidate.location ?? d.tables.empty}</span>
      ),
    },
    {
      key: "documents",
      header: d.tables.documents,
      hideBelow: "lg",
      render: (candidate) => (
        <span className="text-ink-muted">
          {candidate.documentCount === 0
            ? d.tables.noneUploaded
            : p(d.common.files, candidate.documentCount)}
        </span>
      ),
    },
    {
      key: "vacancy",
      header: d.tables.vacancy,
      hideBelow: "md",
      render: (candidate) =>
        candidate.primaryVacancyId ? (
          <Link
            href={`/vacancies/${candidate.primaryVacancyId}`}
            className="text-ink-muted hover:text-brand"
          >
            {candidate.primaryVacancyTitle}
          </Link>
        ) : (
          <span className="text-ink-subtle">{d.tables.empty}</span>
        ),
    },
    {
      key: "processing",
      header: d.tables.processing,
      align: "right",
      render: (candidate) => (
        <DocumentStatusBadge status={candidate.processingStatus} />
      ),
    },
  ];

  const empty = (
    <EmptyState
      icon={<UsersIcon className="size-5" />}
      title={
        candidates.length === 0 ? d.candidates.empty : d.candidates.noMatches
      }
      description={
        candidates.length === 0
          ? d.tables.candidatesEmptyHint
          : d.tables.candidatesNoMatchHint
      }
    />
  );

  const selected = filtered.find((candidate) => candidate.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Input
          type="search"
          placeholder={d.tables.searchCandidates}
          value={search}
          aria-label={d.tables.searchCandidatesLabel}
          leading={<SearchIcon className="size-4" />}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="lg:max-w-xs lg:flex-1"
        />
        {/*
          One column on the narrowest phones. At 390px two side-by-side
          selects gave each ~185px, which truncated "All processing states"
          mid-word — the browser pass caught it. `xs`-style stacking costs a
          row of height and makes every option label readable.
        */}
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
          <Select
            aria-label={d.tables.filterByVacancy}
            value={vacancyId}
            options={[
              { value: "all", label: d.candidates.allVacancies },
              ...vacancies.map((vacancy) => ({
                value: vacancy.id,
                label: vacancy.title,
              })),
            ]}
            onChange={(event) => setVacancyId(event.target.value)}
          />
          <Select
            aria-label={d.tables.filterByProcessing}
            value={status}
            options={statusOptions}
            onChange={(event) => setStatus(event.target.value)}
          />
          <Select
            aria-label={d.tables.sortCandidates}
            value={sort}
            options={sortOptions}
            onChange={(event) => setSort(event.target.value as CandidateSortKey)}
          />
        </div>
        <p className="text-[12.5px] text-ink-muted lg:ml-auto">
          {f(d.common.of, { count: filtered.length, total: candidates.length })}
        </p>
      </div>

      {/*
        Three presentations, one per width band, because a candidate row does
        not survive being squeezed: the dense table below `xl`, a compact
        selectable list beside a preview above it, and cards on mobile. The
        table's experience/location/documents columns cannot fit a 22rem
        column, so the split gets a list built for that width rather than a
        squeezed table.
      */}
      <div className="hidden md:block xl:hidden">
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(candidate) => candidate.id}
          caption={d.tables.captionCandidates}
          empty={empty}
        />
      </div>

      <div className="hidden xl:block">
        <SplitView
          listLabel={d.candidates.title}
          previewLabel={d.candidates.selectToPreview}
          hasSelection={Boolean(selected)}
          list={
            filtered.length === 0 ? (
              <div className="rounded-[14px] border border-line bg-surface">
                {empty}
              </div>
            ) : (
              <ul className="flex max-h-[calc(100dvh-6rem)] flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-slim">
                {filtered.map((candidate) => {
                  const active = candidate.id === selectedId;
                  return (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(candidate.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left",
                          "transition-colors duration-[var(--motion-fast)]",
                          active
                            ? "border-brand/30 bg-brand-soft"
                            : "border-line bg-surface hover:border-line-strong hover:bg-surface-muted",
                        )}
                      >
                        <Avatar
                          name={candidate.fullName}
                          src={candidate.avatarUrl}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">
                            {candidate.fullName}
                          </span>
                          <span className="block truncate text-[12px] text-ink-muted">
                            {candidate.currentTitle ?? d.common.notSet}
                          </span>
                        </span>
                        {candidate.processingStatus ? (
                          <DocumentStatusBadge status={candidate.processingStatus} />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          }
          preview={
            selected ? (
              <CandidatePreview candidate={selected} vacancyId={vacancyId} />
            ) : null
          }
          emptyPreview={
            <div className="px-6 py-16 text-center">
              <p className="text-[14px] font-semibold text-ink">
                {d.candidates.selectToPreview}
              </p>
              <p className="mt-1 text-[13px] text-ink-muted">
                {d.candidates.selectToPreviewHint}
              </p>
            </div>
          }
        />
      </div>

      <div className="grid gap-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface shadow-card">
            {empty}
          </div>
        ) : (
          filtered.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} />
          ))
        )}
      </div>
    </div>
  );
}

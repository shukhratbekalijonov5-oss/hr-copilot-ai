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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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

      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(candidate) => candidate.id}
          caption={d.tables.captionCandidates}
          empty={empty}
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

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Field";
import { VacancyStatusBadge } from "@/components/ui/StatusBadge";
import { VacancyCard } from "@/components/vacancies/VacancyCard";
import { buttonStyles } from "@/components/ui/Button";
import { BriefcaseIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { VACANCY_STATUSES } from "@/lib/types";
import type { Vacancy } from "@/lib/types";

interface VacancyListViewProps {
  vacancies: Vacancy[];
  departments: string[];
}

export function VacancyListView({
  vacancies,
  departments,
}: VacancyListViewProps) {
  const { d, f, date } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");

  // Built inside the component so the labels follow the active locale.
  const statusOptions = useMemo(
    () => [
      { value: "all", label: d.vacancies.allStatuses },
      ...VACANCY_STATUSES.map((status) => ({
        value: status,
        label: d.status.vacancy[status],
      })),
    ],
    [d],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return vacancies.filter((vacancy) => {
      if (status !== "all" && vacancy.status !== status) return false;
      if (department !== "all" && vacancy.department !== department) return false;
      if (!needle) return true;
      return [vacancy.title, vacancy.department, vacancy.location].some(
        (field) => (field ?? "").toLowerCase().includes(needle),
      );
    });
  }, [vacancies, search, status, department]);

  const columns: Column<Vacancy>[] = [
    {
      key: "title",
      header: d.tables.vacancy,
      render: (vacancy) => (
        <div className="min-w-0">
          <Link
            href={`/vacancies/${vacancy.id}`}
            className="block truncate font-medium text-ink hover:text-brand"
          >
            {vacancy.title}
          </Link>
          <p className="truncate text-[12.5px] text-ink-muted lg:hidden">
            {vacancy.department ?? d.tables.empty} · {vacancy.location ?? d.tables.empty}
          </p>
        </div>
      ),
    },
    {
      key: "department",
      header: d.tables.department,
      hideBelow: "lg",
      render: (vacancy) => (
        <span className="text-ink-muted">{vacancy.department ?? d.tables.empty}</span>
      ),
    },
    {
      key: "location",
      header: d.tables.location,
      hideBelow: "xl",
      render: (vacancy) => (
        <span className="text-ink-muted">{vacancy.location ?? d.tables.empty}</span>
      ),
    },
    {
      key: "employmentType",
      header: d.tables.type,
      hideBelow: "lg",
      render: (vacancy) => (
        <span className="text-ink-muted">
          {vacancy.employmentType
            ? (d.employmentType[
                vacancy.employmentType as keyof typeof d.employmentType
              ] ?? vacancy.employmentType)
            : d.tables.empty}
        </span>
      ),
    },
    {
      key: "status",
      header: d.tables.status,
      render: (vacancy) => <VacancyStatusBadge status={vacancy.status} />,
    },
    {
      key: "candidates",
      header: d.tables.candidates,
      align: "right",
      render: (vacancy) => (
        <span className="tabular-nums text-ink-muted">
          {vacancy.candidateCount}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: d.tables.created,
      align: "right",
      hideBelow: "md",
      render: (vacancy) => (
        <span className="whitespace-nowrap text-ink-muted">
          {date(vacancy.createdAt)}
        </span>
      ),
    },
  ];

  const empty = (
    <EmptyState
      icon={<BriefcaseIcon className="size-5" />}
      title={
        vacancies.length === 0 ? d.vacancies.empty : d.vacancies.noMatches
      }
      description={
        vacancies.length === 0
          ? d.tables.vacanciesEmptyHint
          : d.tables.vacanciesNoMatchHint
      }
      action={
        vacancies.length === 0 ? (
          <Link href="/vacancies/new" className={buttonStyles("primary", "sm")}>
            <PlusIcon className="size-4" />
            {d.vacancies.create}
          </Link>
        ) : null
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder={d.tables.searchVacancies}
          value={search}
          aria-label={d.tables.searchVacanciesLabel}
          leading={<SearchIcon className="size-4" />}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="sm:max-w-xs sm:flex-1"
        />
        <div className="flex gap-2">
          <Select
            aria-label={d.tables.filterByStatus}
            value={status}
            options={statusOptions}
            onChange={(event) => setStatus(event.target.value)}
            className="sm:w-40"
          />
          <Select
            aria-label={d.tables.filterByDepartment}
            value={department}
            options={[
              { value: "all", label: d.vacancies.allDepartments },
              ...departments.map((item) => ({ value: item, label: item })),
            ]}
            onChange={(event) => setDepartment(event.target.value)}
            className="sm:w-44"
          />
        </div>
        <p className="text-[12.5px] text-ink-muted sm:ml-auto">
          {f(d.common.of, { count: filtered.length, total: vacancies.length })}
        </p>
      </div>

      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(vacancy) => vacancy.id}
          caption={d.tables.captionVacancies}
          empty={empty}
        />
      </div>

      <div className="grid gap-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface shadow-card">
            {empty}
          </div>
        ) : (
          filtered.map((vacancy) => (
            <VacancyCard key={vacancy.id} vacancy={vacancy} />
          ))
        )}
      </div>
    </div>
  );
}

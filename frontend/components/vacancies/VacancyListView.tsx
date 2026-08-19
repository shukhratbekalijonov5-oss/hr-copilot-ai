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
import { EMPLOYMENT_TYPE_LABELS, VACANCY_STATUS_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { Vacancy, VacancyStatus } from "@/lib/types";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...(
    Object.keys(VACANCY_STATUS_LABELS) as VacancyStatus[]
  ).map((status) => ({ value: status, label: VACANCY_STATUS_LABELS[status] })),
];

interface VacancyListViewProps {
  vacancies: Vacancy[];
  departments: string[];
}

export function VacancyListView({
  vacancies,
  departments,
}: VacancyListViewProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return vacancies.filter((vacancy) => {
      if (status !== "all" && vacancy.status !== status) return false;
      if (department !== "all" && vacancy.department !== department) return false;
      if (!needle) return true;
      return [vacancy.title, vacancy.department, vacancy.location].some((field) =>
        field.toLowerCase().includes(needle),
      );
    });
  }, [vacancies, search, status, department]);

  const columns: Column<Vacancy>[] = [
    {
      key: "title",
      header: "Vacancy",
      render: (vacancy) => (
        <div className="min-w-0">
          <Link
            href={`/vacancies/${vacancy.id}`}
            className="block truncate font-medium text-ink hover:text-brand"
          >
            {vacancy.title}
          </Link>
          <p className="truncate text-[12.5px] text-ink-muted lg:hidden">
            {vacancy.department} · {vacancy.location}
          </p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideBelow: "lg",
      render: (vacancy) => (
        <span className="text-ink-muted">{vacancy.department}</span>
      ),
    },
    {
      key: "location",
      header: "Location",
      hideBelow: "xl",
      render: (vacancy) => (
        <span className="text-ink-muted">{vacancy.location}</span>
      ),
    },
    {
      key: "employmentType",
      header: "Type",
      hideBelow: "lg",
      render: (vacancy) => (
        <span className="text-ink-muted">
          {EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (vacancy) => <VacancyStatusBadge status={vacancy.status} />,
    },
    {
      key: "candidates",
      header: "Candidates",
      align: "right",
      render: (vacancy) => (
        <span className="tabular-nums text-ink-muted">
          {vacancy.candidateCount}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      align: "right",
      hideBelow: "md",
      render: (vacancy) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatDate(vacancy.createdAt)}
        </span>
      ),
    },
  ];

  const empty = (
    <EmptyState
      icon={<BriefcaseIcon className="size-5" />}
      title={
        vacancies.length === 0 ? "No vacancies yet" : "No vacancies match"
      }
      description={
        vacancies.length === 0
          ? "Create a vacancy to define the requirements the copilot looks for in each resume."
          : "Adjust the search or filters to widen the results."
      }
      action={
        vacancies.length === 0 ? (
          <Link href="/vacancies/new" className={buttonStyles("primary", "sm")}>
            <PlusIcon className="size-4" />
            Create vacancy
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
          placeholder="Search title, department or location"
          value={search}
          aria-label="Search vacancies"
          leading={<SearchIcon className="size-4" />}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="sm:max-w-xs sm:flex-1"
        />
        <div className="flex gap-2">
          <Select
            aria-label="Filter by status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(event) => setStatus(event.target.value)}
            className="sm:w-40"
          />
          <Select
            aria-label="Filter by department"
            value={department}
            options={[
              { value: "all", label: "All departments" },
              ...departments.map((item) => ({ value: item, label: item })),
            ]}
            onChange={(event) => setDepartment(event.target.value)}
            className="sm:w-44"
          />
        </div>
        <p className="text-[12.5px] text-ink-muted sm:ml-auto">
          {filtered.length} of {vacancies.length}
        </p>
      </div>

      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={filtered}
          getRowKey={(vacancy) => vacancy.id}
          caption="Vacancies"
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

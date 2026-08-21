"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { bulkDeleteVacanciesAction } from "@/app/(app)/vacancies/actions";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Field";
import { VacancyStatusBadge } from "@/components/ui/StatusBadge";
import { VacancyCard } from "@/components/vacancies/VacancyCard";
import { Button, buttonStyles } from "@/components/ui/Button";
import { AlertIcon, BriefcaseIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { VACANCY_STATUSES } from "@/lib/types";
import type { Vacancy } from "@/lib/types";

interface VacancyListViewProps {
  vacancies: Vacancy[];
  departments: string[];
  /**
   * Ids of vacancies the caller created. Only these can be selected, deleted
   * or worked inside — the rest are catalog entries that every member can see
   * but only their creator can operate on.
   */
  ownedIds: string[];
}

export function VacancyListView({
  vacancies,
  departments,
  ownedIds,
}: VacancyListViewProps) {
  const { d, f, p, date } = useI18n();
  const router = useRouter();
  const owned = useMemo(() => new Set(ownedIds), [ownedIds]);

  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
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

  const selectableIds = filtered
    .filter((vacancy) => owned.has(vacancy.id))
    .map((vacancy) => vacancy.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));

  function toggle(id: string) {
    setDeleteError(null);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function confirmDelete() {
    startDeleting(async () => {
      const result = await bulkDeleteVacanciesAction(selected);
      if (result.ok) {
        setSelected([]);
        setConfirming(false);
        // Nothing is removed optimistically: the server list is the truth
        // about what actually survived an all-or-nothing delete.
        router.refresh();
        return;
      }
      setConfirming(false);
      setDeleteError(
        result.reason === "not_owned"
          ? d.vacancyScope.notOwned
          : result.reason === "vacancy_not_found"
            ? d.vacancyScope.notFound
            : d.vacancyScope.deleteFailed,
      );
    });
  }

  const columns: Column<Vacancy>[] = [
    {
      key: "select",
      header: (
        <input
          type="checkbox"
          aria-label={d.vacancyScope.selectAll}
          checked={allSelected}
          disabled={selectableIds.length === 0 || deleting}
          onChange={() => {
            setDeleteError(null);
            setSelected(allSelected ? [] : selectableIds);
          }}
          className="size-4 rounded border-line-strong accent-[var(--brand)]"
        />
      ),
      render: (vacancy) =>
        owned.has(vacancy.id) ? (
          <input
            type="checkbox"
            aria-label={`${d.vacancyScope.select}: ${vacancy.title}`}
            checked={selected.includes(vacancy.id)}
            disabled={deleting}
            onChange={() => toggle(vacancy.id)}
            className="size-4 rounded border-line-strong accent-[var(--brand)]"
          />
        ) : (
          <span
            title={d.vacancyScope.ownedByOther}
            className="text-[11px] text-ink-subtle"
          >
            —
          </span>
        ),
    },
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
          {!owned.has(vacancy.id) ? (
            <p className="truncate text-[11.5px] text-ink-subtle">
              {d.vacancyScope.ownedByOther}
            </p>
          ) : null}
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
      {deleteError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {deleteError}
        </p>
      ) : null}

      {selected.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center">
          <p className="text-[13px] font-medium text-ink">
            {p(d.vacancyScope.selectedCount, selected.length)}
          </p>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => {
                setSelected([]);
                setDeleteError(null);
              }}
            >
              {d.vacancyScope.clearSelection}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={deleting}
              disabled={deleting}
              onClick={() => setConfirming(true)}
            >
              {d.vacancyScope.deleteSelected}
            </Button>
          </div>
        </div>
      ) : null}

      {/* A plain No/Yes confirmation — one question, two answers. */}
      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          className="flex flex-col gap-3 rounded-xl border border-critical bg-surface p-4"
        >
          <div>
            <p
              id="bulk-delete-title"
              className="text-[14px] font-semibold text-ink"
            >
              {selected.length === 1
                ? d.vacancyScope.deleteConfirmTitle
                : d.vacancyScope.deleteConfirmTitlePlural}
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
              {d.vacancyScope.deleteConfirmHint}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              {d.vacancyScope.no}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={deleting}
              disabled={deleting}
              onClick={confirmDelete}
            >
              {d.vacancyScope.yes}
            </Button>
          </div>
        </div>
      ) : null}

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

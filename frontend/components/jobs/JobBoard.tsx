"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobCard } from "@/components/jobs/JobCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { BriefcaseIcon, MapPinIcon, SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { searchHref, type JobSearchParams } from "@/lib/candidate/job-search-filters";
import {
  EMPLOYMENT_TYPES,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  WORK_MODES,
  type PublicJobPage,
} from "@/lib/types";
import { CURRENCY_OPTIONS } from "@/components/vacancies/VacancyProfileFields";

interface JobBoardProps {
  page: PublicJobPage;
  savedSlugs: string[];
  /** The filters as they stand in the URL — the single source of truth. */
  params: JobSearchParams;
  /** True when a saved preference supplied a dimension the URL did not. */
  usingPreferences: boolean;
}

/**
 * The public job board.
 *
 * Search, location and paging live in the URL rather than component state, so a
 * result page can be shared and restored on back-navigation — and so the
 * filtering happens on the backend, which already supports both parameters.
 */
export function JobBoard({
  page,
  savedSlugs,
  params,
  usingPreferences,
}: JobBoardProps) {
  const { d, p, f } = useI18n();
  const router = useRouter();

  const [form, setForm] = useState<JobSearchParams>(params);
  // Advanced filters start open when any of them is already set, so a shared
  // URL never hides the filters that produced it.
  const [advanced, setAdvanced] = useState(
    form.employmentTypes.length > 0 ||
      form.seniorityLevels.length > 0 ||
      Boolean(form.salaryMin),
  );

  const saved = new Set(savedSlugs);
  const filtered =
    Boolean(params.search || params.location || params.salaryMin) ||
    params.countries.length > 0 ||
    params.workModes.length > 0 ||
    params.employmentTypes.length > 0 ||
    params.seniorityLevels.length > 0;

  const patch = (changes: Partial<JobSearchParams>) =>
    setForm((current) => ({ ...current, ...changes }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    router.push(searchHref(form, {}));
  }

  function clear() {
    setForm({
      search: "",
      location: "",
      countries: [],
      workModes: [],
      employmentTypes: [],
      seniorityLevels: [],
      salaryMin: "",
      salaryCurrency: "",
      payPeriod: "",
      page: 1,
    });
    router.push("/jobs");
  }

  function goToPage(next: number) {
    router.push(searchHref(params, { page: next }));
  }

  /** One multi-select rendered as a plain <select multiple>-free list. */
  const toggle = (values: string[], value: string) =>
    values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              type="search"
              label={d.jobs.searchLabel}
              placeholder={d.jobs.searchPlaceholder}
              value={form.search}
              leading={<SearchIcon className="size-4" />}
              onChange={(event) => patch({ search: event.target.value })}
              wrapperClassName="sm:flex-1"
            />
            <Input
              type="search"
              label={d.jobs.locationLabel}
              placeholder={d.jobs.locationPlaceholder}
              value={form.location}
              leading={<MapPinIcon className="size-4" />}
              onChange={(event) => patch({ location: event.target.value })}
              wrapperClassName="sm:w-56"
            />
            <div className="flex gap-2">
              <Button type="submit" icon={<SearchIcon className="size-4" />}>
                {d.jobs.submit}
              </Button>
              {filtered ? (
                <Button type="button" variant="ghost" onClick={clear}>
                  {d.jobs.clear}
                </Button>
              ) : null}
            </div>
            </div>

            <FilterChips
              label={d.jobs.workModeLabel}
              options={WORK_MODES.map((value) => ({
                value,
                label: d.workMode[value],
              }))}
              selected={form.workModes}
              onToggle={(value: string) =>
                patch({ workModes: toggle(form.workModes, value) })
              }
            />

            {/*
              These controls RANK; they do not exclude. Saying so matters:
              "filters" promises removal, and a reader who believes a tick
              hid the rest will conclude there are no other jobs.

              Location is the exception, and gets its own sentence — a control
              that genuinely removes results has to say so, or the reader
              cannot tell the two kinds apart.
            */}
            <p className="text-[12px] text-ink-subtle">
              {d.jobs.rankNote}{" "}
              <span className="text-ink-muted">
                {d.jobs.locationFilterNote}
              </span>
            </p>

            <button
              type="button"
              onClick={() => setAdvanced((open) => !open)}
              className="self-start text-[12.5px] font-medium text-brand-ink hover:text-brand"
            >
              {advanced ? d.jobs.fewerFilters : d.jobs.moreFilters}
            </button>

            {advanced ? (
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <FilterChips
                  label={d.jobs.employmentLabel}
                  options={EMPLOYMENT_TYPES.map((value) => ({
                    value,
                    label: d.employmentTypeValue[value],
                  }))}
                  selected={form.employmentTypes}
                  onToggle={(value: string) =>
                    patch({
                      employmentTypes: toggle(form.employmentTypes, value),
                    })
                  }
                />
                <FilterChips
                  label={d.jobs.seniorityLabel}
                  options={SENIORITY_LEVELS.map((value) => ({
                    value,
                    label: d.seniorityLevel[value],
                  }))}
                  selected={form.seniorityLevels}
                  onToggle={(value: string) =>
                    patch({
                      seniorityLevels: toggle(form.seniorityLevels, value),
                    })
                  }
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Input
                    type="text"
                    inputMode="numeric"
                    label={d.jobs.salaryLabel}
                    placeholder={d.jobs.salaryAmountPlaceholder}
                    value={form.salaryMin}
                    onChange={(event) =>
                      patch({ salaryMin: event.target.value })
                    }
                    wrapperClassName="sm:w-44"
                  />
                  <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
                    {d.jobPreferences.currency}
                    <select
                      value={form.salaryCurrency}
                      onChange={(event) =>
                        patch({ salaryCurrency: event.target.value })
                      }
                      className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
                    >
                      <option value="">{d.jobs.anyOption}</option>
                      {CURRENCY_OPTIONS.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
                    {d.jobPreferences.payPeriod}
                    <select
                      value={form.payPeriod}
                      onChange={(event) =>
                        patch({ payPeriod: event.target.value })
                      }
                      className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
                    >
                      <option value="">{d.jobs.anyOption}</option>
                      {PAY_PERIODS.map((value) => (
                        <option key={value} value={value}>
                          {d.payPeriod[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {/*
                  An amount with no currency cannot be compared with any job's
                  pay, so the search simply does not use it. Saying that is the
                  honest alternative to guessing a currency for the reader or
                  dropping what they typed in silence.
                */}
                {form.salaryMin && !form.salaryCurrency ? (
                  <p className="text-[12px] text-warning">
                    {d.jobs.currencyNeeded}
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>

          {usingPreferences ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-[12.5px] text-ink-muted">
              {/*
                Stated plainly: the results are shaped by saved preferences,
                and anything typed here applies to THIS search only — nothing
                on this page writes to the saved profile.
              */}
              <span>{d.jobs.usingPreferences}</span>
              <a
                href="/job-preferences"
                className="font-medium text-brand-ink hover:text-brand"
              >
                {d.jobs.editPreferences}
              </a>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {page.jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BriefcaseIcon className="size-5" />}
            title={filtered ? d.jobs.noMatches : d.jobs.empty}
            description={filtered ? d.jobs.noMatchesHint : d.jobs.emptyHint}
          />
        </Card>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">
            {p(d.jobs.resultCount, page.total)}
          </p>

          <ul className="grid gap-3 md:grid-cols-2">
            {page.jobs.map((job) => (
              <li key={job.publicSlug} className="min-w-0">
                <JobCard job={job} saved={saved.has(job.publicSlug)} />
              </li>
            ))}
          </ul>

          {page.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page.page <= 1}
                onClick={() => goToPage(page.page - 1)}
              >
                {d.common.previous}
              </Button>
              <span className="text-[12.5px] tabular-nums text-ink-muted">
                {f(d.common.pageOf, {
                  page: page.page,
                  total: page.totalPages,
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page.page >= page.totalPages}
                onClick={() => goToPage(page.page + 1)}
              >
                {d.common.next}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * One filter dimension as toggleable chips.
 *
 * Chips rather than a multi-select because a job seeker needs to see what is
 * on and what is off at a glance; a collapsed <select multiple> hides both.
 * Nothing selected means NO RESTRICTION on this dimension — never "match
 * nothing" — which is why there is no "Any" chip to pick: not choosing IS any.
 */
function FilterChips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
              className={
                active
                  ? "rounded-full border border-brand bg-brand/10 px-2.5 py-1 text-[12.5px] font-medium text-brand-ink"
                  : "rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

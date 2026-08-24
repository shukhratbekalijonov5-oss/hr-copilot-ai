"use client";

import { useId } from "react";
import { Input } from "@/components/ui/Field";
import { useI18n } from "@/lib/i18n/context";
import { countryLabel } from "@/lib/vacancy/job-profile";
import { hasComparableSalary } from "@/lib/candidate/external-job-filters";
import type { ExternalJobSearchParams } from "@/lib/candidate/external-job-filters";
import {
  EMPLOYMENT_TYPES,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  WORK_MODES,
} from "@/lib/types";
import { CURRENCY_OPTIONS } from "@/components/vacancies/VacancyProfileFields";

/**
 * The filter controls, shared by the desktop panel and the mobile sheet.
 *
 * ## Why two words instead of one
 *
 * Country is labelled **Filter**; everything else is labelled **Preference**.
 * That is not a stylistic choice — the two behave differently, and calling
 * them all "filters" would be the interface lying about what a tick does.
 *
 * A country chosen here removes jobs: pick Canada and jobs outside Canada are
 * gone. Work arrangement, employment type, experience and pay do not remove
 * anything; they move the closest jobs to the front. A reader who ticks
 * Remote, Full-time, Senior and a salary floor believing each one narrowed the
 * list will conclude the catalogue holds four jobs when it holds hundreds —
 * and the honest fix is to say which control does which, once, next to the
 * control.
 */

function DimensionHeader({
  label,
  kind,
}: {
  label: string;
  /** Whether this control removes jobs or only reorders them. */
  kind: "filter" | "preference";
}) {
  const { d } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
      <span
        className={
          kind === "filter"
            ? "rounded-md bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-brand-ink"
            : "rounded-md bg-neutral-soft px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle"
        }
      >
        {kind === "filter"
          ? d.externalJobs.filterTag
          : d.externalJobs.preferenceTag}
      </span>
    </div>
  );
}

/**
 * One dimension as toggleable chips.
 *
 * Nothing selected means NO RESTRICTION on this dimension — never "match
 * nothing" — which is why there is no "Any" chip to pick: not choosing IS any.
 * `aria-pressed` rather than colour alone carries the on/off state, so the
 * control is legible to a screen reader and to anyone who does not perceive
 * the brand tint.
 */
function Chips({
  options,
  selected,
  onToggle,
  describedBy,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  describedBy?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-describedby={describedBy}>
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
  );
}

export function ExternalJobFiltersBody({
  form,
  patch,
}: {
  form: ExternalJobSearchParams;
  patch: (changes: Partial<ExternalJobSearchParams>) => void;
}) {
  const { d } = useI18n();
  const countryHintId = useId();
  const preferenceHintId = useId();

  const toggle = (values: string[], value: string) =>
    values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];

  // The same country vocabulary the preferences form and vacancy editor use.
  // Sorted by the reader's own language, so the list is alphabetical in
  // Russian for a Russian reader rather than alphabetical in English.
  const countries = Object.keys(d.country)
    .map((code) => ({ value: code, label: countryLabel(code, d) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <DimensionHeader label={d.externalJobs.countryLabel} kind="filter" />
        <p id={countryHintId} className="text-[12px] text-ink-subtle">
          {d.externalJobs.countryHint}
        </p>
        <Chips
          options={countries}
          selected={form.countries}
          onToggle={(value) =>
            patch({ countries: toggle(form.countries, value) })
          }
          describedBy={countryHintId}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <p id={preferenceHintId} className="text-[12px] text-ink-subtle">
          {d.externalJobs.preferenceHint}
        </p>

        <div className="flex flex-col gap-1.5">
          <DimensionHeader
            label={d.externalJobs.workModeLabel}
            kind="preference"
          />
          <Chips
            options={WORK_MODES.map((value) => ({
              value,
              label: d.workMode[value],
            }))}
            selected={form.workModes}
            onToggle={(value) =>
              patch({ workModes: toggle(form.workModes, value) })
            }
            describedBy={preferenceHintId}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <DimensionHeader
            label={d.externalJobs.employmentLabel}
            kind="preference"
          />
          <Chips
            options={EMPLOYMENT_TYPES.map((value) => ({
              value,
              label: d.employmentTypeValue[value],
            }))}
            selected={form.employmentTypes}
            onToggle={(value) =>
              patch({ employmentTypes: toggle(form.employmentTypes, value) })
            }
            describedBy={preferenceHintId}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <DimensionHeader
            label={d.externalJobs.seniorityLabel}
            kind="preference"
          />
          <Chips
            options={SENIORITY_LEVELS.map((value) => ({
              value,
              label: d.seniorityLevel[value],
            }))}
            selected={form.seniorityLevels}
            onToggle={(value) =>
              patch({ seniorityLevels: toggle(form.seniorityLevels, value) })
            }
            describedBy={preferenceHintId}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <DimensionHeader
            label={d.externalJobs.salaryLabel}
            kind="preference"
          />
          <div className="flex flex-wrap items-end gap-2">
            <Input
              type="text"
              inputMode="numeric"
              aria-label={d.externalJobs.salaryLabel}
              placeholder={d.externalJobs.salaryAmountPlaceholder}
              value={form.salaryMin}
              onChange={(event) => patch({ salaryMin: event.target.value })}
              wrapperClassName="w-32"
            />
            <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
              {d.externalJobs.currencyLabel}
              <select
                value={form.salaryCurrency}
                onChange={(event) =>
                  patch({ salaryCurrency: event.target.value })
                }
                className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
              >
                <option value="">{d.externalJobs.anyOption}</option>
                {CURRENCY_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
              {d.externalJobs.payPeriodLabel}
              <select
                value={form.payPeriod}
                onChange={(event) => patch({ payPeriod: event.target.value })}
                className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
              >
                <option value="">{d.externalJobs.anyOption}</option>
                {PAY_PERIODS.map((value) => (
                  <option key={value} value={value}>
                    {d.payPeriod[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {/*
            An amount with no currency and period cannot be compared with any
            job's pay, so the search does not use it. Saying so is the honest
            alternative to guessing a currency or dropping what they typed in
            silence.
          */}
          {form.salaryMin && !hasComparableSalary(form) ? (
            <p className="text-[12px] text-warning">
              {d.externalJobs.currencyNeeded}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

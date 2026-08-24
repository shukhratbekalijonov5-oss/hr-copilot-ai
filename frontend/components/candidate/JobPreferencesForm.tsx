"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteJobPreferencesAction,
  saveJobPreferencesAction,
} from "@/app/(candidate)/job-preferences/actions";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import { AlertIcon, CheckIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { CURRENCY_OPTIONS } from "@/components/vacancies/VacancyProfileFields";
import { countryLabel } from "@/lib/vacancy/job-profile";
import { useI18n } from "@/lib/i18n/context";
import {
  emptyPreferencesState,
  hasAnyPreference,
  newLocationRow,
  preferencesInputFrom,
  preferencesStateFrom,
  validatePreferencesState,
  type LocationRow,
  type PreferencesFormState,
} from "@/lib/candidate/job-preferences-form";
import {
  EMPLOYMENT_TYPES,
  JOB_BENEFITS,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  WORK_MODES,
} from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type {
  CandidateJobPreferences,
  EmploymentType,
  JobBenefit,
  SeniorityLevel,
  WorkMode,
} from "@/lib/types";

interface LocationEditorProps {
  rows: LocationRow[];
  countryOptions: { value: string; label: string }[];
  onChange: (rows: LocationRow[]) => void;
  d: Dictionary;
  f: (template: string, values?: Record<string, string | number>) => string;
}

/**
 * The editor for a list of places, shared by "where I want to work" and
 * "where I never want to work" — they are the same shape and must normalize
 * against jobs identically.
 *
 * Declared at module level ON PURPOSE. A component defined inside the form
 * would be a new function identity on every render, so React would remount
 * these inputs on each keystroke and the field would lose focus mid-word.
 */
function LocationEditor({
  rows,
  countryOptions,
  onChange,
  d,
  f,
}: LocationEditorProps) {
  function patchRow(key: string, next: Partial<LocationRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...next } : row)));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">
          {d.jobPreferences.noLocations}
        </p>
      ) : null}

      {rows.map((row, index) => (
        <div key={row.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Select
            aria-label={d.jobPreferences.country}
            value={row.countryCode}
            options={countryOptions}
            onChange={(event) =>
              patchRow(row.key, { countryCode: event.target.value })
            }
          />
          <Input
            aria-label={d.jobPreferences.region}
            placeholder={d.jobPreferences.region}
            value={row.region ?? ""}
            onChange={(event) => patchRow(row.key, { region: event.target.value })}
          />
          <Input
            aria-label={d.jobPreferences.city}
            placeholder={d.jobPreferences.city}
            value={row.city ?? ""}
            onChange={(event) => patchRow(row.key, { city: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={f(d.jobPreferences.removeLocation, { index: index + 1 })}
            onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            className="justify-self-start sm:justify-self-auto"
          >
            <TrashIcon className="size-4" />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={<PlusIcon className="size-4" />}
        className="self-start"
        onClick={() => onChange([...rows, newLocationRow()])}
      >
        {d.jobPreferences.addLocation}
      </Button>
    </div>
  );
}

interface JobPreferencesFormProps {
  preferences: CandidateJobPreferences;
}

/**
 * What the candidate is looking for.
 *
 * Ordered by what actually drives a job search: role, location, work
 * arrangement, pay, employment type and level first; relocation, industries,
 * benefits and exclusions after. Everything is optional — a blank section
 * means "no preference stated", which the UI says out loud rather than
 * leaving the reader to guess whether blank means "any" or "none".
 *
 * Nothing here is pre-filled from the candidate's CV, applications or past
 * searches. A preference exists because they typed it.
 */
export function JobPreferencesForm({ preferences }: JobPreferencesFormProps) {
  const router = useRouter();
  const { d, f, date } = useI18n();

  const [state, setState] = useState<PreferencesFormState>(() =>
    preferences.stated
      ? preferencesStateFrom(preferences)
      : emptyPreferencesState(),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(preferences.updatedAt);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [confirmingClear, setConfirmingClear] = useState(false);

  function patch(next: Partial<PreferencesFormState>) {
    setState((current) => ({ ...current, ...next }));
    setStatus("idle");
  }

  /** Toggling one member of a multi-select set. */
  function toggle<T extends string>(
    field: keyof PreferencesFormState,
    values: T[],
    value: T,
    on: boolean,
  ) {
    patch({
      [field]: on ? [...values, value] : values.filter((item) => item !== value),
    } as Partial<PreferencesFormState>);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validationErrors = validatePreferencesState(state, d);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setStatus("saving");
    const result = await saveJobPreferencesAction(preferencesInputFrom(state));
    if (result.ok) {
      setSavedAt(result.updatedAt);
      setStatus("saved");
      // Every candidate→jobs surface reads the shared resolver, so the saved
      // pages must not keep showing the previous intent.
      router.refresh();
      return;
    }
    setFormError(result.message);
    setErrors(result.fieldErrors);
    setStatus("idle");
  }

  async function handleClear() {
    setStatus("saving");
    const result = await deleteJobPreferencesAction();
    setConfirmingClear(false);
    if (result.ok) {
      setState(emptyPreferencesState());
      setSavedAt(null);
      setStatus("idle");
      router.refresh();
      return;
    }
    setFormError(result.message);
    setStatus("idle");
  }

  const countryOptions = [
    { value: "", label: d.jobPreferences.country },
    ...Object.keys(d.country)
      .map((code) => ({ value: code, label: countryLabel(code, d) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      {!preferences.stated && !hasAnyPreference(state) ? (
        <p className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2 text-[13px] text-ink-muted">
          {d.jobPreferences.empty}
        </p>
      ) : null}

      {/* 1. Roles */}
      <Card>
        <CardHeader
          title={d.jobPreferences.rolesTitle}
          description={d.jobPreferences.rolesHint}
        />
        <CardBody>
          <TagInput
            label={d.jobPreferences.rolesTitle}
            placeholder={d.jobPreferences.rolesPlaceholder}
            value={state.roles}
            onChange={(roles) => patch({ roles })}
          />
        </CardBody>
      </Card>

      {/* 2. Locations */}
      <Card>
        <CardHeader
          title={d.jobPreferences.locationsTitle}
          description={d.jobPreferences.locationsHint}
        />
        <CardBody className="flex flex-col gap-2">
          {errors.locations ? (
            <p role="alert" className="text-[12.5px] text-critical">
              {errors.locations}
            </p>
          ) : null}
          <LocationEditor
            rows={state.locations}
            countryOptions={countryOptions}
            onChange={(locations) => patch({ locations })}
            d={d}
            f={f}
          />
        </CardBody>
      </Card>

      {/* 3. Work arrangement */}
      <Card>
        <CardHeader
          title={d.jobPreferences.workModeTitle}
          description={d.jobPreferences.workModeHint}
        />
        <CardBody className="grid gap-2.5 sm:grid-cols-3">
          {WORK_MODES.map((mode) => (
            <Checkbox
              key={mode}
              label={d.workMode[mode]}
              checked={state.workModes.includes(mode)}
              onChange={(event) =>
                toggle<WorkMode>(
                  "workModes",
                  state.workModes,
                  mode,
                  event.target.checked,
                )
              }
            />
          ))}
        </CardBody>
      </Card>

      {/* 4. Compensation */}
      <Card>
        <CardHeader
          title={d.jobPreferences.compensationTitle}
          description={d.jobPreferences.compensationHint}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label={d.jobPreferences.salaryMin}
            inputMode="numeric"
            placeholder="50000000"
            value={state.desiredSalaryMin}
            error={errors.desiredSalaryMin}
            onChange={(event) => patch({ desiredSalaryMin: event.target.value })}
          />
          <Input
            label={d.jobPreferences.salaryMax}
            hint={d.jobPreferences.salaryMaxHint}
            inputMode="numeric"
            placeholder="80000000"
            value={state.desiredSalaryMax}
            error={errors.desiredSalaryMax}
            onChange={(event) => patch({ desiredSalaryMax: event.target.value })}
          />
          <Select
            label={d.jobPreferences.currency}
            value={state.salaryCurrency}
            error={errors.salaryCurrency}
            options={[
              { value: "", label: d.jobPreferences.notStated },
              ...CURRENCY_OPTIONS.map((code) => ({ value: code, label: code })),
            ]}
            onChange={(event) => patch({ salaryCurrency: event.target.value })}
          />
          <Select
            label={d.jobPreferences.payPeriod}
            value={state.payPeriod}
            error={errors.payPeriod}
            options={[
              { value: "", label: d.jobPreferences.notStated },
              ...PAY_PERIODS.map((period) => ({
                value: period,
                label: d.payPeriod[period],
              })),
            ]}
            onChange={(event) => patch({ payPeriod: event.target.value })}
          />
        </CardBody>
      </Card>

      {/* 5. Employment type */}
      <Card>
        <CardHeader
          title={d.jobPreferences.employmentTitle}
          description={d.jobPreferences.employmentHint}
        />
        <CardBody className="grid gap-2.5 sm:grid-cols-3">
          {EMPLOYMENT_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={d.employmentTypeValue[type]}
              checked={state.employmentTypes.includes(type)}
              onChange={(event) =>
                toggle<EmploymentType>(
                  "employmentTypes",
                  state.employmentTypes,
                  type,
                  event.target.checked,
                )
              }
            />
          ))}
        </CardBody>
      </Card>

      {/* 6. Experience level */}
      <Card>
        <CardHeader
          title={d.jobPreferences.seniorityTitle}
          description={d.jobPreferences.seniorityHint}
        />
        <CardBody className="grid gap-2.5 sm:grid-cols-3">
          {SENIORITY_LEVELS.map((level) => (
            <Checkbox
              key={level}
              label={d.seniorityLevel[level]}
              checked={state.seniorityLevels.includes(level)}
              onChange={(event) =>
                toggle<SeniorityLevel>(
                  "seniorityLevels",
                  state.seniorityLevels,
                  level,
                  event.target.checked,
                )
              }
            />
          ))}
        </CardBody>
      </Card>

      <h2 className="mt-2 text-[13px] font-semibold uppercase tracking-wide text-ink-subtle">
        {d.jobPreferences.additionalTitle}
      </h2>

      {/* 7. Relocation */}
      <Card>
        <CardHeader
          title={d.jobPreferences.relocationTitle}
          description={d.jobPreferences.relocationHint}
        />
        <CardBody>
          <Select
            label={d.jobPreferences.relocationLabel}
            value={state.willingToRelocate}
            options={[
              // "Not stated" is a real, selectable answer — the default is not
              // a hidden "no".
              { value: "", label: d.jobPreferences.notStated },
              { value: "yes", label: d.jobProfile.yes },
              { value: "no", label: d.jobProfile.no },
            ]}
            onChange={(event) => patch({ willingToRelocate: event.target.value })}
          />
        </CardBody>
      </Card>

      {/* 8. Industries */}
      <Card>
        <CardHeader
          title={d.jobPreferences.industriesTitle}
          description={d.jobPreferences.industriesHint}
        />
        <CardBody>
          <TagInput
            label={d.jobPreferences.industriesTitle}
            placeholder={d.jobPreferences.industriesPlaceholder}
            value={state.industries}
            onChange={(industries) => patch({ industries })}
          />
        </CardBody>
      </Card>

      {/* 9. Benefits */}
      <Card>
        <CardHeader
          title={d.jobPreferences.benefitsTitle}
          description={d.jobPreferences.benefitsHint}
        />
        <CardBody className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {JOB_BENEFITS.map((benefit) => (
            <Checkbox
              key={benefit}
              label={d.benefit[benefit]}
              checked={state.benefits.includes(benefit)}
              onChange={(event) =>
                toggle<JobBenefit>(
                  "benefits",
                  state.benefits,
                  benefit,
                  event.target.checked,
                )
              }
            />
          ))}
        </CardBody>
      </Card>

      {/* 10. Exclusions */}
      <Card>
        <CardHeader
          title={d.jobPreferences.exclusionsTitle}
          description={d.jobPreferences.exclusionsHint}
        />
        <CardBody className="flex flex-col gap-4">
          <TagInput
            label={d.jobPreferences.excludedCompanies}
            placeholder={d.jobPreferences.excludedCompaniesPlaceholder}
            value={state.excludedCompanies}
            onChange={(excludedCompanies) => patch({ excludedCompanies })}
          />
          <TagInput
            label={d.jobPreferences.excludedJobTitles}
            placeholder={d.jobPreferences.excludedJobTitlesPlaceholder}
            value={state.excludedJobTitles}
            onChange={(excludedJobTitles) => patch({ excludedJobTitles })}
          />
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-ink">
              {d.jobPreferences.excludedLocations}
            </p>
            <LocationEditor
              rows={state.excludedLocations}
              countryOptions={countryOptions}
              onChange={(excludedLocations) => patch({ excludedLocations })}
              d={d}
              f={f}
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[12.5px] text-ink-muted">
          {status === "saved" ? (
            <span className="flex items-center gap-1 text-success">
              <CheckIcon className="size-4" />
              {d.jobPreferences.saved}
            </span>
          ) : savedAt ? (
            <span>{f(d.jobPreferences.lastUpdated, { date: date(savedAt) })}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {preferences.stated ? (
            confirmingClear ? (
              <>
                <span className="text-[12.5px] text-ink-muted">
                  {d.jobPreferences.clearAllConfirm}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmingClear(false)}
                >
                  {d.common.cancel}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleClear}
                  disabled={status === "saving"}
                >
                  {d.jobPreferences.clearAll}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingClear(true)}
              >
                {d.jobPreferences.clearAll}
              </Button>
            )
          ) : null}
          <Button type="submit" loading={status === "saving"}>
            {d.jobPreferences.save}
          </Button>
        </div>
      </div>
    </form>
  );
}

"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { TagInput } from "@/components/ui/TagInput";
import { PlusIcon, TrashIcon, CloseIcon } from "@/components/ui/icons";
import { countryLabel, languageLabel } from "@/lib/vacancy/job-profile";
import { format as f } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type { LanguageRow, ProfileFormState } from "@/lib/vacancy/profile-form";
import {
  EDUCATION_LEVELS,
  HIRING_URGENCIES,
  JOB_BENEFITS,
  LANGUAGE_PROFICIENCIES,
  PAY_PERIODS,
  SENIORITY_LEVELS,
  VISA_SPONSORSHIP_VALUES,
  WORK_MODES,
} from "@/lib/types";
import type {
  CitizenshipRequirement,
  JobBenefit,
  LanguageProficiency,
  VisaSponsorship,
} from "@/lib/types";

/** ISO-4217 codes the backend accepts (SUPPORTED_CURRENCIES). */
export const CURRENCY_OPTIONS = [
  "KRW",
  "USD",
  "EUR",
  "JPY",
  "GBP",
  "UZS",
  "RUB",
  "KZT",
  "CNY",
  "INR",
  "SGD",
  "AED",
  "AUD",
  "CAD",
  "CHF",
  "TRY",
  "PLN",
] as const;

/** Suggestions only — the field accepts any country's visa class. */
export const VISA_TYPE_SUGGESTIONS = "E-7, F-2, F-4, D-10, H-1B";

interface SectionProps {
  state: ProfileFormState;
  patch: (next: Partial<ProfileFormState>) => void;
  errors: FieldErrors;
  d: Dictionary;
}

/** "Not specified" as a real, selectable answer rather than a missing one. */
function optional(
  d: Dictionary,
  options: { value: string; label: string }[],
): { value: string; label: string }[] {
  return [{ value: "", label: d.jobProfile.notSpecified }, ...options];
}

function enumOptions<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): { value: string; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** A yes / no / unstated control. Unstated is the default and stays a choice. */
function TriStateSelect({
  label,
  hint,
  value,
  onChange,
  d,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  d: Dictionary;
}) {
  return (
    <Select
      label={label}
      hint={hint}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={[
        { value: "", label: d.jobProfile.notSpecified },
        { value: "yes", label: d.jobProfile.yes },
        { value: "no", label: d.jobProfile.no },
      ]}
    />
  );
}

/**
 * Picks ISO country codes from the translated list.
 *
 * A select-and-add rather than free text: these values are compared with other
 * jobs later, and "Korea" / "South Korea" / "대한민국" typed by three
 * recruiters are three unmatchable values.
 */
function CountryCodePicker({
  label,
  hint,
  value,
  onChange,
  d,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  d: Dictionary;
}) {
  const available = Object.keys(d.country)
    .filter((code) => !value.includes(code))
    .map((code) => ({ value: code, label: countryLabel(code, d) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-col gap-2">
      <Select
        label={label}
        hint={hint}
        value=""
        options={[{ value: "", label: d.vacancyForm.choose }, ...available]}
        onChange={(event) => {
          if (event.target.value) onChange([...value, event.target.value]);
        }}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((code) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== code))}
                className="flex items-center gap-1 rounded-full border border-line bg-surface-muted/60 px-2.5 py-1 text-[12px] text-ink transition-colors hover:border-critical hover:text-critical"
              >
                {countryLabel(code, d)}
                <CloseIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CompensationSection({ state, patch, errors, d }: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.compensation}
        description={d.vacancyForm.compensationHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Input
          label={d.vacancyForm.salaryMin}
          inputMode="numeric"
          placeholder="55000000"
          value={state.salaryMin}
          error={errors.salaryMin}
          onChange={(event) => patch({ salaryMin: event.target.value })}
        />
        <Input
          label={d.vacancyForm.salaryMax}
          inputMode="numeric"
          placeholder="70000000"
          value={state.salaryMax}
          error={errors.salaryMax}
          onChange={(event) => patch({ salaryMax: event.target.value })}
        />
        <Select
          label={d.vacancyForm.currency}
          value={state.currency}
          error={errors.currency}
          options={optional(
            d,
            CURRENCY_OPTIONS.map((code) => ({ value: code, label: code })),
          )}
          onChange={(event) => patch({ currency: event.target.value })}
        />
        <Select
          label={d.vacancyForm.payPeriod}
          value={state.payPeriod}
          options={optional(d, enumOptions(PAY_PERIODS, d.payPeriod))}
          onChange={(event) => patch({ payPeriod: event.target.value })}
        />
        <Checkbox
          className="sm:col-span-2"
          label={d.vacancyForm.salaryNegotiable}
          checked={state.salaryNegotiable}
          onChange={(event) => patch({ salaryNegotiable: event.target.checked })}
        />
      </CardBody>
    </Card>
  );
}

export function LocationSection({ state, patch, errors, d }: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.locationWork}
        description={d.vacancyForm.locationSectionHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Select
          label={d.vacancyForm.countryLabel}
          value={state.country}
          options={optional(
            d,
            Object.keys(d.country)
              .map((code) => ({ value: code, label: countryLabel(code, d) }))
              .sort((a, b) => a.label.localeCompare(b.label)),
          )}
          onChange={(event) => patch({ country: event.target.value })}
        />
        <Input
          label={d.vacancyForm.regionLabel}
          placeholder={d.vacancyForm.regionPlaceholder}
          value={state.region}
          onChange={(event) => patch({ region: event.target.value })}
        />
        <Input
          label={d.vacancyForm.cityLabel}
          placeholder={d.vacancyForm.cityPlaceholder}
          value={state.city}
          onChange={(event) => patch({ city: event.target.value })}
        />
        <Select
          label={d.jobProfile.workModeLabel}
          value={state.workMode}
          options={optional(d, enumOptions(WORK_MODES, d.workMode))}
          onChange={(event) => patch({ workMode: event.target.value })}
        />

        {/*
          Only the fields the chosen work mode can actually answer. An office-
          days box on a remote job is a question with no meaningful answer, and
          the backend clears such a value anyway.
        */}
        {state.workMode === "ONSITE" || state.workMode === "HYBRID" ? (
          <Input
            label={d.jobProfile.officeDays}
            hint={d.vacancyForm.officeDaysHint}
            inputMode="numeric"
            value={state.officeDaysPerWeek}
            error={errors.officeDaysPerWeek}
            onChange={(event) =>
              patch({ officeDaysPerWeek: event.target.value })
            }
          />
        ) : null}

        {state.workMode === "REMOTE" ? (
          <div className="sm:col-span-2">
            <CountryCodePicker
              label={d.jobProfile.remoteCountries}
              hint={d.vacancyForm.remoteCountriesHint}
              value={state.remoteCountriesAllowed}
              onChange={(remoteCountriesAllowed) =>
                patch({ remoteCountriesAllowed })
              }
              d={d}
            />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function WorkAuthorizationSection({
  state,
  patch,
  errors,
  d,
}: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.workAuthorization}
        description={d.vacancyForm.visaSectionHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <TriStateSelect
          label={d.jobProfile.foreignApplicants}
          value={state.foreignApplicantsAccepted}
          onChange={(foreignApplicantsAccepted) =>
            patch({ foreignApplicantsAccepted })
          }
          d={d}
        />
        <Select
          label={d.jobProfile.visaSponsorshipLabel}
          value={state.visaSponsorship}
          options={enumOptions(VISA_SPONSORSHIP_VALUES, d.visaSponsorship)}
          onChange={(event) =>
            patch({ visaSponsorship: event.target.value as VisaSponsorship })
          }
        />
        <TriStateSelect
          label={d.jobProfile.existingWorkAuth}
          value={state.existingWorkAuthorizationRequired}
          onChange={(existingWorkAuthorizationRequired) =>
            patch({ existingWorkAuthorizationRequired })
          }
          d={d}
        />
        <TagInput
          label={d.jobProfile.eligibleVisas}
          hint={VISA_TYPE_SUGGESTIONS}
          placeholder="E-7"
          value={state.eligibleVisaTypes}
          onChange={(eligibleVisaTypes) => patch({ eligibleVisaTypes })}
        />

        <Select
          label={d.jobProfile.citizenship}
          hint={d.vacancyForm.citizenshipHint}
          value={state.citizenshipRequirement}
          options={[
            { value: "NONE", label: d.citizenshipRequirement.NONE },
            { value: "SPECIFIC", label: d.citizenshipRequirement.SPECIFIC },
          ]}
          onChange={(event) =>
            patch({
              citizenshipRequirement: event.target
                .value as CitizenshipRequirement,
            })
          }
        />
        {state.citizenshipRequirement === "SPECIFIC" ? (
          <CountryCodePicker
            label={d.jobProfile.eligibleNationalities}
            value={state.eligibleNationalities}
            onChange={(eligibleNationalities) =>
              patch({ eligibleNationalities })
            }
            d={d}
          />
        ) : null}
        {errors.eligibleNationalities ? (
          <p role="alert" className="text-[12.5px] text-critical sm:col-span-2">
            {errors.eligibleNationalities}
          </p>
        ) : null}

        <p className="text-[12px] text-ink-muted sm:col-span-2">
          {d.jobProfile.visaDisclaimer}
        </p>
      </CardBody>
    </Card>
  );
}

export function ExperienceSection({ state, patch, errors, d }: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.experience}
        description={d.vacancyForm.experienceSectionHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-3">
        <Select
          label={d.jobProfile.seniority}
          value={state.seniorityLevel}
          options={optional(d, enumOptions(SENIORITY_LEVELS, d.seniorityLevel))}
          onChange={(event) => patch({ seniorityLevel: event.target.value })}
        />
        <Input
          label={d.jobProfile.minExperience}
          inputMode="numeric"
          placeholder="5"
          value={state.minExperienceYears}
          error={errors.minExperienceYears}
          onChange={(event) => patch({ minExperienceYears: event.target.value })}
        />
        <Input
          label={d.jobProfile.preferredExperience}
          inputMode="numeric"
          placeholder="7"
          value={state.preferredExperienceYears}
          error={errors.preferredExperienceYears}
          onChange={(event) =>
            patch({ preferredExperienceYears: event.target.value })
          }
        />
      </CardBody>
    </Card>
  );
}

export function EducationSection({ state, patch, d }: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.education}
        description={d.vacancyForm.educationSectionHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Select
          label={d.jobProfile.requiredEducation}
          value={state.requiredEducation}
          options={optional(d, enumOptions(EDUCATION_LEVELS, d.educationLevel))}
          onChange={(event) => patch({ requiredEducation: event.target.value })}
        />
        <Select
          label={d.jobProfile.preferredEducation}
          value={state.preferredEducation}
          options={optional(d, enumOptions(EDUCATION_LEVELS, d.educationLevel))}
          onChange={(event) => patch({ preferredEducation: event.target.value })}
        />
        <TagInput
          label={d.jobProfile.requiredCertifications}
          placeholder="AWS Solutions Architect"
          value={state.requiredCertifications}
          onChange={(requiredCertifications) => patch({ requiredCertifications })}
        />
        <TagInput
          label={d.jobProfile.preferredCertifications}
          placeholder="CKA"
          value={state.preferredCertifications}
          onChange={(preferredCertifications) =>
            patch({ preferredCertifications })
          }
        />
        <div className="sm:col-span-2">
          <TagInput
            label={d.jobProfile.domainExperience}
            hint={d.vacancyForm.domainExperienceHint}
            placeholder="Fintech"
            value={state.domainExperience}
            onChange={(domainExperience) => patch({ domainExperience })}
          />
        </div>
      </CardBody>
    </Card>
  );
}

export function LanguagesSection({ state, patch, errors, d }: SectionProps) {
  const languageOptions = Object.keys(d.jobLanguage)
    .map((code) => ({ value: code, label: languageLabel(code, d) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  function updateRow(key: string, next: Partial<LanguageRow>) {
    patch({
      languages: state.languages.map((row) =>
        row.key === key ? { ...row, ...next } : row,
      ),
    });
  }

  return (
    <Card>
      <CardHeader
        title={d.jobProfile.languages}
        description={d.vacancyForm.languagesHint}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<PlusIcon className="size-4" />}
            onClick={() =>
              patch({
                languages: [
                  ...state.languages,
                  {
                    key: `lang-${Date.now()}-${state.languages.length}`,
                    languageCode: "",
                    level: "B1",
                    required: true,
                  },
                ],
              })
            }
          >
            {d.vacancyForm.addLanguage}
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-2.5">
        {errors.languages ? (
          <p role="alert" className="text-[12.5px] text-critical">
            {errors.languages}
          </p>
        ) : null}

        {state.languages.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">
            {d.vacancyForm.noLanguages}
          </p>
        ) : null}

        {state.languages.map((row, index) => (
          <div
            key={row.key}
            className="grid gap-2 sm:grid-cols-[1fr_1fr_9rem_auto]"
          >
            <Select
              aria-label={f(d.vacancyForm.languageAria, { index: index + 1 })}
              value={row.languageCode}
              options={[
                { value: "", label: d.jobProfile.notSpecified },
                ...languageOptions,
              ]}
              onChange={(event) =>
                updateRow(row.key, { languageCode: event.target.value })
              }
            />
            <Select
              aria-label={f(d.vacancyForm.languageLevelAria, { index: index + 1 })}
              value={row.level}
              options={LANGUAGE_PROFICIENCIES.map((level) => ({
                value: level,
                label: d.languageLevel[level],
              }))}
              onChange={(event) =>
                updateRow(row.key, {
                  level: event.target.value as LanguageProficiency,
                })
              }
            />
            <Select
              aria-label={f(d.vacancyForm.languagePriorityAria, { index: index + 1 })}
              value={row.required ? "required" : "preferred"}
              options={[
                { value: "required", label: d.jobProfile.required },
                { value: "preferred", label: d.jobProfile.preferred },
              ]}
              onChange={(event) =>
                updateRow(row.key, {
                  required: event.target.value === "required",
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={f(d.vacancyForm.removeLanguageAria, { index: index + 1 })}
              onClick={() =>
                patch({
                  languages: state.languages.filter(
                    (item) => item.key !== row.key,
                  ),
                })
              }
              className="justify-self-start sm:justify-self-auto"
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function BenefitsSection({ state, patch, d }: SectionProps) {
  function toggle(benefit: JobBenefit, on: boolean) {
    patch({
      benefits: on
        ? [...state.benefits, benefit]
        : state.benefits.filter((item) => item !== benefit),
    });
  }

  return (
    <Card>
      <CardHeader
        title={d.jobProfile.benefits}
        description={d.vacancyForm.benefitsHint}
      />
      <CardBody className="flex flex-col gap-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {JOB_BENEFITS.map((benefit) => (
            <Checkbox
              key={benefit}
              label={d.benefit[benefit]}
              checked={state.benefits.includes(benefit)}
              onChange={(event) => toggle(benefit, event.target.checked)}
            />
          ))}
        </div>
        {state.benefits.includes("OTHER") ? (
          <Input
            label={d.vacancyForm.benefitsOther}
            value={state.benefitsOther}
            onChange={(event) => patch({ benefitsOther: event.target.value })}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}

export function TimelineSection({ state, patch, errors, d }: SectionProps) {
  return (
    <Card>
      <CardHeader
        title={d.jobProfile.timeline}
        description={d.vacancyForm.timelineHint}
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Input
          type="date"
          label={d.jobProfile.deadline}
          value={state.applicationDeadline}
          onChange={(event) =>
            patch({ applicationDeadline: event.target.value })
          }
        />
        <Input
          type="date"
          label={d.jobProfile.expectedStart}
          hint={d.vacancyForm.startDateHint}
          value={state.expectedStartDate}
          onChange={(event) => patch({ expectedStartDate: event.target.value })}
        />
        <Input
          label={d.jobProfile.openings}
          inputMode="numeric"
          placeholder="2"
          value={state.openingsCount}
          error={errors.openingsCount}
          onChange={(event) => patch({ openingsCount: event.target.value })}
        />
        <Select
          label={d.jobProfile.urgency}
          value={state.hiringUrgency}
          options={optional(d, enumOptions(HIRING_URGENCIES, d.hiringUrgency))}
          onChange={(event) => patch({ hiringUrgency: event.target.value })}
        />
        <Input
          label={d.jobProfile.contractDuration}
          hint={d.vacancyForm.contractDurationHint}
          inputMode="numeric"
          value={state.contractDurationMonths}
          error={errors.contractDurationMonths}
          onChange={(event) =>
            patch({ contractDurationMonths: event.target.value })
          }
        />
      </CardBody>
    </Card>
  );
}


"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { createVacancyAction } from "@/app/(app)/vacancies/new/actions";
import { updateVacancyAction } from "@/app/(app)/vacancies/[id]/edit/actions";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { AlertIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import {
  BenefitsSection,
  CompensationSection,
  EducationSection,
  ExperienceSection,
  LanguagesSection,
  LocationSection,
  TimelineSection,
  WorkAuthorizationSection,
} from "@/components/vacancies/VacancyProfileFields";
import {
  EMPLOYMENT_TYPE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
} from "@/lib/constants";
import { useI18n } from "@/lib/i18n/context";
import type { FieldErrors } from "@/lib/api/errors";
import { REQUIREMENT_TYPES } from "@/lib/types";
import {
  emptyProfileState,
  profileInputFromState,
  profileStateFromVacancy,
  validateProfileState,
  type ProfileFormState,
} from "@/lib/vacancy/profile-form";
import type {
  CreateVacancyInput,
  JobRequirementInput,
  RequirementType,
  Vacancy,
} from "@/lib/types";

interface RequirementRow {
  key: string;
  text: string;
  /** The API models priority as a boolean, not an enum. */
  required: boolean;
  type: RequirementType;
}

let rowCounter = 0;
function newRow(text = ""): RequirementRow {
  rowCounter += 1;
  return { key: `req-${rowCounter}`, text, required: true, type: "SKILL" };
}

interface VacancyFormProps {
  /**
   * Editing hydrates from an existing vacancy and PATCHes it; creating starts
   * blank and POSTs. The sections in between are identical, which is the
   * point — a field that can be set at creation can always be corrected later.
   */
  vacancy?: Vacancy;
}

export function VacancyForm({ vacancy }: VacancyFormProps) {
  const router = useRouter();
  const { d, f } = useI18n();
  const isEdit = Boolean(vacancy);

  /**
   * Employment type and experience level are free text on the API. The option
   * *value* stays canonical English so one organization's records do not
   * fragment by whichever language each recruiter was using; only the label is
   * translated.
   */
  const employmentOptions = EMPLOYMENT_TYPE_OPTIONS.map((value) => ({
    value,
    label: d.employmentType[value],
  }));
  const experienceOptions = EXPERIENCE_LEVEL_OPTIONS.map((value) => ({
    value,
    label: d.experienceLevel[value],
  }));
  const priorityOptions = [
    { value: "required", label: d.status.requirementPriority.required },
    { value: "optional", label: d.status.requirementPriority.optional },
  ];
  const typeOptions = REQUIREMENT_TYPES.map((type) => ({
    value: type,
    label: d.status.requirementType[type],
  }));
  const exampleRequirements = d.vacancyForm.examples;

  const [title, setTitle] = useState(vacancy?.title ?? "");
  const [department, setDepartment] = useState(vacancy?.department ?? "");
  const [location, setLocation] = useState(vacancy?.location ?? "");
  const [employmentType, setEmploymentType] = useState<string>(
    vacancy?.employmentType ?? EMPLOYMENT_TYPE_OPTIONS[0],
  );
  const [experienceLevel, setExperienceLevel] = useState<string>(
    vacancy?.experienceLevel ?? EXPERIENCE_LEVEL_OPTIONS[2],
  );
  const [description, setDescription] = useState(vacancy?.description ?? "");
  const [profile, setProfile] = useState<ProfileFormState>(() =>
    vacancy ? profileStateFromVacancy(vacancy) : emptyProfileState(),
  );
  const [requirements, setRequirements] = useState<RequirementRow[]>([
    newRow(),
    newRow(),
  ]);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patchProfile(next: Partial<ProfileFormState>) {
    setProfile((current) => ({ ...current, ...next }));
  }

  function updateRow(key: string, patch: Partial<RequirementRow>) {
    setRequirements((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function validate(): FieldErrors {
    const next: FieldErrors = { ...validateProfileState(profile, d) };
    if (!title.trim()) next.title = d.vacancyForm.errTitle;
    if (!department.trim()) next.department = d.vacancyForm.errDepartment;
    if (!location.trim()) next.location = d.vacancyForm.errLocation;
    if (!description.trim()) {
      next.description = d.vacancyForm.errDescription;
    }
    // Requirements are created alongside a NEW vacancy only; on an edit they
    // are managed on the vacancy page and this form does not touch them.
    if (!isEdit && requirements.every((row) => !row.text.trim())) {
      next.requirements = d.vacancyForm.errRequirements;
    }
    return next;
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
    status: "DRAFT" | "OPEN",
  ) {
    event.preventDefault();
    setFormError(null);

    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    const base: CreateVacancyInput = {
      ...profileInputFromState(profile, isEdit ? "edit" : "create"),
      title: title.trim(),
      department: department.trim() || undefined,
      location: location.trim() || undefined,
      employmentType,
      experienceLevel,
      description: description.trim() || undefined,
    };

    setSubmitting(true);

    if (vacancy) {
      // An edit never changes the lifecycle stage: publishing, closing and
      // archiving are their own deliberate actions elsewhere.
      const result = await updateVacancyAction(vacancy.id, base);
      if (result.ok) {
        router.push(`/vacancies/${vacancy.id}`);
        return;
      }
      setFormError(result.message);
      setErrors(result.fieldErrors);
      setSubmitting(false);
      return;
    }

    const requirementInputs: JobRequirementInput[] = requirements
      .filter((row) => row.text.trim())
      .map((row) => ({
        text: row.text.trim(),
        type: row.type,
        required: row.required,
      }));

    const result = await createVacancyAction(
      { ...base, status },
      requirementInputs,
    );

    if (result.ok) {
      router.push(`/vacancies/${result.vacancyId}`);
      return;
    }

    setFormError(result.message);
    setErrors(result.fieldErrors);
    setSubmitting(false);
  }

  const sectionProps = { state: profile, patch: patchProfile, errors, d };

  return (
    <form
      onSubmit={(event) => handleSubmit(event, "OPEN")}
      noValidate
      className="flex flex-col gap-4"
    >
      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      <Card>
        <CardHeader
            title={d.vacancyForm.roleTitle}
            description={d.vacancyForm.roleHint}
          />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label={d.vacancyForm.title}
            required
            placeholder={d.vacancyForm.titlePlaceholder}
            value={title}
            error={errors.title}
            onChange={(event) => setTitle(event.target.value)}
            wrapperClassName="sm:col-span-2"
          />
          <Input
            label={d.vacancyForm.department}
            required
            placeholder={d.vacancyForm.departmentPlaceholder}
            value={department}
            error={errors.department}
            onChange={(event) => setDepartment(event.target.value)}
          />
          <Input
            label={d.vacancyForm.location}
            required
            placeholder={d.vacancyForm.locationPlaceholder}
            value={location}
            error={errors.location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <Select
            label={d.vacancyForm.employmentType}
            value={employmentType}
            options={employmentOptions}
            onChange={(event) => setEmploymentType(event.target.value)}
          />
          <Select
            label={d.vacancyForm.experienceLevel}
            value={experienceLevel}
            options={experienceOptions}
            onChange={(event) => setExperienceLevel(event.target.value)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.vacancyForm.descriptionTitle}
          description={d.vacancyForm.descriptionHint}
        />
        <CardBody>
          <Textarea
            label={d.vacancyForm.description}
            required
            rows={9}
            placeholder={d.vacancyForm.descriptionPlaceholder}
            value={description}
            error={errors.description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </CardBody>
      </Card>

      <CompensationSection {...sectionProps} />
      <LocationSection {...sectionProps} />
      <ExperienceSection {...sectionProps} />

      {/*
        Requirements are the evidence checks each resume is read against, and
        they have their own endpoints. They are collected once, with the new
        vacancy; editing them from here would mean diffing a list whose
        removals delete stored evidence.
      */}
      {isEdit ? (
        <Card>
          <CardHeader title={d.vacancyDetail.requirements} />
          <CardBody>
            <p className="text-[13px] text-ink-muted">
              {d.vacancyForm.editRequirementsNote}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={d.vacancyForm.requirementsTitle}
            description={d.vacancyForm.requirementsHint}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<PlusIcon className="size-4" />}
                onClick={() => setRequirements((rows) => [...rows, newRow()])}
              >
                {d.vacancyForm.addRequirement}
              </Button>
            }
          />
          <CardBody className="flex flex-col gap-2.5">
            {errors.requirements ? (
              <p role="alert" className="text-[12.5px] text-critical">
                {errors.requirements}
              </p>
            ) : null}

            {requirements.map((row, index) => (
              <div
                key={row.key}
                className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]"
              >
                <Input
                  aria-label={f(d.vacancyForm.requirementAria, { index: index + 1 })}
                  placeholder={
                    exampleRequirements[index % exampleRequirements.length]
                  }
                  value={row.text}
                  onChange={(event) =>
                    updateRow(row.key, { text: event.target.value })
                  }
                />
                <Select
                  aria-label={f(d.vacancyForm.priorityAria, { index: index + 1 })}
                  value={row.required ? "required" : "optional"}
                  options={priorityOptions}
                  onChange={(event) =>
                    updateRow(row.key, {
                      required: event.target.value === "required",
                    })
                  }
                />
                <Select
                  aria-label={f(d.vacancyForm.typeAria, { index: index + 1 })}
                  value={row.type}
                  options={typeOptions}
                  onChange={(event) =>
                    updateRow(row.key, {
                      type: event.target.value as RequirementType,
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={f(d.vacancyForm.removeAria, { index: index + 1 })}
                  disabled={requirements.length === 1}
                  onClick={() =>
                    setRequirements((rows) =>
                      rows.filter((item) => item.key !== row.key),
                    )
                  }
                  className="justify-self-start sm:justify-self-auto"
                >
                  <TrashIcon className="size-4" />
                </Button>
              </div>
            ))}

            <p className="text-[12.5px] text-ink-muted">
              {d.vacancyForm.requirementsNote}
            </p>
          </CardBody>
        </Card>
      )}

      <LanguagesSection {...sectionProps} />
      <WorkAuthorizationSection {...sectionProps} />
      <EducationSection {...sectionProps} />
      <BenefitsSection {...sectionProps} />
      <TimelineSection {...sectionProps} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link
          href={vacancy ? `/vacancies/${vacancy.id}` : "/vacancies"}
          className={buttonStyles("ghost", "md")}
        >
          {d.common.cancel}
        </Link>
        {isEdit ? (
          <Button type="submit" loading={submitting}>
            {d.vacancyForm.saveChanges}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={(event) =>
                handleSubmit(
                  event as unknown as React.FormEvent<HTMLFormElement>,
                  "DRAFT",
                )
              }
            >
              {d.vacancyForm.saveDraft}
            </Button>
            <Button type="submit" loading={submitting}>
              {d.vacancyForm.publish}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createCandidateAction } from "@/app/(app)/candidates/new/actions";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { AlertIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { FieldErrors } from "@/lib/api/errors";
import type { CreateCandidateInput, Vacancy } from "@/lib/types";

interface CandidateFormProps {
  vacancies: Vacancy[];
  initialVacancyId?: string;
}

export function CandidateForm({
  vacancies,
  initialVacancyId = "",
}: CandidateFormProps) {
  const router = useRouter();
  const { d } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [years, setYears] = useState("");
  const [vacancyId, setVacancyId] = useState(initialVacancyId);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const next: FieldErrors = {};
    if (!fullName.trim()) next.fullName = d.candidateForm.errFullName;
    else if (fullName.trim().length < 2)
      next.fullName = d.candidateForm.errFullNameShort;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      next.email = d.candidateForm.errEmail;
    }
    if (years && (Number.isNaN(Number(years)) || Number(years) < 0 || Number(years) > 80)) {
      next.totalExperienceYears = d.candidateForm.errYears;
    }

    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;

    const input: CreateCandidateInput = {
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      location: location.trim() || undefined,
      currentTitle: currentTitle.trim() || undefined,
      totalExperienceYears: years ? Number(years) : undefined,
    };

    startTransition(async () => {
      const result = await createCandidateAction(input, vacancyId || null);
      if (result.ok) {
        router.push(`/candidates/${result.candidateId}`);
        return;
      }
      setFormError(result.message);
      setErrors(result.fieldErrors);
    });
  }

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

      <Card>
        <CardHeader
          title={d.candidateForm.candidateTitle}
          description={d.candidateForm.candidateHint}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label={d.candidates.fieldFullName}
            required
            value={fullName}
            error={errors.fullName}
            disabled={pending}
            onChange={(event) => setFullName(event.target.value)}
            wrapperClassName="sm:col-span-2"
          />
          <Input
            label={d.candidates.fieldEmail}
            type="email"
            value={email}
            error={errors.email}
            disabled={pending}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label={d.candidates.fieldPhone}
            value={phone}
            error={errors.phone}
            disabled={pending}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Input
            label={d.candidates.fieldCurrentTitle}
            value={currentTitle}
            error={errors.currentTitle}
            disabled={pending}
            onChange={(event) => setCurrentTitle(event.target.value)}
          />
          <Input
            label={d.candidates.fieldLocation}
            value={location}
            error={errors.location}
            disabled={pending}
            onChange={(event) => setLocation(event.target.value)}
          />
          <Input
            label={d.candidates.fieldExperienceYears}
            type="number"
            min={0}
            max={80}
            value={years}
            error={errors.totalExperienceYears}
            disabled={pending}
            onChange={(event) => setYears(event.target.value)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidateForm.vacancyTitle}
          description={d.candidateForm.vacancyHint}
        />
        <CardBody>
          <Select
            label={d.candidateForm.applyToVacancy}
            value={vacancyId}
            disabled={pending}
            options={[
              { value: "", label: d.candidateForm.noVacancy },
              ...vacancies.map((vacancy) => ({
                value: vacancy.id,
                label: vacancy.title,
              })),
            ]}
            onChange={(event) => setVacancyId(event.target.value)}
            className="sm:max-w-md"
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/candidates" className={buttonStyles("ghost", "md")}>
          {d.common.cancel}
        </Link>
        <Button type="submit" loading={pending}>
          {d.candidates.add}
        </Button>
      </div>
    </form>
  );
}

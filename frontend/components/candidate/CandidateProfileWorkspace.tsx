"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createCandidateAccountAction,
  updateCandidateAccountAction,
} from "@/app/(candidate)/actions";
import { PersonalResumeCard } from "@/components/candidate/PersonalResumeCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { TagInput } from "@/components/ui/TagInput";
import {
  AlertIcon,
  CheckIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { PROFILE_VISIBILITIES } from "@/lib/types";
import type {
  CandidateAccount,
  CandidateEducation,
  CandidateExperience,
  ProfileVisibility,
} from "@/lib/types";

/**
 * The job seeker's own profile.
 *
 * Only fields the backend's `UpsertCandidateAccountDto` actually accepts are
 * offered — nothing is invented, and nothing recruiter-side leaks in. Dates in
 * experience are free text on purpose: the backend accepts "2021", "2021-03"
 * or a Korean/Russian/Uzbek phrase, because a resume is not a form.
 */
export function CandidateProfileWorkspace({
  account,
}: {
  account: CandidateAccount | null;
}) {
  const { d, f } = useI18n();
  const router = useRouter();

  const [creating, startCreate] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

  function create() {
    if (creating) return;
    setCreateError(null);
    startCreate(async () => {
      const result = await createCandidateAccountAction({});
      if (!result.ok) {
        setCreateError(
          result.message ?? d.candidateProfile.createFailed,
        );
        return;
      }
      router.refresh();
    });
  }

  if (!account) {
    return (
      <Card>
        <EmptyState
          icon={<UserIcon className="size-5" />}
          title={d.candidateProfile.createTitle}
          description={d.candidateProfile.createHint}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button
                type="button"
                loading={creating}
                disabled={creating}
                onClick={create}
              >
                {d.candidateProfile.create}
              </Button>
              {createError ? (
                <p role="alert" className="text-[12.5px] text-critical">
                  {createError}
                </p>
              ) : null}
            </div>
          }
        />
      </Card>
    );
  }

  return <ProfileForm account={account} labelFor={f} />;
}

function ProfileForm({
  account,
}: {
  account: CandidateAccount;
  labelFor: (template: string, values?: Record<string, string | number>) => string;
}) {
  const { d, f } = useI18n();
  const router = useRouter();

  const [headline, setHeadline] = useState(account.headline ?? "");
  const [location, setLocation] = useState(account.location ?? "");
  const [phone, setPhone] = useState(account.phone ?? "");
  const [summary, setSummary] = useState(account.summary ?? "");
  const [skills, setSkills] = useState<string[]>(account.skills);
  const [languages, setLanguages] = useState<string[]>(account.languages);
  const [experience, setExperience] = useState<CandidateExperience[]>(
    account.experience,
  );
  const [education, setEducation] = useState<CandidateEducation[]>(
    account.education,
  );
  const [visibility, setVisibility] = useState<ProfileVisibility>(
    account.profileVisibility,
  );

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function patchExperience(index: number, patch: Partial<CandidateExperience>) {
    setExperience((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function patchEducation(index: number, patch: Partial<CandidateEducation>) {
    setEducation((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;

    // The backend requires a title per role and an institution per education
    // entry; blank rows are dropped rather than rejected, so an empty row the
    // user added and abandoned does not block saving the rest.
    const cleanExperience = experience.filter((row) => row.title.trim());
    const cleanEducation = education.filter((row) => row.institution.trim());

    setSaved(false);
    setError(null);

    startTransition(async () => {
      const result = await updateCandidateAccountAction({
        headline: headline.trim(),
        location: location.trim(),
        phone: phone.trim(),
        summary: summary.trim(),
        skills,
        languages,
        experience: cleanExperience,
        education: cleanEducation,
        profileVisibility: visibility,
      });

      if (!result.ok) {
        setError(result.message ?? d.candidateProfile.saveFailed);
        return;
      }
      setExperience(cleanExperience);
      setEducation(cleanEducation);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <PersonalResumeCard resume={account.resume} />

      <Card>
        <CardHeader
          title={d.candidateProfile.basics}
          description={d.candidateProfile.basicsHint}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input
            label={d.candidateProfile.headline}
            placeholder={d.candidateProfile.headlinePlaceholder}
            value={headline}
            disabled={pending}
            onChange={(event) => setHeadline(event.target.value)}
            wrapperClassName="sm:col-span-2"
          />
          <Input
            label={d.candidateProfile.location}
            value={location}
            disabled={pending}
            onChange={(event) => setLocation(event.target.value)}
          />
          <Input
            label={d.candidateProfile.phone}
            value={phone}
            disabled={pending}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Textarea
            label={d.candidateProfile.summary}
            placeholder={d.candidateProfile.summaryPlaceholder}
            rows={5}
            value={summary}
            disabled={pending}
            onChange={(event) => setSummary(event.target.value)}
            className="sm:col-span-2"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={d.candidateProfile.skills} />
        <CardBody className="flex flex-col gap-4">
          <TagInput
            label={d.candidateProfile.skills}
            hint={d.candidateProfile.skillsHint}
            value={skills}
            onChange={setSkills}
          />
          <TagInput
            label={d.candidateProfile.languages}
            hint={d.candidateProfile.skillsHint}
            value={languages}
            onChange={setLanguages}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidateProfile.experience}
          description={d.candidateProfile.experienceHint}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<PlusIcon className="size-4" />}
              disabled={pending}
              onClick={() =>
                setExperience((rows) => [...rows, { title: "" }])
              }
            >
              {d.candidateProfile.addExperience}
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          {experience.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              {d.candidateProfile.experienceHint}
            </p>
          ) : null}

          {experience.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
            >
              <Input
                label={d.candidateProfile.jobTitle}
                value={row.title}
                disabled={pending}
                onChange={(event) =>
                  patchExperience(index, { title: event.target.value })
                }
              />
              <Input
                label={d.candidateProfile.company}
                value={row.company ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchExperience(index, { company: event.target.value })
                }
              />
              <Input
                label={d.candidateProfile.startDate}
                value={row.startDate ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchExperience(index, { startDate: event.target.value })
                }
              />
              <Input
                label={d.candidateProfile.endDate}
                value={row.endDate ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchExperience(index, { endDate: event.target.value })
                }
              />
              <Textarea
                label={d.candidateProfile.roleDescription}
                rows={3}
                value={row.description ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchExperience(index, { description: event.target.value })
                }
                className="sm:col-span-2"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={f(d.candidateProfile.removeExperience, {
                  index: index + 1,
                })}
                onClick={() =>
                  setExperience((rows) => rows.filter((_, i) => i !== index))
                }
                className="justify-self-start"
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidateProfile.education}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<PlusIcon className="size-4" />}
              disabled={pending}
              onClick={() =>
                setEducation((rows) => [...rows, { institution: "" }])
              }
            >
              {d.candidateProfile.addEducation}
            </Button>
          }
        />
        <CardBody className="flex flex-col gap-4">
          {education.map((row, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2"
            >
              <Input
                label={d.candidateProfile.institution}
                value={row.institution}
                disabled={pending}
                onChange={(event) =>
                  patchEducation(index, { institution: event.target.value })
                }
                wrapperClassName="sm:col-span-2"
              />
              <Input
                label={d.candidateProfile.degree}
                value={row.degree ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchEducation(index, { degree: event.target.value })
                }
              />
              <Input
                label={d.candidateProfile.field}
                value={row.field ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchEducation(index, { field: event.target.value })
                }
              />
              <Input
                label={d.candidateProfile.startYear}
                type="number"
                min={1900}
                max={2100}
                value={row.startYear ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchEducation(index, {
                    startYear: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
              <Input
                label={d.candidateProfile.endYear}
                type="number"
                min={1900}
                max={2100}
                value={row.endYear ?? ""}
                disabled={pending}
                onChange={(event) =>
                  patchEducation(index, {
                    endYear: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={f(d.candidateProfile.removeEducation, {
                  index: index + 1,
                })}
                onClick={() =>
                  setEducation((rows) => rows.filter((_, i) => i !== index))
                }
                className="justify-self-start"
              >
                <TrashIcon className="size-4" />
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidateProfile.visibility}
          description={d.candidateProfile.visibilityHint}
        />
        <CardBody>
          <Select
            label={d.candidateProfile.visibility}
            value={visibility}
            disabled={pending}
            options={PROFILE_VISIBILITIES.map((value) => ({
              value,
              label:
                value === "PRIVATE"
                  ? d.candidateProfile.visibilityPrivate
                  : d.candidateProfile.visibilityPublic,
            }))}
            onChange={(event) =>
              setVisibility(event.target.value as ProfileVisibility)
            }
            className="sm:max-w-xs"
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {d.common.save}
        </Button>
        {saved && !pending ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-[12.5px] text-positive"
          >
            <CheckIcon className="size-3.5" />
            {d.common.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}

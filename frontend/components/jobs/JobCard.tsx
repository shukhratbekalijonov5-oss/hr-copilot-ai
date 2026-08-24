"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { SaveJobButton } from "@/components/jobs/SaveJobButton";
import { BriefcaseIcon, MapPinIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { formatJobLocation, formatSalary } from "@/lib/vacancy/job-profile";
import type { PublicJob } from "@/lib/types";

interface JobCardProps {
  job: PublicJob;
  /** Whether this job is already in the caller's saved list. */
  saved: boolean;
}

/** One open role on the board. Addressed by its public slug, never by id. */
export function JobCard({ job, saved }: JobCardProps) {
  const { d, f, p, date } = useI18n();

  return (
    <Card className="flex h-full flex-col p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">
            <Link href={`/jobs/${job.publicSlug}`} className="hover:text-brand">
              {job.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-ink-muted">
            {job.organizationName}
          </p>
        </div>
        <SaveJobButton slug={job.publicSlug} saved={saved} />
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="size-3.5" />
          {/* Structured city/country when stated, the legacy line otherwise. */}
          {formatJobLocation(job, job.location, d) ?? d.tables.locationNotSet}
        </span>
        {job.department ? (
          <span className="inline-flex items-center gap-1">
            <BriefcaseIcon className="size-3.5" />
            {job.department}
          </span>
        ) : null}
      </p>

      {/*
        Pay is the fact a seeker scans a board for. Shown only when the
        employer actually stated it — never as "Not specified" noise on a card.
      */}
      {formatSalary(job, d) ? (
        <p className="mt-1.5 text-[13px] font-medium text-ink">
          {formatSalary(job, d)}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {job.workMode ? <Chip>{d.workMode[job.workMode]}</Chip> : null}
        {job.seniorityLevel ? (
          <Chip>{d.seniorityLevel[job.seniorityLevel]}</Chip>
        ) : null}
        {job.employmentType ? (
          <Chip>
            {d.employmentType[
              job.employmentType as keyof typeof d.employmentType
            ] ?? job.employmentType}
          </Chip>
        ) : null}
        {job.experienceLevel ? (
          <Chip>
            {d.experienceLevel[
              job.experienceLevel as keyof typeof d.experienceLevel
            ] ?? job.experienceLevel}
          </Chip>
        ) : null}
      </div>

      <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-subtle">
        <span>{f(d.jobs.postedOn, { date: date(job.createdAt) })}</span>
        {/*
          How many PEOPLE applied — the same live number the recruiter reads,
          and only the number. Zero is shown rather than hidden: "be the first
          to apply" is useful, and hiding it would make a quiet job look like a
          job whose count we could not compute.
        */}
        <span aria-hidden className="text-ink-subtle/50">
          &middot;
        </span>
        <span>{p(d.jobs.applicantCount, job.applicantCount)}</span>
      </p>
    </Card>
  );
}

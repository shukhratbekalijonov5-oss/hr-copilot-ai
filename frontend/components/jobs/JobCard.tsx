"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { SaveJobButton } from "@/components/jobs/SaveJobButton";
import { BriefcaseIcon, MapPinIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { PublicJob } from "@/lib/types";

interface JobCardProps {
  job: PublicJob;
  /** Whether this job is already in the caller's saved list. */
  saved: boolean;
}

/** One open role on the board. Addressed by its public slug, never by id. */
export function JobCard({ job, saved }: JobCardProps) {
  const { d, f, date } = useI18n();

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
          {job.location ?? d.tables.locationNotSet}
        </span>
        {job.department ? (
          <span className="inline-flex items-center gap-1">
            <BriefcaseIcon className="size-3.5" />
            {job.department}
          </span>
        ) : null}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
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

      <p className="mt-auto border-t border-line pt-3 text-[12px] text-ink-subtle">
        {f(d.jobs.postedOn, { date: date(job.createdAt) })}
      </p>
    </Card>
  );
}

"use client";

import { CandidateStatCard } from "@/components/candidate/ui";
import {
  BookmarkIcon,
  BriefcaseIcon,
  FileIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * The metric row.
 *
 * A count that could not be read renders as an em dash, never as zero — "you
 * have 0 saved jobs" and "we could not reach the server" are different
 * sentences, and only one of them is true.
 */
export function DashboardStats({
  activeApplications,
  savedJobs,
  evidenceSources,
}: {
  activeApplications: number | null;
  savedJobs: number | null;
  evidenceSources: number | null;
}) {
  const { d, n } = useI18n();
  const show = (value: number | null) => (value === null ? "—" : n(value));

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <CandidateStatCard
        label={d.home.stats.activeApplications}
        value={show(activeApplications)}
        hint={d.home.stats.activeApplicationsHint}
        icon={<BriefcaseIcon className="size-4" />}
        href="/my-applications"
      />
      <CandidateStatCard
        label={d.home.stats.savedJobs}
        value={show(savedJobs)}
        hint={d.home.stats.savedJobsHint}
        icon={<BookmarkIcon className="size-4" />}
        href="/saved-jobs"
      />
      <CandidateStatCard
        label={d.home.stats.evidence}
        value={show(evidenceSources)}
        hint={d.home.stats.evidenceHint}
        icon={<FileIcon className="size-4" />}
        href="/my-profile"
      />
    </div>
  );
}

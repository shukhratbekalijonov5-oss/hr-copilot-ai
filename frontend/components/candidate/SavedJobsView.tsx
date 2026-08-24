"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { unsaveJobAction } from "@/app/(candidate)/actions";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonStyles } from "@/components/ui/Button";
import {
  CandidateCard,
  CandidateEmptyState,
} from "@/components/candidate/ui";
import { BookmarkIcon, MapPinIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { SavedJob } from "@/lib/types";

/**
 * Bookmarked jobs.
 *
 * A job that closed after being saved is still listed — the bookmark is real —
 * but is flagged and not offered as applicable, because the backend will refuse
 * an application to a non-OPEN vacancy.
 */
export function SavedJobsView({ saved }: { saved: SavedJob[] }) {
  const { d, f, date } = useI18n();
  const [rows, setRows] = useState(saved);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(slug: string) {
    if (pending) return;
    setBusySlug(slug);

    startTransition(async () => {
      const result = await unsaveJobAction(slug);
      setBusySlug(null);
      if (result.ok) {
        setRows((current) => current.filter((row) => row.job.publicSlug !== slug));
      }
    });
  }

  if (rows.length === 0) {
    return (
      <CandidateEmptyState
        icon={<BookmarkIcon className="size-4.5" />}
        title={d.savedJobs.empty}
        description={d.savedJobs.emptyHint}
        action={
          <Link href="/jobs" className={buttonStyles("primary", "sm")}>
            {d.jobs.title}
          </Link>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((item) => {
        const open = item.job.status === "OPEN";

        return (
          <li key={item.job.publicSlug}>
            <CandidateCard interactive={open} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                    {open ? (
                      <Link
                        href={`/jobs/${item.job.publicSlug}`}
                        className="transition-colors duration-[var(--motion-fast)] hover:text-brand"
                      >
                        {item.job.title}
                      </Link>
                    ) : (
                      item.job.title
                    )}
                  </h3>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
                    <span className="truncate">{item.job.organizationName}</span>
                    {item.job.location ? (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPinIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{item.job.location}</span>
                      </span>
                    ) : null}
                  </p>
                </div>
                {open ? null : (
                  <Badge tone="neutral">{d.savedJobs.closed}</Badge>
                )}
              </div>

              {open ? null : (
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                  {d.savedJobs.closedHint}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[12px] text-ink-subtle">
                <span>{f(d.savedJobs.savedOn, { date: date(item.savedAt) })}</span>
                {open ? (
                  <Link
                    href={`/jobs/${item.job.publicSlug}`}
                    className="font-medium text-brand transition-colors duration-[var(--motion-fast)] hover:text-brand-hover"
                  >
                    {d.savedJobs.viewJob}
                  </Link>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  loading={busySlug === item.job.publicSlug}
                  disabled={pending}
                  onClick={() => remove(item.job.publicSlug)}
                >
                  {d.savedJobs.remove}
                </Button>
              </div>
            </CandidateCard>
          </li>
        );
      })}
    </ul>
  );
}

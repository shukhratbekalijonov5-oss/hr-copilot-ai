"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Badge, Chip } from "@/components/ui/Badge";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  AlertIcon,
  BriefcaseIcon,
  ExternalLinkIcon,
  MapPinIcon,
} from "@/components/ui/icons";
import { ExternalJobsTabs } from "@/components/external/ExternalJobsTabs";
import { ExternalListPager } from "@/components/external/ExternalListPager";
import { ExternalSaveButton } from "@/components/external/ExternalSaveButton";
import { ExternalTrackingControl } from "@/components/external/ExternalTrackingControl";
import { useExternalPersonalState } from "@/lib/candidate/external-personal-state";
import { useI18n } from "@/lib/i18n/context";
import {
  externalEmploymentLabel,
  externalLocationSummary,
  externalProvenanceLines,
  externalRemoteScope,
  externalSalaryDisplay,
  externalSeniorityLabel,
  externalStatusNotice,
  externalStatusTone,
  externalWorkModeLabel,
} from "@/lib/candidate/external-job-presentation";
import { postedLabel } from "@/lib/candidate/posting-date";
import type { SavedExternalJob, SavedExternalJobPage } from "@/lib/types";

/**
 * The candidate's saved external jobs.
 *
 * ## A closed listing still appears, and says so
 *
 * The single most important behaviour here. Somebody who saved a role three
 * weeks ago and comes back to find it silently missing learns nothing and
 * suspects the product lost it. So a CLOSED, EXPIRED or UNAVAILABLE listing
 * keeps its row and wears the reason — three different words, because an
 * employer ending a role, a deadline passing, and every source going
 * unreadable are three different facts.
 *
 * ## Unsaving keeps the row until the next load
 *
 * Removing the card under the reader's cursor would throw keyboard focus back
 * to the body and make an accidental press unrecoverable. The row stays,
 * visibly not-saved, one press from being saved again; it is gone on the next
 * server render, which is the authoritative one.
 */
export function SavedExternalJobsView({
  page,
  failed,
  now,
}: {
  page: SavedExternalJobPage | null;
  failed: boolean;
  /**
   * The server's render instant. Passed in rather than read here, for the same
   * reason the search page passes `asOf`: reading the clock during render is
   * impure, and would give the server pass and the hydration pass different
   * answers across a midnight boundary.
   */
  now: number;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const personal = useExternalPersonalState();

  const saved = page?.saved ?? [];
  /** The LIST has rows even if THIS page does not — see the empty state. */
  const hasAnyRows = (page?.total ?? 0) > 0;

  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        <ExternalJobsTabs current="saved" />
        <Card>
          <EmptyState
            icon={<AlertIcon className="size-5" />}
            title={d.externalJobs.savedErrorTitle}
            description={d.externalJobs.savedErrorHint}
            action={
              <Button
                type="button"
                loading={pending}
                onClick={() => startTransition(() => router.refresh())}
              >
                {d.externalJobs.retry}
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ExternalJobsTabs current="saved" />

      {saved.length === 0 ? (
        <Card>
          <EmptyState
            /*
              An empty PAGE of a non-empty list is a different situation from
              an empty list, and saying "you have saved nothing" to somebody
              who has saved twenty-one things would be a lie. It happens from a
              hand-edited `?page=`, or from unsaving the last row of the last
              page — and without the pager below it would be a dead end.
            */
            title={
              hasAnyRows ? d.externalJobs.savedPageEmpty : d.externalJobs.savedEmpty
            }
            description={
              hasAnyRows
                ? d.externalJobs.savedPageEmptyHint
                : d.externalJobs.savedEmptyHint
            }
            action={
              hasAnyRows ? (
                <Link
                  href="/external-jobs/saved"
                  className={buttonStyles("secondary", "md")}
                >
                  {d.externalJobs.savedFirstPage}
                </Link>
              ) : (
                <Link
                  href="/external-jobs"
                  className={buttonStyles("primary", "md")}
                >
                  {d.externalJobs.browseExternal}
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {saved.map((job) => (
            <li key={job.externalJobId} className="min-w-0">
              <SavedExternalJobCard job={job} personal={personal} now={now} />
            </li>
          ))}
        </ul>
      )}

      {/*
        Outside the branch above: an out-of-range page still needs a way back,
        and that is exactly the case where the list is empty.
      */}
      {page ? (
        <ExternalListPager
          pathname="/external-jobs/saved"
          page={page.page}
          totalPages={page.totalPages}
        />
      ) : null}
    </div>
  );
}

function SavedExternalJobCard({
  job,
  personal,
  now,
}: {
  job: SavedExternalJob;
  personal: ReturnType<typeof useExternalPersonalState>;
  now: number;
}) {
  const { d, f, p, date } = useI18n();

  /*
   * Every row on THIS page is saved by construction — that is what put it in
   * the list — so the seed the store reads through to says so. Once the reader
   * unsaves, the store's own override wins and the control flips; the row
   * itself stays until the next server render.
   */
  const personalJob = { ...job, saved: true };

  const locations = externalLocationSummary(job, d);
  const remote = externalRemoteScope(job, d);
  const salary = externalSalaryDisplay(job.salary, d);
  const provenance = externalProvenanceLines(job.provenance, d, f);
  const statusNotice = externalStatusNotice(job.status, d);
  const statusTone = externalStatusTone(job.status);
  const posted = postedLabel(job.employerPostedAt, now, d, { p, date, f });
  const workMode = externalWorkModeLabel(job.workMode, d);
  const employment = externalEmploymentLabel(job.employmentType, d);
  const seniority = externalSeniorityLabel(job.seniorityLevel, d);

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/*
            The listing's own lifecycle, and never a stand-in for whatever the
            reader recorded about their application below.
          */}
          {statusNotice ? (
            <Badge tone={statusTone ?? "warning"} className="mb-1.5">
              {statusNotice}
            </Badge>
          ) : null}
          <h3 className="break-words text-[15.5px] font-semibold leading-snug tracking-tight text-ink">
            {job.title}
          </h3>
          <p className="mt-0.5 break-words text-[13px] text-ink-muted">
            {job.company}
          </p>
        </div>
        <ExternalSaveButton job={personalJob} personal={personal} />
      </div>

      <div className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
        <p className="flex min-w-0 items-start gap-1.5">
          <MapPinIcon className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">
            {locations.primary ?? d.externalJobs.locationUnknown}
            {locations.additional.length > 0 ? (
              <>
                {" · "}
                {locations.additional.join(" · ")}
                {locations.overflow > 0
                  ? ` ${p(d.externalJobs.moreLocations, locations.overflow)}`
                  : null}
              </>
            ) : null}
          </span>
        </p>

        {remote.kind === "REMOTE_STATED" ? (
          <p className="break-words">
            {f(d.externalJobs.remoteStated, {
              countries: remote.countries.join(", "),
            })}
          </p>
        ) : remote.kind === "REMOTE_UNSTATED" ? (
          <p className="break-words">{d.externalJobs.remoteUnstated}</p>
        ) : null}

        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {workMode && remote.kind === "NOT_REMOTE" ? (
            <span className="inline-flex items-center gap-1">
              <BriefcaseIcon className="size-3.5 shrink-0" />
              {workMode}
            </span>
          ) : null}
          {employment ? <span>{employment}</span> : null}
          {seniority ? <span>{seniority}</span> : null}
        </p>

        <p className={salary.unknown ? "text-ink-subtle" : "font-medium text-ink"}>
          {salary.original ?? d.externalJobs.salaryUnknown}
        </p>

        {posted ? <p className="text-ink-subtle">{posted}</p> : null}
        <p className="text-ink-subtle">
          {f(d.externalJobs.savedOn, { date: date(job.savedAt) })}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Still offered on a closed listing: the badge above already says
            what we last observed, and removing the link would make it
            impossible for a reader to go and check for themselves. The
            employer's page is the authority on whether the role is open.
          */}
          {job.applyUrl ? (
            <a
              href={job.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles("primary", "sm")}
            >
              {d.externalJobs.apply}
              <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only"> ({d.externalJobs.externalLink})</span>
            </a>
          ) : null}
        </div>
        {/*
          Independent of saving in both directions: a saved job may be
          untracked, and marking one applied never changes whether it is saved.
        */}
        <ExternalTrackingControl
          job={personalJob}
          personal={personal}
          layout="compact"
        />
      </div>

      {provenance.source || provenance.corroboration ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-[11.5px] text-ink-subtle">
          {provenance.source ? <span>{provenance.source}</span> : null}
          {provenance.applyVia ? <span>{provenance.applyVia}</span> : null}
          {provenance.corroboration ? (
            <Chip>{provenance.corroboration}</Chip>
          ) : null}
        </p>
      ) : null}
    </Card>
  );
}

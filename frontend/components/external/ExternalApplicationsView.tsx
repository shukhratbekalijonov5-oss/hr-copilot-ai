"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertIcon, ExternalLinkIcon, MapPinIcon } from "@/components/ui/icons";
import { ExternalJobsTabs } from "@/components/external/ExternalJobsTabs";
import { ExternalListPager } from "@/components/external/ExternalListPager";
import { ExternalTrackingControl } from "@/components/external/ExternalTrackingControl";
import { useExternalPersonalState } from "@/lib/candidate/external-personal-state";
import { useI18n } from "@/lib/i18n/context";
import {
  externalPlaceLabel,
  externalStatusNotice,
  externalStatusTone,
} from "@/lib/candidate/external-job-presentation";
import {
  EXTERNAL_APPLICATION_STATUSES,
  type ExternalApplicationStatus,
  type ExternalJobApplication,
  type ExternalJobApplicationPage,
} from "@/lib/types";

/**
 * "My external applications" — the candidate's own notes, and nothing else.
 *
 * ## Two statuses, never one
 *
 * Each row carries the LISTING's lifecycle and the READER's tracked status,
 * side by side and separately labelled. They are independent facts: an
 * employer can close a posting while the person who applied to it is midway
 * through interviews, and both statements are true at once. The listing's
 * lifecycle is never allowed to overwrite or downgrade what the reader
 * recorded — that would be this product editing somebody's account of their
 * own week.
 *
 * ## This product observed none of it
 *
 * The header says so in the reader's own language, and there is a link to the
 * internal history so nobody mistakes one list for the other. No row here is
 * visible to any recruiter, and none of them created an application inside HR
 * Copilot.
 */
export function ExternalApplicationsView({
  page,
  failed,
  status,
}: {
  page: ExternalJobApplicationPage | null;
  failed: boolean;
  /** The active status filter, from the URL. Undefined means "all". */
  status?: ExternalApplicationStatus;
}) {
  const { d } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const personal = useExternalPersonalState();

  const applications = page?.applications ?? [];
  /**
   * An empty PAGE of a non-empty list — from a hand-edited `?page=`, or from
   * removing the last tracker on the last page. Distinct from "you have
   * tracked nothing" and from "nothing matches this filter".
   */
  const beyondLastPage = applications.length === 0 && (page?.total ?? 0) > 0;

  if (failed) {
    return (
      <div className="flex flex-col gap-4">
        <ExternalJobsTabs current="applications" />
        <Card>
          <EmptyState
            icon={<AlertIcon className="size-5" />}
            title={d.externalApplications.errorTitle}
            description={d.externalApplications.errorHint}
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
      <ExternalJobsTabs current="applications" />

      {/*
        Whose list this is, and where the OTHER one lives. Two sentences, said
        once at the top rather than repeated on every row.
      */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
        <span>{d.externalApplications.managedByYou}</span>
        <span>{d.externalApplications.notInternal}</span>
        <Link
          href="/my-applications"
          className="font-medium text-brand-ink hover:text-brand"
        >
          {d.externalApplications.goToInternal}
        </Link>
      </p>

      {/*
        The status filter. Links, not a client-side select, so a narrowed list
        is a real address — shareable, refresh-proof, and correct with the back
        button. Paging preserves it; see ExternalListPager.
      */}
      <ExternalStatusFilter active={status} />

      {applications.length === 0 ? (
        <Card>
          <EmptyState
            /*
              Three different situations, three different sentences. "Nothing
              with this status" said to somebody sitting on page 2 of a
              one-page list would send them looking for a filter problem they
              do not have.
            */
            title={
              beyondLastPage
                ? d.externalJobs.savedPageEmpty
                : status
                  ? d.externalApplications.emptyForStatus
                  : d.externalApplications.empty
            }
            description={
              beyondLastPage
                ? d.externalJobs.savedPageEmptyHint
                : status
                  ? d.externalApplications.emptyForStatusHint
                  : d.externalApplications.emptyHint
            }
            action={
              beyondLastPage ? (
                <Link
                  href={
                    status
                      ? `/external-jobs/applications?status=${status}`
                      : "/external-jobs/applications"
                  }
                  className={buttonStyles("secondary", "md")}
                >
                  {d.externalJobs.savedFirstPage}
                </Link>
              ) : status ? (
                <Link
                  href="/external-jobs/applications"
                  className={buttonStyles("secondary", "md")}
                >
                  {d.externalApplications.clearStatusFilter}
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
        <ul className="flex flex-col gap-3">
          {applications.map((application) => (
            <li key={application.id} className="min-w-0">
              <ExternalApplicationRow
                application={application}
                personal={personal}
              />
            </li>
          ))}
        </ul>
      )}

      {/*
        Outside the branch above: an out-of-range page renders empty, and that
        is precisely when a reader needs a way back.
      */}
      {page ? (
        <ExternalListPager
          pathname="/external-jobs/applications"
          page={page.page}
          totalPages={page.totalPages}
          // Paging must not quietly widen a list the reader narrowed.
          params={{ status }}
        />
      ) : null}
    </div>
  );
}

/**
 * The status filter, as links.
 *
 * A row of links rather than a `<select>`: a narrowed list is a real address,
 * and `aria-current` carries which one is active for a screen reader. It
 * scrolls sideways on a narrow screen rather than wrapping into a block.
 */
function ExternalStatusFilter({
  active,
}: {
  active?: ExternalApplicationStatus;
}) {
  const { d } = useI18n();

  const entries: Array<{ value?: ExternalApplicationStatus; label: string }> = [
    { value: undefined, label: d.externalApplications.filterAll },
    ...EXTERNAL_APPLICATION_STATUSES.map((value) => ({
      value,
      label: d.externalApplications.status[value],
    })),
  ];

  return (
    <nav
      aria-label={d.externalApplications.statusLabel}
      className="flex w-full gap-1 overflow-x-auto pb-0.5"
    >
      {entries.map((entry) => {
        const href = entry.value
          ? `/external-jobs/applications?status=${entry.value}`
          : "/external-jobs/applications";
        const current = entry.value === active;
        return current ? (
          <span
            key={entry.label}
            aria-current="true"
            className="whitespace-nowrap rounded-full border border-brand-soft bg-brand-soft px-2.5 py-1 text-[12.5px] font-medium text-brand-ink"
          >
            {entry.label}
          </span>
        ) : (
          <Link
            key={entry.label}
            href={href}
            className="whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ExternalApplicationRow({
  application,
  personal,
}: {
  application: ExternalJobApplication;
  personal: ReturnType<typeof useExternalPersonalState>;
}) {
  const { d } = useI18n();

  /*
   * The listing may be gone from the catalogue entirely — `job` is null. The
   * tracker is NOT dropped with it: the candidate still applied, and their own
   * record is the thing this list exists to keep. The row then shows the
   * tracker's facts and says plainly that the listing is unavailable.
   */
  const job = application.job;
  const listingStatus = job?.status ?? "UNAVAILABLE";
  const listingNotice = externalStatusNotice(listingStatus, d);
  const listingTone = externalStatusTone(listingStatus);
  const place = job ? externalPlaceLabel(job.location, d) : null;

  /*
   * The shape the shared store speaks: this row IS the tracking record, and
   * `saved` is carried through untouched so removing a tracker from here can
   * never quietly unsave the job.
   */
  const personalJob = {
    externalJobId: application.externalJobId,
    saved: job?.saved ?? false,
    tracking: {
      id: application.id,
      status: application.status,
      appliedAt: application.appliedAt,
      note: application.note,
      updatedAt: application.updatedAt,
    },
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[15px] font-semibold leading-snug tracking-tight text-ink">
            {job?.title ?? d.externalApplications.listingGoneTitle}
          </h3>
          <p className="mt-0.5 break-words text-[13px] text-ink-muted">
            {job?.company ?? d.externalApplications.listingGoneHint}
          </p>
          {place ? (
            <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[12.5px] text-ink-muted">
              <MapPinIcon className="mt-px size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{place}</span>
            </p>
          ) : null}
        </div>

        {/*
          The LISTING's state, explicitly labelled as such and visually apart
          from the tracking control below. A closed posting says "Listing
          closed" — it never rewrites the reader's own "Interview".
        */}
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <span className="text-[11px] uppercase tracking-wide text-ink-subtle">
            {d.externalApplications.listingStatusLabel}
          </span>
          <Badge tone={listingTone ?? "positive"}>
            {listingNotice ?? d.externalApplications.listingActive}
          </Badge>
        </div>
      </div>

      <div className="border-t border-line pt-3">
        <ExternalTrackingControl job={personalJob} personal={personal} />
      </div>

      {job?.applyUrl ? (
        <div>
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonStyles("secondary", "sm")}
          >
            {d.externalApplications.openOriginal}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only"> ({d.externalJobs.externalLink})</span>
          </a>
        </div>
      ) : null}
    </Card>
  );
}

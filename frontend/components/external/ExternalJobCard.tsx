"use client";

import { Badge, Chip } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import {
  BriefcaseIcon,
  ExternalLinkIcon,
  MapPinIcon,
} from "@/components/ui/icons";
import { ExternalSaveButton } from "@/components/external/ExternalSaveButton";
import { ExternalTrackingControl } from "@/components/external/ExternalTrackingControl";
import { useI18n } from "@/lib/i18n/context";
import type { ExternalPersonalStateApi } from "@/lib/candidate/external-personal-state";
import {
  externalBandLabel,
  externalEmploymentLabel,
  externalLocationSummary,
  externalProvenanceLines,
  externalReasonLines,
  externalRemoteScope,
  externalSalaryDisplay,
  externalSeniorityLabel,
  externalStatusNotice,
  externalWorkModeLabel,
} from "@/lib/candidate/external-job-presentation";
import { postedLabel } from "@/lib/candidate/posting-date";
import type { ExternalJobResult } from "@/lib/types";

/**
 * One external job, scannable.
 *
 * ## Reading order is the design
 *
 * Title, company, where and how, pay, then why it ranked, then the action, and
 * provenance last and smallest. Somebody scanning fifty of these is asking
 * "what is this job and would I want it" — the fact that it reached us through
 * one ATS rather than another answers neither question, and putting it near
 * the top would trade the reader's attention for our own plumbing.
 *
 * ## Nothing on this card is computed here
 *
 * Score, band and reasons come from the backend; the location, remote,
 * salary and provenance wording comes from tested pure functions. This
 * component only decides where things sit. That split is what makes the honesty
 * rules — remote is not worldwide, an unposted salary is not zero, a score is
 * not a probability — testable without a browser.
 */
export function ExternalJobCard({
  job,
  onOpen,
  now,
  personal,
}: {
  job: ExternalJobResult;
  /** Opens the detail panel. The card stays a summary. */
  onOpen: (job: ExternalJobResult) => void;
  /** The server's render time, so relative ages cannot drift on hydration. */
  now: number;
  /**
   * The one store the panel reads too, so a job saved in either place is
   * saved in both without a second copy of the truth.
   */
  personal: ExternalPersonalStateApi;
}) {
  const { d, f, p, n, date } = useI18n();

  const locations = externalLocationSummary(job, d);
  const remote = externalRemoteScope(job, d);
  const salary = externalSalaryDisplay(job.salary, d);
  const reasons = externalReasonLines(job.reasons, d);
  const provenance = externalProvenanceLines(job.provenance, d, f);
  const statusNotice = externalStatusNotice(job.status, d);
  const band = externalBandLabel(job.band, d);

  const posted = postedLabel(job.employerPostedAt, now, d, { p, date, f });
  const workMode = externalWorkModeLabel(job.workMode, d);
  const employment = externalEmploymentLabel(job.employmentType, d);
  const seniority = externalSeniorityLabel(job.seniorityLevel, d);

  return (
    <Card className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {statusNotice ? (
            <Badge tone="warning" className="mb-1.5">
              {statusNotice}
            </Badge>
          ) : null}
          <h3 className="text-[15.5px] font-semibold leading-snug tracking-tight text-ink">
            {/*
              The title opens the detail panel rather than the employer's site.
              Sending someone off the product on a title click would make
              "read more" and "apply" the same gesture, and they are not.
            */}
            <button
              type="button"
              onClick={() => onOpen(job)}
              className="break-words text-left hover:text-brand"
            >
              {job.title}
            </button>
          </h3>
          <p className="mt-0.5 break-words text-[13px] text-ink-muted">
            {job.company}
          </p>
        </div>

        {/*
          The score, small and beside the role rather than across it.

          Deliberately a number and a word — not a progress bar, not a ring,
          not a percentage with a "%". A filled bar reads as "how likely you
          are to get this", which this number is emphatically not, and the
          band is what carries the meaning for anyone who does not want to
          interpret an integer.
        */}
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right">
            <p
              className="text-[19px] font-semibold leading-none tabular-nums text-ink"
              aria-label={f(d.externalJobs.scoreValue, { score: job.score })}
            >
              {n(job.score)}
            </p>
            {band ? (
              <p className="mt-1 text-[11px] leading-tight text-ink-muted">
                {band}
              </p>
            ) : null}
          </div>
          {/*
            Quiet, and beside the score rather than under the title: saving is
            a bookmark, and the loudest thing on an external card should stay
            the job itself.
          */}
          <ExternalSaveButton job={job} personal={personal} />
        </div>
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

        {/*
          Remote geography, stated only when the employer stated it.

          REMOTE with no country list is written as "countries not stated" —
          never as worldwide. Someone who reads "worldwide" and spends an hour
          on an application they were never eligible for has been misled by
          this product, not by the employer.
        */}
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

        {/*
          The employer's own figure, in the employer's own money, never
          converted here. An unposted salary says so rather than showing a
          zero or an empty money-shaped slot.
        */}
        <p className={salary.unknown ? "text-ink-subtle" : "font-medium text-ink"}>
          {salary.original ?? d.externalJobs.salaryUnknown}
        </p>

        {/*
          When the EMPLOYER published — not when we first saw it.

          Absent for the half of the catalogue whose provider states no
          publication date, and absent is rendered as nothing at all: no
          "Recently posted", no epoch, no crawl date wearing a posting date's
          clothes. This line is also distinct from the STALE badge above,
          which is about our own re-verification and can coexist with it.
        */}
        {posted ? <p className="text-ink-subtle">{posted}</p> : null}
      </div>

      {reasons.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {reasons.map((reason) => (
            <li key={reason.code}>
              <Badge
                tone={
                  reason.tone === "positive"
                    ? "positive"
                    : reason.tone === "negative"
                      ? "warning"
                      : "neutral"
                }
              >
                {reason.text}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {job.applyUrl ? (
          <a
            href={job.applyUrl}
            target="_blank"
            /*
             * `noopener` denies the opened page a handle on this one — without
             * it, the employer's site can navigate the tab a candidate came
             * from. `noreferrer` keeps our URL, including their search terms,
             * out of the employer's referrer logs.
             */
            rel="noopener noreferrer"
            className={buttonStyles("primary", "sm")}
          >
            {d.externalJobs.apply}
            <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only"> ({d.externalJobs.externalLink})</span>
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(job)}
          className={buttonStyles("secondary", "sm")}
        >
          {d.externalJobs.viewDetails}
        </button>
        {/*
          Deliberately AFTER the Apply link and a separate control from it.
          Opening the employer's site is navigation; saying you applied is a
          claim about what you did there, and only the reader can make it.
        */}
        <ExternalTrackingControl
          job={job}
          personal={personal}
          layout="compact"
        />
      </div>

      {/*
        Provenance: last, smallest, and never a quality claim. It answers
        "who published this", which is a trust question, and nothing else.
      */}
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

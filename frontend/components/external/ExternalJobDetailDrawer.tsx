"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Chip } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { SkeletonText } from "@/components/ui/LoadingSkeleton";
import { CloseIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { ExternalSaveButton } from "@/components/external/ExternalSaveButton";
import { ExternalTrackingControl } from "@/components/external/ExternalTrackingControl";
import { ExternalWhyMatch } from "@/components/external/ExternalWhyMatch";
import { useI18n } from "@/lib/i18n/context";
import type { ExternalPersonalStateApi } from "@/lib/candidate/external-personal-state";
import { getExternalJobAction } from "@/app/(candidate)/external-jobs/actions";
import {
  createLatestRequestGate,
  runLatest,
} from "@/lib/candidate/latest-request";
import {
  externalBandLabel,
  externalDescriptionParagraphs,
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
import { languageLabel } from "@/lib/vacancy/job-profile";
import { postedLabel } from "@/lib/candidate/posting-date";
import type { ExternalJobDetail, ExternalJobResult } from "@/lib/types";

/**
 * One job, opened.
 *
 * ## Why a panel and not a page
 *
 * Reading a job description is a detour from scanning a list, and a reader who
 * opens four in a row should return to the same list in the same place each
 * time. A route would re-run the search on every back-navigation; a panel
 * keeps the ranked page exactly as it was.
 *
 * ## Two sources, deliberately
 *
 * The ranking half — score, band, reasons — comes from the search result the
 * card already holds, because that is the only thing that knows who asked. The
 * description and the rest of the stated facts are fetched, because a
 * description is up to twenty thousand characters and putting twenty of them
 * in every search response would cost a hundredfold payload to render text
 * nobody has asked to read.
 *
 * ## The race this closes
 *
 * Open job A, then B a moment later. Two reads are in flight and the slower
 * one may land last. Without a guard the panel would show A's description
 * under B's title — silently, with nothing logged and no way for the reader to
 * notice. `runLatest` discards any answer that is no longer the one being
 * waited for.
 */
export function ExternalJobDetailDrawer({
  job,
  onClose,
  now,
  personal,
}: {
  /** The ranked result behind this panel, or null when nothing is open. */
  job: ExternalJobResult | null;
  onClose: () => void;
  /** The server's render time, so relative ages cannot drift on hydration. */
  now: number;
  /**
   * The SAME store the card behind this panel reads. Saving here updates that
   * card, because there is one value and not two — a panel with its own copy
   * would leave the card underneath contradicting it the moment this closes.
   */
  personal: ExternalPersonalStateApi;
}) {
  const { d, f, p, n, date } = useI18n();

  /*
   * One entry, tagged with the job it belongs to.
   *
   * Tagging rather than clearing on open is what keeps every `setState` inside
   * an async continuation: an effect that synchronously resets state causes a
   * second render before the first has painted, and React lints it for good
   * reason. Reading "is this entry for the job on screen" costs nothing and
   * gives a reopened job its description instantly.
   */
  const [entry, setEntry] = useState<{
    jobId: string;
    detail: ExternalJobDetail | null;
    state: "error" | "gone" | "ready";
  } | null>(null);
  const gate = useRef(createLatestRequestGate());
  const closeRef = useRef<HTMLButtonElement>(null);

  const current = entry && job && entry.jobId === job.externalJobId ? entry : null;
  const detail = current?.detail ?? null;
  const state = current?.state ?? "loading";

  useEffect(() => {
    if (!job) {
      // Nothing is open, so nothing in flight is worth showing any more.
      gate.current.cancel();
      return;
    }

    const jobId = job.externalJobId;
    void runLatest(gate.current, () => getExternalJobAction(jobId)).then(
      (outcome) => {
        // A superseded read is dropped in silence: nobody is waiting for it,
        // and surfacing its failure would flash an error over the job they
        // DID open.
        if (outcome.stale) return;
        if (!outcome.ok) {
          setEntry({ jobId, detail: null, state: "error" });
          return;
        }
        const result = outcome.value;
        if (!result.ok) {
          // "gone" means the listing left the universe between the search and
          // the click. That is a real answer, and a different one from a
          // failure.
          setEntry({
            jobId,
            detail: null,
            state: result.reason === "gone" ? "gone" : "error",
          });
          return;
        }
        setEntry({ jobId, detail: result.data, state: "ready" });
      },
    );
  }, [job]);

  // Escape closes, and focus moves into the panel so a keyboard reader is not
  // left behind on the card underneath.
  useEffect(() => {
    if (!job) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job, onClose]);

  if (!job) return null;

  const locations = externalLocationSummary(detail ?? job, d, 8);
  const remote = externalRemoteScope(detail ?? job, d);
  const salary = externalSalaryDisplay((detail ?? job).salary, d);
  const reasons = externalReasonLines(job.reasons, d, 6);
  const provenance = externalProvenanceLines(
    (detail ?? job).provenance,
    d,
    f,
  );
  const statusNotice = externalStatusNotice((detail ?? job).status, d);
  const band = externalBandLabel(job.band, d);
  const paragraphs = externalDescriptionParagraphs(detail?.description ?? null);
  /*
   * The detail read carries the same canonical field, so this is the same fact
   * the card showed — not a second timestamp derived from a different source.
   * Falls back to the search result while the read is in flight.
   */
  const posted = postedLabel(
    detail?.employerPostedAt ?? job.employerPostedAt,
    now,
    d,
    { p, date, f },
  );
  const applyUrl = detail?.applyUrl ?? job.applyUrl;

  const facts: { label: string; value: string }[] = [];
  const workMode = externalWorkModeLabel((detail ?? job).workMode, d);
  if (workMode) facts.push({ label: d.externalJobs.workModeLabel, value: workMode });
  const employment = externalEmploymentLabel((detail ?? job).employmentType, d);
  if (employment) {
    facts.push({ label: d.externalJobs.employmentLabel, value: employment });
  }
  const seniority = externalSeniorityLabel((detail ?? job).seniorityLevel, d);
  if (seniority) {
    facts.push({ label: d.externalJobs.seniorityLabel, value: seniority });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={d.externalJobs.close}
        onClick={onClose}
        className="absolute inset-0 bg-ink/25"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.externalJobs.detailsTitle}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-line bg-surface shadow-card"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-snug tracking-tight text-ink">
              {job.title}
            </h2>
            <p className="mt-0.5 break-words text-[13px] text-ink-muted">
              {job.company}
            </p>
          </div>
          {/*
            Reads and writes the same entry the card does, so the two can never
            show different answers to "have I saved this".
          */}
          <ExternalSaveButton
            job={job}
            personal={personal}
            className="ml-auto"
          />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={d.externalJobs.close}
            className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          {statusNotice ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
              {statusNotice}
              {(detail ?? job).status === "STALE" ? (
                <span className="mt-0.5 block text-ink-muted">
                  {d.externalJobs.staleHint}
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-muted">
              {d.externalJobs.scoreLabel}
            </span>
            <span className="text-[15px] font-semibold tabular-nums text-ink">
              {f(d.externalJobs.scoreValue, { score: n(job.score) })}
            </span>
            {band ? <Badge tone="brand">{band}</Badge> : null}
          </div>
          {/*
            Said in words, next to the number, every time it is shown large:
            this measures the search, not the reader's chances. A score with no
            such sentence is read as a prediction, because that is what scores
            beside jobs usually are elsewhere.
          */}
          <p className="-mt-2 text-[12px] text-ink-subtle">
            {d.externalJobs.scoreNote}
          </p>

          {reasons.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-semibold text-ink">
                {d.externalJobs.whyThis}
              </h3>
              <ul className="flex flex-col gap-1">
                {reasons.map((reason) => (
                  <li
                    key={reason.code}
                    className="flex items-start gap-2 text-[13px] text-ink-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={
                        reason.tone === "positive"
                          ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-positive"
                          : reason.tone === "negative"
                            ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-warning"
                            : "mt-1.5 size-1.5 shrink-0 rounded-full bg-line-strong"
                      }
                    />
                    <span className="break-words">{reason.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/*
            The generated explanation sits AFTER the deterministic reasons and
            below the score, never above them.

            The score and the reason chips are what this product computed and
            can stand behind; the panel below is a language model's account of
            them. Putting the fluent text first would make the computed facts
            look like supporting detail for the prose, when the relationship
            runs precisely the other way.

            It renders for every reader who can see this drawer — which is a
            MAX reader, because the whole external product is MAX-gated. The
            panel still handles a plan refusal, because the backend is the
            authority and a plan can lapse between opening a page and pressing
            a button.
          */}
          <ExternalWhyMatch externalJobId={job.externalJobId} />

          <section className="flex flex-col gap-1.5 border-t border-line pt-4 text-[13px]">
            <p className="text-ink">
              {locations.primary ?? d.externalJobs.locationUnknown}
            </p>
            {locations.additional.length > 0 ? (
              <p className="text-ink-muted">
                <span className="text-ink-subtle">
                  {d.externalJobs.alsoOpenIn}:{" "}
                </span>
                {locations.additional.join(" · ")}
                {locations.overflow > 0
                  ? ` ${p(d.externalJobs.moreLocations, locations.overflow)}`
                  : null}
              </p>
            ) : null}
            {remote.kind === "REMOTE_STATED" ? (
              <p className="text-ink-muted">
                {f(d.externalJobs.remoteStated, {
                  countries: remote.countries.join(", "),
                })}
              </p>
            ) : remote.kind === "REMOTE_UNSTATED" ? (
              <p className="text-ink-muted">
                {d.externalJobs.remoteUnstated}
                <span className="mt-0.5 block text-[12px] text-ink-subtle">
                  {d.externalJobs.remoteUnstatedHint}
                </span>
              </p>
            ) : null}

            <p className={salary.unknown ? "text-ink-subtle" : "font-medium text-ink"}>
              {salary.original ?? d.externalJobs.salaryUnknown}
              {salary.original ? (
                <span className="ml-2 text-[12px] font-normal text-ink-subtle">
                  {d.externalJobs.salaryNote}
                </span>
              ) : null}
            </p>

            {posted ? <p className="text-ink-muted">{posted}</p> : null}

            {facts.length > 0 ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                {facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-ink-subtle">{fact.label}</dt>
                    <dd className="text-ink-muted">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="text-[13px] font-semibold text-ink">
              {d.externalJobs.aboutRole}
            </h3>
            {state === "loading" ? (
              <>
                <p className="sr-only" role="status">
                  {d.externalJobs.loadingDetail}
                </p>
                <SkeletonText lines={5} />
              </>
            ) : state === "gone" ? (
              <p className="text-[13px] text-warning">
                {d.externalJobs.detailGone}
              </p>
            ) : state === "error" ? (
              <p className="text-[13px] text-critical" role="alert">
                {d.externalJobs.detailError}
              </p>
            ) : paragraphs.length > 0 ? (
              /*
               * Plain text, split into paragraphs. Never
               * `dangerouslySetInnerHTML`: the backend sanitizes provider HTML
               * at ingestion, and this renderer stays plain so that the day a
               * provider changes shape the reader sees stray characters rather
               * than whatever that provider decided to send.
               */
              <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink-muted">
                {paragraphs.map((paragraph, index) => (
                  <p key={index} className="whitespace-pre-line break-words">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-subtle">
                {d.externalJobs.noDescription}
              </p>
            )}

            {detail?.requirementsText ? (
              <>
                <h3 className="mt-2 text-[13px] font-semibold text-ink">
                  {d.externalJobs.requirements}
                </h3>
                <p className="whitespace-pre-line break-words text-[13.5px] leading-relaxed text-ink-muted">
                  {detail.requirementsText}
                </p>
              </>
            ) : null}
          </section>

          {detail && detail.skills.length > 0 ? (
            <section className="flex flex-col gap-1.5 border-t border-line pt-4">
              <h3 className="text-[13px] font-semibold text-ink">
                {d.externalJobs.skills}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.skills.map((skill) => (
                  <Chip key={skill}>{skill}</Chip>
                ))}
              </div>
            </section>
          ) : null}

          {detail && detail.languageCodes.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-[13px] font-semibold text-ink">
                {d.externalJobs.languages}
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {detail.languageCodes.map((code) => (
                  <Chip key={code}>{languageLabel(code, d)}</Chip>
                ))}
              </div>
            </section>
          ) : null}

          {provenance.source || provenance.corroboration ? (
            <section className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4 text-[12px] text-ink-subtle">
              {provenance.source ? <span>{provenance.source}</span> : null}
              {provenance.applyVia ? <span>{provenance.applyVia}</span> : null}
              {provenance.corroboration ? (
                <span>{provenance.corroboration}</span>
              ) : null}
              {detail?.companyWebsiteUrl ? (
                <a
                  href={detail.companyWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-ink hover:text-brand"
                >
                  {d.externalJobs.companySite}
                </a>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="sticky bottom-0 mt-auto flex flex-col gap-2.5 border-t border-line bg-surface px-4 py-3">
          {applyUrl ? (
            <>
              <a
                href={applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonStyles("primary", "md", "w-full")}
              >
                {d.externalJobs.apply}
                <ExternalLinkIcon className="size-4" aria-hidden="true" />
                <span className="sr-only"> ({d.externalJobs.externalLink})</span>
              </a>
              {/*
                Said before they leave, not after: this product does not receive
                the application and cannot tell them what happened to it. A
                candidate who believes otherwise will wait here for a reply that
                was never coming.
              */}
              <p className="text-[11.5px] leading-relaxed text-ink-subtle">
                {d.externalJobs.applyHint}
              </p>
            </>
          ) : null}

          {/*
            Tracking, BELOW the apply link and separated from it.

            The link above has no click handler at all — it is an anchor, and
            it stays one. This control is the only thing that records an
            application, and it records it because the reader pressed it after
            actually applying. Anything else would put jobs in their history
            that they merely looked at.
          */}
          <div className="border-t border-line pt-2.5">
            <ExternalTrackingControl job={job} personal={personal} />
          </div>
        </div>
      </div>
    </div>
  );
}

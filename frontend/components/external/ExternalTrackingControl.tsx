"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { CheckIcon, TrashIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  externalApplicationStatusOptions,
  externalApplicationTone,
} from "@/lib/candidate/external-tracking";
import type { ExternalPersonalStateApi } from "@/lib/candidate/external-personal-state";
import type {
  ExternalApplicationStatus,
  ExternalJobTracking,
} from "@/lib/types";

/**
 * The candidate's own record of an application they made elsewhere.
 *
 * ## Opening the employer's site is not applying
 *
 * There is no code path from the Apply link to this component. Apply is an
 * `<a>` that navigates; this is a separate, deliberate button. A product that
 * marked people as applied for clicking a link would fill their history with
 * applications they abandoned on the employer's first form — and they would
 * find out only by being asked about a job they never applied for.
 *
 * ## It never claims to have observed anything
 *
 * The hint under the control says, in the reader's language, that they keep
 * this themselves. No status here is styled as a verdict, none of it is
 * visible to any recruiter, and none of it creates an internal application.
 *
 * ## Any status may follow any other
 *
 * The select offers the whole vocabulary, always. External processes restart,
 * skip stages, and end months later; a linear machine would be this product
 * telling somebody their own history is impossible.
 */
export function ExternalTrackingControl({
  job,
  personal,
  /** Compact on cards (chip + one action); full on detail and list rows. */
  layout = "full",
  showNote = true,
}: {
  job: {
    externalJobId: string;
    saved: boolean;
    tracking: ExternalJobTracking | null;
  };
  personal: ExternalPersonalStateApi;
  layout?: "compact" | "full";
  showNote?: boolean;
}) {
  const { d, f, date } = useI18n();

  const state = personal.stateFor(job);
  const tracking = state.tracking;
  const busy = personal.isBusy(job.externalJobId);
  const error = personal.errorFor(job.externalJobId);

  if (!tracking) {
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => personal.markApplied(job.externalJobId, state)}
          icon={<CheckIcon className="size-4" />}
        >
          {busy ? d.externalApplications.marking : d.externalApplications.markApplied}
        </Button>
        {layout === "full" ? (
          <p className="text-[11.5px] leading-relaxed text-ink-subtle">
            {d.externalApplications.markAppliedHint}
          </p>
        ) : null}
        {error === "track" ? (
          <p role="status" className="text-[11.5px] text-critical">
            {d.externalApplications.markFailed}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {layout === "compact" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={externalApplicationTone(tracking.status)}>
            {d.externalApplications.status[tracking.status]}
          </Badge>
          <span className="text-[11.5px] text-ink-subtle">
            {f(d.externalApplications.appliedOn, {
              date: date(tracking.appliedAt),
            })}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={d.externalApplications.statusLabel}
            value={tracking.status}
            disabled={busy}
            options={externalApplicationStatusOptions(d)}
            onChange={(event) =>
              personal.setStatus(
                job.externalJobId,
                state,
                event.target.value as ExternalApplicationStatus,
              )
            }
            className="w-44"
          />
          <div className="flex flex-col gap-1 pb-0.5">
            <span className="text-[11.5px] text-ink-subtle">
              {f(d.externalApplications.appliedOn, {
                date: date(tracking.appliedAt),
              })}
            </span>
          </div>
        </div>
      )}

      {layout === "full" ? (
        <>
          {showNote ? (
            <TrackingNote job={job} personal={personal} tracking={tracking} />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => personal.removeTracking(job.externalJobId, state)}
              icon={<TrashIcon className="size-4" />}
            >
              {d.externalApplications.removeTracking}
            </Button>
            {/*
              Said next to the control, not after the fact: somebody removing a
              tracker must not believe they are withdrawing an application from
              an employer this product cannot reach.
            */}
            <span className="text-[11.5px] leading-relaxed text-ink-subtle">
              {d.externalApplications.removeTrackingHint}
            </span>
          </div>
        </>
      ) : null}

      {error === "update" || error === "remove" ? (
        <p role="status" className="text-[11.5px] text-critical">
          {error === "update"
            ? d.externalApplications.updateFailed
            : d.externalApplications.removeFailed}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The candidate's own reminder against one application.
 *
 * A textarea and one Save button — not an autosaving rich editor. This is a
 * line like "technical interview on the 4th"; anything more would be a CRM
 * nobody asked this product to be. It only submits when the text actually
 * changed, so a stray focus does not spend a request.
 */
function TrackingNote({
  job,
  personal,
  tracking,
}: {
  job: {
    externalJobId: string;
    saved: boolean;
    tracking: ExternalJobTracking | null;
  };
  personal: ExternalPersonalStateApi;
  tracking: ExternalJobTracking;
}) {
  const { d } = useI18n();
  const stored = tracking.note ?? "";
  const [draft, setDraft] = useState(stored);
  /*
   * The backend's value wins whenever it changes underneath — after a
   * successful save, or when a fresh server render lands.
   *
   * Adjusted DURING render rather than in an effect: an effect would paint the
   * stale draft first and then correct it, and React lints it for that reason.
   * Comparing against the last value seen means a reader's own typing is never
   * clobbered — only a genuine change from the server resets the box.
   */
  const [lastStored, setLastStored] = useState(stored);
  if (lastStored !== stored) {
    setLastStored(stored);
    setDraft(stored);
  }
  const busy = personal.isBusy(job.externalJobId);

  const trimmed = draft.trim();
  const dirty = trimmed !== stored;

  const noteId = `external-note-${job.externalJobId}`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={noteId} className="text-[12px] font-medium text-ink-muted">
        {d.externalApplications.note}
      </label>
      <textarea
        id={noteId}
        rows={2}
        value={draft}
        disabled={busy}
        placeholder={d.externalApplications.notePlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-60"
      />
      {dirty ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() =>
              personal.setNote(
                job.externalJobId,
                personal.stateFor(job),
                trimmed.length > 0 ? trimmed : null,
              )
            }
          >
            {d.externalApplications.saveNote}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

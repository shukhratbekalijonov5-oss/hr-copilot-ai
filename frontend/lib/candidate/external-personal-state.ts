"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  removeExternalApplicationAction,
  setExternalJobSavedAction,
  trackExternalApplicationAction,
  updateExternalApplicationAction,
} from "@/app/(candidate)/external-jobs/actions";
import {
  applyRemoveTrackingResult,
  applySaveResult,
  applyTrackingResult,
  optimisticSave,
  shouldSubmitStatusChange,
} from "@/lib/candidate/external-personal-transitions";
import type {
  ExternalApplicationStatus,
  ExternalJobPersonalState,
  ExternalJobTracking,
} from "@/lib/types";

/**
 * "What is true for ME about this job" — in one place, for the whole screen.
 *
 * ## Why one store and not two
 *
 * A job appears twice at once: as a card in the list and as the panel opened
 * over it. If each held its own saved flag, saving from the panel would leave
 * the card behind it still reading "Save job" — and the reader would have no
 * way to tell which one was lying. So both read the same map, keyed by job id,
 * and a mutation is written once.
 *
 * The map is an OVERLAY, not a copy of the list. It starts empty and holds
 * only jobs the reader has actually touched; everything else reads through to
 * the server-rendered value. That is what makes a re-render from the server —
 * a new search, a refresh — authoritative again without any cache to
 * invalidate: fresh props simply win for every job nobody has touched since.
 *
 * ## What is optimistic and what is not
 *
 * Saving is, because it is one boolean whose previous value we hold: if the
 * request fails we put back exactly what was there, and the reader sees a
 * control that never settled on a lie.
 *
 * Tracking is NOT. Creating a record mints a server-assigned id, and the
 * status a reader picks is a claim about their own hiring process. Inventing a
 * placeholder id would mean a follow-up edit addressed to a record that does
 * not exist, and showing "Applied" before the write landed would mean somebody
 * closing the tab believing their application was recorded when it was not.
 * These wait for the backend, with a pending state while they do.
 *
 * ## Duplicate requests
 *
 * One in-flight mutation per job. A second press while one is running is
 * dropped rather than queued — a queued toggle would land in whichever order
 * the network chose, and the final state would be a coin flip.
 */

export type ExternalMutationError =
  | "save"
  | "unsave"
  | "track"
  | "update"
  | "remove";

export interface ExternalPersonalStateApi {
  /** Server value, unless this reader has changed it since. */
  stateFor: (
    job: { externalJobId: string; saved: boolean; tracking: ExternalJobTracking | null },
  ) => ExternalJobPersonalState;
  /** True while a mutation for this job is in flight. */
  isBusy: (externalJobId: string) => boolean;
  /** The last failure for this job, or null. Cleared when the next one starts. */
  errorFor: (externalJobId: string) => ExternalMutationError | null;
  toggleSaved: (
    job: { externalJobId: string; saved: boolean; tracking: ExternalJobTracking | null },
  ) => void;
  markApplied: (externalJobId: string, current: ExternalJobPersonalState) => void;
  setStatus: (
    externalJobId: string,
    current: ExternalJobPersonalState,
    status: ExternalApplicationStatus,
  ) => void;
  setNote: (
    externalJobId: string,
    current: ExternalJobPersonalState,
    note: string | null,
  ) => void;
  removeTracking: (externalJobId: string, current: ExternalJobPersonalState) => void;
}

export function useExternalPersonalState(): ExternalPersonalStateApi {
  const [overrides, setOverrides] = useState<
    ReadonlyMap<string, ExternalJobPersonalState>
  >(() => new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<
    ReadonlyMap<string, ExternalMutationError>
  >(() => new Map());

  const write = useCallback((id: string, next: ExternalJobPersonalState) => {
    setOverrides((current) => new Map(current).set(id, next));
  }, []);

  /**
   * The duplicate-request guard, in a ref rather than in state.
   *
   * State updaters do not run at call time — React defers them to the next
   * render — so a second press in the same tick would read a `busy` set that
   * still looks empty and fire a second request. The ref is written
   * synchronously, which is the only thing that actually closes that window.
   * `busy` state exists alongside it purely so the button can re-render as
   * pending.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const begin = useCallback((id: string): boolean => {
    if (inFlight.current.has(id)) return false;
    inFlight.current.add(id);
    setBusy((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    return true;
  }, []);

  const end = useCallback((id: string, error: ExternalMutationError | null) => {
    inFlight.current.delete(id);
    setBusy((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setErrors((current) => {
      const next = new Map(current);
      if (error) next.set(id, error);
      else next.delete(id);
      return next;
    });
  }, []);

  return useMemo<ExternalPersonalStateApi>(() => {
    /** Guard + error reset shared by every mutation below. */
    const start = (id: string): boolean => {
      if (!begin(id)) return false;
      setErrors((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      return true;
    };

    const stateFor: ExternalPersonalStateApi["stateFor"] = (job) =>
      overrides.get(job.externalJobId) ?? {
        saved: job.saved,
        tracking: job.tracking,
      };

    return {
      stateFor,
      isBusy: (id) => busy.has(id),
      errorFor: (id) => errors.get(id) ?? null,

      toggleSaved: (job) => {
        const id = job.externalJobId;
        const before = stateFor(job);
        const next = !before.saved;
        if (!start(id)) return;

        // Optimistic: one boolean, and `before` is the exact value to restore.
        write(id, optimisticSave(before));
        void setExternalJobSavedAction(id, next).then((result) => {
          // The transition rules — server-wins, exact rollback, tracking left
          // alone — live in one tested place, not in this callback.
          write(id, applySaveResult(before, result));
          end(id, result.ok ? null : next ? "save" : "unsave");
        });
      },

      markApplied: (id, current) => {
        // Never called from the Apply link's own handler. Opening an
        // employer's site is navigation; this is the reader asserting they
        // applied, and only they can assert it.
        if (current.tracking) return;
        if (!start(id)) return;

        void trackExternalApplicationAction(id, { status: "APPLIED" }).then(
          (result) => {
            // Saving is untouched by this: see applyTrackingResult.
            write(id, applyTrackingResult(current, result));
            end(id, result.ok && result.tracking ? null : "track");
          },
        );
      },

      setStatus: (id, current, status) => {
        if (!shouldSubmitStatusChange(current, status)) return;
        const tracking = current.tracking;
        if (!tracking) return;
        if (!start(id)) return;

        void updateExternalApplicationAction(tracking.id, { status }).then(
          (result) => {
            // No optimistic write to undo on failure: the select re-reads
            // `current`, which still holds the status the backend still has.
            write(id, applyTrackingResult(current, result));
            end(id, result.ok && result.tracking ? null : "update");
          },
        );
      },

      setNote: (id, current, note) => {
        const tracking = current.tracking;
        if (!tracking) return;
        if (!start(id)) return;

        void updateExternalApplicationAction(tracking.id, { note }).then(
          (result) => {
            write(id, applyTrackingResult(current, result));
            end(id, result.ok && result.tracking ? null : "update");
          },
        );
      },

      removeTracking: (id, current) => {
        const tracking = current.tracking;
        if (!tracking) return;
        if (!start(id)) return;

        void removeExternalApplicationAction(tracking.id).then((result) => {
          // Only the tracking record; `saved` is carried across untouched.
          write(id, applyRemoveTrackingResult(current, result));
          end(id, result.ok ? null : "remove");
        });
      },
    };
  }, [overrides, busy, errors, begin, end, write]);
}

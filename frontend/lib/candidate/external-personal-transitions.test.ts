import { describe, expect, it } from "vitest";
import {
  applyRemoveTrackingResult,
  applySaveResult,
  applyTrackingResult,
  optimisticSave,
  shouldSubmitStatusChange,
} from "@/lib/candidate/external-personal-transitions";
import type {
  ExternalJobPersonalState,
  ExternalJobTracking,
} from "@/lib/types";

/**
 * Saving and tracking are two independent facts about one job.
 *
 * Almost every test here asserts that one did NOT change when the other did.
 * That is the property a reader depends on without ever thinking about it: a
 * job they applied to and then tidied out of their saved list is still a job
 * they applied to, and a product that quietly deleted the record would lose
 * something it cannot get back.
 */

const tracking: ExternalJobTracking = {
  id: "track-1",
  status: "APPLIED",
  appliedAt: "2026-08-20T09:00:00.000Z",
  note: null,
  updatedAt: "2026-08-20T09:00:00.000Z",
};

const state = (over: Partial<ExternalJobPersonalState> = {}): ExternalJobPersonalState => ({
  saved: false,
  tracking: null,
  ...over,
});

describe("saving", () => {
  it("settles on the server's answer", () => {
    expect(applySaveResult(state(), { ok: true, saved: true })).toEqual({
      saved: true,
      tracking: null,
    });
  });

  it("believes the server over the request that was sent", () => {
    // A backend that answered `saved: false` to a save must not be re-rendered
    // as saved — the reader would come back to a list that never had it.
    const before = state({ saved: false });
    expect(applySaveResult(before, { ok: true, saved: false }).saved).toBe(false);
  });

  it("restores exactly what was there when the request fails", () => {
    const before = state({ saved: true, tracking });
    expect(applySaveResult(before, { ok: false })).toEqual(before);
  });

  it("never reports a save that did not happen", () => {
    expect(applySaveResult(state({ saved: false }), { ok: false }).saved).toBe(
      false,
    );
  });

  it("leaves the tracking record completely alone", () => {
    // Unsaving is not withdrawing. Saving is not applying.
    const applied = state({ saved: true, tracking });
    expect(applySaveResult(applied, { ok: true, saved: false }).tracking).toBe(
      tracking,
    );

    const untracked = state({ saved: false });
    expect(
      applySaveResult(untracked, { ok: true, saved: true }).tracking,
    ).toBeNull();
  });

  it("flips only the boolean optimistically", () => {
    const before = state({ saved: false, tracking });
    const optimistic = optimisticSave(before);
    expect(optimistic.saved).toBe(true);
    expect(optimistic.tracking).toBe(tracking);
    // And the rollback target is untouched, which is what makes it safe.
    expect(before.saved).toBe(false);
  });
});

describe("marking as applied", () => {
  it("records the server's tracking record", () => {
    const next = applyTrackingResult(state(), { ok: true, tracking });
    expect(next.tracking).toBe(tracking);
  });

  it("does not save the job as a side effect", () => {
    // A candidate who marks an application has not asked for a bookmark.
    expect(applyTrackingResult(state({ saved: false }), { ok: true, tracking }).saved)
      .toBe(false);
    expect(applyTrackingResult(state({ saved: true }), { ok: true, tracking }).saved)
      .toBe(true);
  });

  it("stays untracked when the request fails", () => {
    // Nothing was written optimistically, so there is nothing to undo — and
    // showing "Applied" for a write that failed would let somebody close the
    // tab believing it was recorded.
    const before = state({ saved: true });
    expect(applyTrackingResult(before, { ok: false })).toEqual(before);
  });

  it("stays untracked when the backend answers with an unusable record", () => {
    // A record the adapter dropped — unknown status, no id, bad date. It
    // cannot be edited afterwards, so it is not shown as tracked.
    const before = state();
    expect(applyTrackingResult(before, { ok: true, tracking: null })).toEqual(
      before,
    );
  });
});

describe("removing tracking", () => {
  it("removes the record and nothing else", () => {
    const before = state({ saved: true, tracking });
    const after = applyRemoveTrackingResult(before, { ok: true });
    expect(after.tracking).toBeNull();
    // The job stays saved. Tidying a tracker is not unsaving.
    expect(after.saved).toBe(true);
  });

  it("keeps the record when the request fails", () => {
    const before = state({ saved: false, tracking });
    expect(applyRemoveTrackingResult(before, { ok: false })).toEqual(before);
  });
});

describe("status editing", () => {
  it("allows every transition between two different statuses", () => {
    // No linear machine. A real external process can go back to Interview
    // after a Rejection, or reach an Offer weeks later.
    const cases = [
      ["APPLIED", "INTERVIEW"],
      ["INTERVIEW", "OFFER"],
      ["APPLIED", "REJECTED"],
      ["APPLIED", "WITHDRAWN"],
      ["REJECTED", "INTERVIEW"],
      ["OFFER", "REJECTED"],
      ["WITHDRAWN", "APPLIED"],
    ] as const;

    for (const [from, to] of cases) {
      expect(
        shouldSubmitStatusChange(
          state({ tracking: { ...tracking, status: from } }),
          to,
        ),
        `${from} -> ${to}`,
      ).toBe(true);
    }
  });

  it("spends no request re-selecting the value already stored", () => {
    expect(
      shouldSubmitStatusChange(state({ tracking }), "APPLIED"),
    ).toBe(false);
  });

  it("has nothing to edit on an untracked job", () => {
    expect(shouldSubmitStatusChange(state({ saved: true }), "INTERVIEW")).toBe(
      false,
    );
  });
});

describe("saved and tracked are independent, in all four combinations", () => {
  it("supports saved-and-untracked", () => {
    const s = applySaveResult(state(), { ok: true, saved: true });
    expect(s).toEqual({ saved: true, tracking: null });
  });

  it("supports tracked-and-unsaved", () => {
    const s = applyTrackingResult(state({ saved: false }), { ok: true, tracking });
    expect(s.saved).toBe(false);
    expect(s.tracking).toBe(tracking);
  });

  it("supports saved-and-tracked", () => {
    const saved = applySaveResult(state(), { ok: true, saved: true });
    const both = applyTrackingResult(saved, { ok: true, tracking });
    expect(both).toEqual({ saved: true, tracking });
  });

  it("supports neither, after each is undone without touching the other", () => {
    const both = { saved: true, tracking };
    const unsaved = applySaveResult(both, { ok: true, saved: false });
    expect(unsaved.tracking).toBe(tracking);
    const neither = applyRemoveTrackingResult(unsaved, { ok: true });
    expect(neither).toEqual({ saved: false, tracking: null });
  });
});

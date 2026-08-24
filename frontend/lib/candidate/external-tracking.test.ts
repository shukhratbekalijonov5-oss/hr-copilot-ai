import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import {
  externalApplicationStatusLabel,
  externalApplicationStatusOptions,
  externalApplicationTone,
  externalRowStatuses,
  externalTrackingChip,
  isExternalApplicationStatus,
} from "@/lib/candidate/external-tracking";
import { externalStatusNotice } from "@/lib/candidate/external-job-presentation";
import { EXTERNAL_APPLICATION_STATUSES, type ExternalJobTracking } from "@/lib/types";

/**
 * What the product is allowed to say about an application it never saw.
 *
 * Most of these assert an absence: no raw enum key, no verdict tone, no
 * pretence that a listing's lifecycle tells us anything about the person
 * already inside the employer's process.
 */

const d = en;

function tracking(over: Partial<ExternalJobTracking> = {}): ExternalJobTracking {
  return {
    id: "track-1",
    status: "APPLIED",
    appliedAt: "2026-08-20T09:00:00.000Z",
    note: null,
    updatedAt: "2026-08-20T09:00:00.000Z",
    ...over,
  };
}

describe("status vocabulary", () => {
  it("labels every status this build supports", () => {
    for (const status of EXTERNAL_APPLICATION_STATUSES) {
      expect(externalApplicationStatusLabel(status, d)).toBeTruthy();
    }
  });

  it("says nothing at all for a status it cannot localize", () => {
    // A value from a newer backend. Printing `IN_PROCESS` at a job seeker is
    // worse than silence — it is untranslated, unexplained, and looks like a
    // bug they caused. Worst in exactly the locales that need translation most.
    expect(externalApplicationStatusLabel("IN_PROCESS", d)).toBeNull();
    expect(externalApplicationStatusLabel("", d)).toBeNull();
    expect(isExternalApplicationStatus("IN_PROCESS")).toBe(false);
    expect(isExternalApplicationStatus("APPLIED")).toBe(true);
  });

  it("never prints a raw enum key in any locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const status of EXTERNAL_APPLICATION_STATUSES) {
        const label = externalApplicationStatusLabel(status, dictionary);
        expect(label, `${locale} / ${status}`).toBeTruthy();
        expect(label, `${locale} / ${status}`).not.toContain(status);
      }
    }
  });

  it("offers the whole vocabulary when editing, in every locale", () => {
    // No transition table. A real external process can go to interview and
    // back to applied, or end in a rejection weeks after an offer; greying out
    // an option would tell somebody their own history is invalid.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const options = externalApplicationStatusOptions(dictionary);
      expect(options.map((option) => option.value), locale).toEqual([
        ...EXTERNAL_APPLICATION_STATUSES,
      ]);
      for (const option of options) {
        expect(option.label, `${locale} / ${option.value}`).toBeTruthy();
      }
    }
  });

  it("keeps the tone muted — these are notes, not verdicts", () => {
    // A rejection is somebody's bad week, not something this product should
    // paint red on their own dashboard.
    expect(externalApplicationTone("REJECTED")).toBe("neutral");
    expect(externalApplicationTone("WITHDRAWN")).toBe("neutral");
    expect(externalApplicationTone("APPLIED")).toBe("neutral");
    expect(externalApplicationTone("INTERVIEW")).toBe("info");
    expect(externalApplicationTone("OFFER")).toBe("positive");
  });
});

describe("tracking chip", () => {
  it("shows the candidate's own status", () => {
    expect(externalTrackingChip(tracking({ status: "INTERVIEW" }), d)).toEqual({
      label: d.externalApplications.status.INTERVIEW,
      tone: "info",
    });
  });

  it("shows nothing for an untracked job", () => {
    expect(externalTrackingChip(null, d)).toBeNull();
  });

  it("shows nothing rather than a raw key for an unknown status", () => {
    const unknown = { ...tracking(), status: "IN_PROCESS" } as unknown as ExternalJobTracking;
    expect(externalTrackingChip(unknown, d)).toBeNull();
  });
});

describe("listing lifecycle vs the candidate's own status", () => {
  it("keeps both when a closed listing has a live interview behind it", () => {
    // THE case this separation exists for. The employer stopped advertising;
    // the person already inside their process is still inside it. Both
    // statements are true, and neither may overwrite the other.
    const row = externalRowStatuses(
      { tracking: tracking({ status: "INTERVIEW" }), jobStatus: "CLOSED" },
      d,
      externalStatusNotice,
    );

    expect(row.application).toEqual({
      label: d.externalApplications.status.INTERVIEW,
      tone: "info",
    });
    expect(row.listing).toBe(d.externalJobs.closedNotice);
    expect(row.application?.label).not.toBe(row.listing);
  });

  it("does not downgrade a tracked status when the listing expires", () => {
    for (const jobStatus of ["CLOSED", "EXPIRED", "UNAVAILABLE", "STALE"]) {
      const row = externalRowStatuses(
        { tracking: tracking({ status: "OFFER" }), jobStatus },
        d,
        externalStatusNotice,
      );
      expect(row.application?.label, jobStatus).toBe(
        d.externalApplications.status.OFFER,
      );
    }
  });

  it("says nothing about an active listing, and still shows the tracking", () => {
    const row = externalRowStatuses(
      { tracking: tracking(), jobStatus: "ACTIVE" },
      d,
      externalStatusNotice,
    );
    // Silence is the good case for a listing.
    expect(row.listing).toBeNull();
    expect(row.application?.label).toBe(d.externalApplications.status.APPLIED);
  });

  it("shows a listing state for a job the reader never tracked", () => {
    const row = externalRowStatuses(
      { tracking: null, jobStatus: "CLOSED" },
      d,
      externalStatusNotice,
    );
    expect(row.application).toBeNull();
    expect(row.listing).toBe(d.externalJobs.closedNotice);
  });
});

describe("what the copy promises", () => {
  it("never claims this product received or verified the application", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const copy = [
        dictionary.externalApplications.description,
        dictionary.externalApplications.managedByYou,
        dictionary.externalApplications.markAppliedHint,
        dictionary.externalApplications.removeTrackingHint,
      ]
        .join(" ")
        .toLowerCase();

      for (const claim of [
        "verified",
        "confirmed by",
        "확인했습니다",
        "мы проверили",
        "biz tekshirdik",
      ]) {
        expect(copy, `${locale} must not claim ${claim}`).not.toContain(claim);
      }
    }
  });

  it("tells the reader, in every locale, that removing tracking is not a withdrawal", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(
        dictionary.externalApplications.removeTrackingHint.length,
        locale,
      ).toBeGreaterThan(20);
    }
  });
});

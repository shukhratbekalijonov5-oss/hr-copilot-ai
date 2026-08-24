import type { Dictionary } from "@/lib/i18n/dictionary";
import {
  EXTERNAL_APPLICATION_STATUSES,
  type ExternalApplicationStatus,
  type ExternalJobTracking,
} from "@/lib/types";

/**
 * Words for the candidate's own external-application tracking.
 *
 * ## This product did not observe any of it
 *
 * Every value here was typed in by the person it describes. HR Copilot does
 * not receive external applications, is not told when an employer replies, and
 * cannot verify a single one of these states. So nothing in this module reads
 * like a system fact: no "Verified", no "Confirmed", no progress bar implying
 * a pipeline this product is running. The screens that use it say, in the
 * reader's own language, that they are keeping their own notes.
 *
 * ## An unknown status is silence, not a raw key
 *
 * The status vocabulary belongs to the backend and can grow. A build that
 * meets a value it cannot localize renders NOTHING for it rather than
 * `IN_PROCESS` — an untranslated enum key is not a feature, it is a leak of
 * our column names into somebody's job hunt, and it is worst in exactly the
 * locales that need translation most.
 */

/** A localized label, or null when this build has no word for the value. */
export function externalApplicationStatusLabel(
  status: string,
  d: Dictionary,
): string | null {
  return isExternalApplicationStatus(status)
    ? d.externalApplications.status[status]
    : null;
}

export function isExternalApplicationStatus(
  value: unknown,
): value is ExternalApplicationStatus {
  return (
    typeof value === "string" &&
    (EXTERNAL_APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The tone a status chip carries.
 *
 * Deliberately muted. These are the candidate's notes, not a verdict this
 * product reached, so OFFER is positive and REJECTED is merely neutral —
 * colouring a rejection red would be this product editorialising about
 * somebody's week. Tone never carries the meaning alone; the label is always
 * rendered beside it.
 */
export function externalApplicationTone(
  status: ExternalApplicationStatus,
): "neutral" | "info" | "positive" {
  if (status === "OFFER") return "positive";
  if (status === "INTERVIEW") return "info";
  return "neutral";
}

/**
 * The statuses offered when editing.
 *
 * The whole vocabulary, always, in a fixed order — never a subset computed
 * from the current one. Real external processes skip stages, restart after a
 * rejection, and end in an offer weeks after the candidate assumed they were
 * out. A product that greyed out "Interview" because someone had already
 * recorded "Rejected" would be telling them their own history is invalid.
 */
export function externalApplicationStatusOptions(
  d: Dictionary,
): Array<{ value: ExternalApplicationStatus; label: string }> {
  return EXTERNAL_APPLICATION_STATUSES.map((value) => ({
    value,
    label: d.externalApplications.status[value],
  }));
}

/**
 * What a card should say about a job the reader has tracked.
 *
 * Returns null when there is no tracking record at all — which is a different
 * thing from a record whose status is unknown, and both render as no chip.
 */
export function externalTrackingChip(
  tracking: ExternalJobTracking | null,
  d: Dictionary,
): { label: string; tone: "neutral" | "info" | "positive" } | null {
  if (!tracking) return null;
  const label = externalApplicationStatusLabel(tracking.status, d);
  if (!label) return null;
  return { label, tone: externalApplicationTone(tracking.status) };
}

/**
 * The two independent facts a tracked row carries, kept apart.
 *
 * A listing can be CLOSED while the candidate is at INTERVIEW — the employer
 * stopped advertising, which says nothing about the person already in their
 * process. Both are true, both are shown, and the listing's lifecycle NEVER
 * overwrites the tracked status. This function exists so that separation is a
 * tested property rather than a convention two components each remember.
 */
export interface ExternalRowStatuses {
  /** The candidate's own record. Null when untracked or unlocalizable. */
  application: { label: string; tone: "neutral" | "info" | "positive" } | null;
  /** The listing's lifecycle. Null when ACTIVE — silence is the good case. */
  listing: string | null;
}

export function externalRowStatuses(
  input: { tracking: ExternalJobTracking | null; jobStatus: string },
  d: Dictionary,
  listingNotice: (status: string, d: Dictionary) => string | null,
): ExternalRowStatuses {
  return {
    application: externalTrackingChip(input.tracking, d),
    listing: listingNotice(input.jobStatus, d),
  };
}

import type { Dictionary } from "@/lib/i18n/dictionary";
import { countryLabel } from "@/lib/vacancy/job-profile";
import { formatMoneyRange } from "@/lib/candidate/match-explanation";
import type {
  ExternalJobPlace,
  ExternalJobProvenance,
  ExternalJobReason,
  ExternalJobResult,
  ExternalJobSalary,
  MatchBand,
} from "@/lib/types";

/**
 * What an external job SAYS, in the reader's language.
 *
 * Everything a card or a detail panel prints is decided here rather than in a
 * component, for two reasons. It is where the honesty rules live — remote is
 * not worldwide, an unknown salary is not zero, a score is not a probability —
 * and rules stated in JSX cannot be tested without a browser. These are plain
 * functions over the backend's own values, so the tests next to this file are
 * the actual proof that the UI does not overstate what a provider said.
 *
 * ## The one rule the whole module follows
 *
 * **Absence is rendered as absence.** Every provider in this catalogue leaves
 * most structured fields unstated most of the time. A UI that fills those gaps
 * — "Full-time" because most jobs are, "Remote worldwide" because the work
 * mode is REMOTE, "$0" because no salary was posted — invents claims on the
 * employer's behalf, and a job seeker cannot tell an invented claim from a
 * real one. So nothing here guesses.
 */

/* -------------------------------------------------------------------------- */
/* Location                                                                    */
/* -------------------------------------------------------------------------- */

/** "Seoul, South Korea" — the same order and separator as internal vacancies. */
export function externalPlaceLabel(
  place: ExternalJobPlace,
  d: Dictionary,
): string | null {
  const parts = [
    place.city,
    place.region,
    place.countryCode ? countryLabel(place.countryCode, d) : null,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface ExternalLocationSummary {
  /** The posting's own primary office, if it stated one. */
  primary: string | null;
  /** Other offices, in the order the provider listed them. */
  additional: string[];
  /** How many of `additional` do not fit the shown list. */
  overflow: number;
  /** True when the employer stated no location at all. */
  unknown: boolean;
}

/**
 * Every place this ONE posting is open in.
 *
 * `additionalLocations` matters more than it looks. A requisition open in four
 * offices has to pick one for its primary columns, so a card showing only that
 * one tells a reader in Toronto that a job they are eligible for is in New
 * York. The backend already treats those extra offices as real for filtering;
 * showing them is the other half of the same promise.
 *
 * Duplicates of the primary are dropped — a provider that repeats the head
 * office in its own additional list is describing one place, not two.
 */
export function externalLocationSummary(
  job: Pick<ExternalJobResult, "location" | "additionalLocations">,
  d: Dictionary,
  limit = 2,
): ExternalLocationSummary {
  const primary = externalPlaceLabel(job.location, d);
  const seen = new Set<string>(primary ? [primary] : []);
  const additional: string[] = [];

  for (const place of job.additionalLocations) {
    const label = externalPlaceLabel(place, d);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    additional.push(label);
  }

  const shown = additional.slice(0, Math.max(0, limit));
  return {
    primary,
    additional: shown,
    overflow: additional.length - shown.length,
    unknown: primary === null && additional.length === 0,
  };
}

export type RemoteScopeKind =
  /** Not a remote role, so the question does not arise. */
  | "NOT_REMOTE"
  /** Remote, and the employer named the countries it may be worked from. */
  | "REMOTE_STATED"
  /** Remote, and the employer said nothing about where. */
  | "REMOTE_UNSTATED";

export interface ExternalRemoteScope {
  kind: RemoteScopeKind;
  /** Localized country names, when the employer stated them. */
  countries: string[];
}

/**
 * What "Remote" is actually allowed to mean on this card.
 *
 * `workMode: REMOTE` says the work is done away from an office. It does not
 * say a person in any country may take it — remote work is bounded by payroll,
 * tax and immigration law, and an employer who lists two countries has said
 * something quite different from one who listed none.
 *
 * So an empty `remoteCountriesAllowed` is REMOTE_UNSTATED, and the UI says the
 * employer did not say. It is deliberately never rendered as "worldwide":
 * printing that would send someone to spend an hour on an application for a
 * job they are not eligible to hold, on the strength of a claim this product
 * invented.
 */
export function externalRemoteScope(
  job: Pick<ExternalJobResult, "workMode" | "remoteCountriesAllowed">,
  d: Dictionary,
): ExternalRemoteScope {
  if (job.workMode !== "REMOTE") return { kind: "NOT_REMOTE", countries: [] };
  const countries = job.remoteCountriesAllowed.map((code) =>
    countryLabel(code, d),
  );
  return countries.length > 0
    ? { kind: "REMOTE_STATED", countries }
    : { kind: "REMOTE_UNSTATED", countries: [] };
}

/* -------------------------------------------------------------------------- */
/* Salary                                                                      */
/* -------------------------------------------------------------------------- */

export interface ExternalSalaryDisplay {
  /** The employer's own figure, in the employer's own money. Never converted. */
  original: string | null;
  /** True when no salary was posted — a fact, not a zero. */
  unknown: boolean;
}

/**
 * Pay exactly as the employer stated it.
 *
 * No conversion happens here, and none may. The backend compares salaries
 * across currencies through one FX pipeline and reports the VERDICT as a
 * reason code; it does not return a converted display amount for external
 * jobs, so there is nothing to show beneath the original and this app does not
 * invent one. A frontend that fetched its own rates would be a second exchange
 * rate in the product, disagreeing with the first at the worst possible moment
 * — while someone decides whether a job pays enough to move for.
 *
 * A missing salary is `unknown`, which the UI writes as "Salary not provided".
 * Not "$0", not "N/A" in a money-shaped slot: the employer said nothing, and
 * saying nothing is the honest rendering of that.
 */
export function externalSalaryDisplay(
  salary: ExternalJobSalary,
  d: Dictionary,
): ExternalSalaryDisplay {
  if (!salary.currency || (salary.min === null && salary.max === null)) {
    return { original: null, unknown: true };
  }
  const original = formatMoneyRange(
    salary.min,
    salary.max,
    salary.currency,
    salary.payPeriod,
    d,
  );
  return { original, unknown: original === null };
}

/* -------------------------------------------------------------------------- */
/* Score, band and reasons                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The band label.
 *
 * Read from the backend's value, never re-derived from the score: thresholds
 * live in one versioned policy on the server, and a copy here would drift the
 * first time it moved. An unrecognised band renders nothing at all.
 */
export function externalBandLabel(
  band: MatchBand | null,
  d: Dictionary,
): string | null {
  if (!band) return null;
  return d.externalJobs.band[band] ?? null;
}

/**
 * Every reason code this build knows how to say out loud.
 *
 * Two dictionaries, one lookup. The alignment codes — LOCATION_EXACT,
 * SALARY_BELOW_MINIMUM, WORK_MODE_MISMATCH — are shared with AI Job Match and
 * are read from ITS block, because the same verdict must read the same way on
 * both screens. Only the codes external search invented (the text-relevance
 * family and the stale notice) live in the external block.
 *
 * An unknown code returns null and is dropped by the caller. That is the whole
 * safety property: the backend can add a reason tomorrow, an older frontend
 * will simply not mention it, and no candidate ever sees `SALARY_FOO_BAR`
 * printed on a job card.
 */
export function externalReasonLabel(
  code: string,
  d: Dictionary,
): string | null {
  const external = d.externalJobs.reason as unknown as Record<string, string>;
  if (external[code]) return external[code];
  const shared = d.jobMatch.matchReason as unknown as Record<string, string>;
  return shared[code] ?? null;
}

export type ExternalReasonTone = "positive" | "negative" | "neutral";

export interface ExternalReasonLine {
  code: string;
  text: string;
  tone: ExternalReasonTone;
}

/**
 * Tone from the backend's own alignment state, not from the words.
 *
 * MISMATCH argues against the job, MATCH argues for it, and UNKNOWN /
 * NOT_COMPARABLE argue for nothing — they are facts about missing information.
 * A salary the employer never posted is drawn neutral, never red: the job did
 * not fail a test, nobody set one.
 */
function toneFor(state: string): ExternalReasonTone {
  if (state === "MISMATCH") return "negative";
  if (state === "MATCH") return "positive";
  return "neutral";
}

/**
 * The reasons worth printing, in the backend's own order.
 *
 * The order is not re-sorted here. The backend already ranks a contradiction
 * above a confirmation above an absence — because a reader who did not expect
 * a result wants the contradiction first — and re-sorting would be a second
 * opinion about what is most worth saying.
 */
export function externalReasonLines(
  reasons: ExternalJobReason[],
  d: Dictionary,
  limit = 3,
): ExternalReasonLine[] {
  const lines: ExternalReasonLine[] = [];
  for (const reason of reasons) {
    const text = externalReasonLabel(reason.code, d);
    if (!text) continue;
    lines.push({ code: reason.code, text, tone: toneFor(reason.state) });
    if (lines.length >= limit) break;
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* Status and provenance                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The stale notice, or nothing.
 *
 * STALE means no source has re-observed this listing lately — it is a fact
 * about OUR crawl, not about the posting's age, and the wording says so. "Last
 * seen a while ago" would read as "posted a while ago", which nobody knows:
 * no provider in this catalogue states when an employer published a role.
 *
 * ACTIVE gets no badge. A badge on the normal case is noise, and a page where
 * every card is decorated teaches readers to ignore the decoration.
 *
 * SEARCH never returns a closed, expired or unavailable job. The SAVED list
 * does: a candidate keeps a posting for weeks and the employer moves on, and
 * the honest answer when they come back is which of those three happened —
 * not a silently missing row, and not one word covering all three. An employer
 * ending a role, a stated deadline passing, and every source going unreadable
 * are different facts, and a reader may act on them differently.
 *
 * A status this build does not know still falls through to the defensive
 * label: better a card that says "we cannot vouch for this" than one that
 * silently looks open.
 */
export function externalStatusNotice(
  status: string,
  d: Dictionary,
): string | null {
  if (status === "ACTIVE") return null;
  if (status === "STALE") return d.externalJobs.staleNotice;
  if (status === "CLOSED") return d.externalJobs.closedNotice;
  if (status === "EXPIRED") return d.externalJobs.expiredNotice;
  if (status === "UNAVAILABLE") return d.externalJobs.unavailableNotice;
  return d.externalJobs.unexpectedStatus;
}

/**
 * How loudly a lifecycle state should read.
 *
 * ACTIVE is silence. STALE is a caution — we have not re-observed it, which is
 * not the same as it being gone. The three terminal states are the strongest
 * tone the badge vocabulary has, because a candidate about to spend an evening
 * on an application deserves to notice.
 */
export function externalStatusTone(
  status: string,
): "neutral" | "warning" | "critical" | null {
  if (status === "ACTIVE") return null;
  if (status === "STALE") return "warning";
  if (status === "CLOSED" || status === "EXPIRED" || status === "UNAVAILABLE") {
    return "critical";
  }
  return "warning";
}

export interface ExternalProvenanceLines {
  /** "Source: Company careers" */
  source: string | null;
  /** "Apply via: Greenhouse" — only when it differs from the source. */
  applyVia: string | null;
  /** "Listed by 2 sources" — corroboration, never a ranking claim. */
  corroboration: string | null;
}

/**
 * Where this listing came from, said plainly and said small.
 *
 * A job seeker is not shopping for an applicant tracking system. Provenance is
 * here so someone can see that a role came from the company's own careers page
 * rather than an aggregator's copy of it — that is a trust signal — and for no
 * other purpose. So there is no trust score, no "verified" badge implying an
 * editorial judgement, and no ordering of providers by quality.
 *
 * "Apply via" appears only when it differs from the source, because "Source:
 * Greenhouse / Apply via: Greenhouse" is one fact printed twice.
 */
export function externalProvenanceLines(
  provenance: ExternalJobProvenance,
  d: Dictionary,
  f: (template: string, values: Record<string, string | number>) => string,
): ExternalProvenanceLines {
  const label = (code: string | null): string | null => {
    if (!code) return null;
    const sources = d.externalJobs.source as unknown as Record<string, string>;
    // An unlabelled provider falls back to the generic word rather than to its
    // enum name: "EXTERNAL_BOARD_V2" on a job card is a leaked identifier.
    return sources[code] ?? d.externalJobs.sourceUnknown;
  };

  const source = label(provenance.primarySource);
  const applyVia = label(provenance.applyVia);
  return {
    source: source ? f(d.externalJobs.sourceLine, { source }) : null,
    applyVia:
      applyVia && applyVia !== source
        ? f(d.externalJobs.applyViaLine, { source: applyVia })
        : null,
    corroboration:
      provenance.sourceCount > 1
        ? f(d.externalJobs.sourceCountLine, { count: provenance.sourceCount })
        : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Work mode, employment type and seniority, in one place.
 *
 * They read from the SAME dictionary blocks the internal job board and the
 * preferences form use. A product where "Full-time" is worded one way on a
 * vacancy and another way on an external job has two vocabularies for one
 * fact, and a reader has no way to know they mean the same thing.
 */
export function externalWorkModeLabel(
  value: string | null,
  d: Dictionary,
): string | null {
  if (!value) return null;
  return d.workMode[value as keyof typeof d.workMode] ?? null;
}

export function externalEmploymentLabel(
  value: string | null,
  d: Dictionary,
): string | null {
  if (!value) return null;
  return (
    d.employmentTypeValue[value as keyof typeof d.employmentTypeValue] ?? null
  );
}

export function externalSeniorityLabel(
  value: string | null,
  d: Dictionary,
): string | null {
  if (!value) return null;
  return d.seniorityLevel[value as keyof typeof d.seniorityLevel] ?? null;
}

/**
 * The description, as paragraphs.
 *
 * Split rather than rendered through `dangerouslySetInnerHTML`. The backend
 * sanitizes provider HTML at ingestion, so this text is already plain — and
 * that is exactly why the renderer must stay plain too. The day a provider
 * changes shape, a text renderer shows a candidate some angle brackets; an
 * HTML renderer shows them whatever the provider decided to send.
 */
export function externalDescriptionParagraphs(
  description: string | null,
): string[] {
  if (!description) return [];
  return description
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

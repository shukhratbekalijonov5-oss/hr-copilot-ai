import { extractHtml } from '../web-ingestion/html-extract';
import {
  ISO_COUNTRY_PATTERN,
  LANGUAGE_CODE_PATTERN,
  SUPPORTED_CURRENCIES,
  VISA_TYPE_PATTERN,
} from '../common/vacancy/job-vocabulary';
import { EXTERNAL_JOB_LIMITS } from './external-job.limits';
import type {
  EmploymentType,
  JobBenefit,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../generated/prisma/enums';

/**
 * Turning an untrusted provider payload into something safe to store.
 *
 * Every value here arrived over the network from a company we do not control,
 * through a format we do not own, and will end up in a database a candidate
 * reads. Three things follow, and this module exists to enforce all three:
 *
 *  1. NOTHING is trusted to be the type it claims. A "salary" may be a string,
 *     a negative number, or a currency code in the amount field.
 *  2. NOTHING is guessed. A field this module cannot map confidently becomes
 *     null, and null means "the source did not say" everywhere downstream.
 *  3. NOTHING that could act as markup survives. Descriptions go through the
 *     same HTML extractor the candidate-link pipeline uses, so a `<script>` in
 *     a job ad becomes text or nothing at all — never a stored element.
 *
 * A field that fails validation is dropped; a job whose IDENTITY fails
 * validation (no company, no title, no usable URL) is rejected outright,
 * because a job with no employer is not a job.
 */

export class ExternalJobRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ExternalJobRejected';
  }
}

/** Trim, collapse whitespace, cap length. Empty becomes null, never "". */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/**
 * HTML entities → the characters they stand for. ONE pass, no recursion.
 *
 * Only the named entities that matter for markup are decoded, plus numeric
 * references, and the numeric decoder deliberately refuses anything outside
 * the Basic Multilingual Plane range it can represent safely.
 *
 * A single pass is the whole point. Decoding until nothing changes is how
 * `&amp;lt;script&amp;gt;` becomes a live tag; the caller instead re-runs the
 * HTML STRIPPER between passes, so each decode is followed by a strip and
 * nothing that becomes markup survives to the next round.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]{1,31});/gi,
    (match, entity: string) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#')) {
        const code = key.startsWith('#x')
          ? Number.parseInt(key.slice(2), 16)
          : Number.parseInt(key.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
          return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[key] ?? match;
    },
  );
}

const HTML_TAG = /<[a-z!/][^>]*>/i;

/**
 * Provider description → plain text.
 *
 * Job ads are written in HTML by a CMS, and providers hand it over verbatim.
 * Rather than sanitizing markup — which means maintaining an allowlist forever
 * and being wrong once — the text is extracted and the markup is discarded, so
 * there is no sanitized-HTML field for a renderer to trust by mistake.
 *
 * ## Why this alternates decoding and stripping
 *
 * Greenhouse's `content` field arrives ENTITY-ENCODED: the payload literally
 * contains `&lt;div&gt;`, not `<div>`. Strip-only would store that verbatim,
 * which is safe today (React escapes it) and a trap tomorrow — the first
 * person who notices a description full of `&lt;` and "fixes" it with a decode
 * has just turned every stored job ad into live markup.
 *
 * So each round STRIPS what is markup now and then decodes ONCE, and repeats
 * while the decode still changes something. `&amp;lt;script&amp;gt;` becomes
 * `&lt;script&gt;` becomes `<script>` becomes nothing. The loop is bounded, so
 * a pathologically nested payload cannot spin.
 *
 * One consequence worth knowing: `extractHtml` discards very short fragments
 * as boilerplate, so a description of three words normalizes to null. Real job
 * ads are paragraphs and this never fires on them — and when it does, an empty
 * description is the safe outcome rather than a suspicious one.
 *
 * `extractHtml` is the module the candidate-link pipeline already uses on
 * arbitrary web pages: a small tokenizer that drops script/style/nav subtrees
 * and keeps prose. Reused rather than reimplemented, because a second HTML
 * parser is a second set of parsing bugs.
 */
const MAX_DECODE_ROUNDS = 4;

export function plainDescription(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;

  let working = value;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    // Strip first: whatever is markup right now goes, before anything new is
    // uncovered.
    if (HTML_TAG.test(working)) working = stripHtml(working);
    const decoded = decodeEntities(working);
    // Nothing left to uncover. `&amp;` in real prose settles here after one
    // harmless round.
    if (decoded === working) break;
    working = decoded;
  }
  // The loop may have exited on its round limit with markup freshly revealed.
  if (HTML_TAG.test(working)) working = stripHtml(working);

  const cleaned = working.replace(/[^\S\n]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

function stripHtml(value: string): string {
  return extractHtml(value, 'https://external.invalid/')
    .sections.map((section) =>
      [section.heading, section.text].filter(Boolean).join('\n'),
    )
    .join('\n\n');
}

/**
 * An absolute http(s) URL, or null.
 *
 * Anything else — `javascript:`, `data:`, a relative path, a host with
 * credentials in it — is not a link this product will ever put in front of a
 * candidate or hand to a fetcher.
 */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > EXTERNAL_JOB_LIMITS.maxUrlLength) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  return url.toString();
}

/** ISO 3166-1 alpha-2, uppercased. Names ("Korea") are NOT guessed into codes. */
export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return ISO_COUNTRY_PATTERN.test(upper) ? upper : null;
}

export function countryCodes(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const code = countryCode(entry);
    if (code) seen.add(code);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** A currency this product can actually compare. Unknown codes are dropped. */
export function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(upper)
    ? upper
    : null;
}

/**
 * A salary amount in major units, or null.
 *
 * Strings are accepted because providers send `"70000"` and `"70,000"`, but
 * only after the separators come off — and anything outside the sanity bounds
 * is treated as a parsing error at the source rather than stored. A salary
 * that is wrong is worse than a salary that is missing: missing is neutral
 * everywhere in this product, wrong silently misranks the job.
 */
export function salaryAmount(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[\s,_]/g, ''))
        : NaN;
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (
    rounded < EXTERNAL_JOB_LIMITS.minSalary ||
    rounded > EXTERNAL_JOB_LIMITS.maxSalary
  ) {
    return null;
  }
  return rounded;
}

/** One member of an enum, or null. Case-insensitive; never a nearest guess. */
export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (typeof value !== 'string') return null;
  const upper = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(upper) ? (upper as T) : null;
}

export const WORK_MODES: readonly WorkMode[] = ['ONSITE', 'HYBRID', 'REMOTE'];
export const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
];
export const SENIORITY_LEVELS: readonly SeniorityLevel[] = [
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'STAFF',
  'MANAGER',
];
export const PAY_PERIODS: readonly PayPeriod[] = [
  'HOURLY',
  'MONTHLY',
  'YEARLY',
];
export const JOB_BENEFITS: readonly JobBenefit[] = [
  'HEALTH_INSURANCE',
  'MEAL_ALLOWANCE',
  'HOUSING_SUPPORT',
  'RELOCATION_SUPPORT',
  'EDUCATION_BUDGET',
  'REMOTE_ALLOWANCE',
  'FLEXIBLE_HOURS',
  'STOCK_OPTIONS',
  'BONUS',
  'PAID_LEAVE',
  'OTHER',
];

/** Short free-text tags (skills, industries). Deduped, capped, trimmed. */
export function tags(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const cleaned = text(entry, EXTERNAL_JOB_LIMITS.maxTagLength);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

export function languageCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const lower = entry.trim().toLowerCase();
    if (LANGUAGE_CODE_PATTERN.test(lower)) seen.add(lower);
    if (seen.size >= EXTERNAL_JOB_LIMITS.maxLanguageCodes) break;
  }
  return [...seen];
}

export function visaTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const cleaned = entry.trim();
    if (VISA_TYPE_PATTERN.test(cleaned)) seen.add(cleaned);
    if (seen.size >= EXTERNAL_JOB_LIMITS.maxVisaTypes) break;
  }
  return [...seen];
}

/**
 * A timestamp, or null.
 *
 * Rejects the far future as well as the unparseable: a deadline in 2147 is a
 * millisecond/second mix-up, and storing it would make a dead posting look
 * permanently open.
 */
export function timestamp(value: unknown, now: Date = new Date()): Date | null {
  if (value === null || value === undefined) return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value < 1e12 ? value * 1000 : value)
        : typeof value === 'string'
          ? new Date(value)
          : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const ceiling = new Date(now);
  ceiling.setFullYear(
    ceiling.getFullYear() + EXTERNAL_JOB_LIMITS.maxExpiryYearsAhead,
  );
  if (date > ceiling) return null;
  // 1990 predates online job postings; anything earlier is a zero/epoch bug.
  if (date.getFullYear() < 1990) return null;
  return date;
}

/**
 * A PUBLICATION date, or null.
 *
 * Separate from `timestamp()` on purpose. That one guards a deadline, where
 * the dangerous direction is the far future; this one guards a claim about the
 * past, where the dangerous direction is a date that has not happened yet —
 * "Posted in 3 days" is a defect a reader can see, and a reason to refuse the
 * value rather than render it.
 *
 * ## Date-only input
 *
 * schema.org permits a bare `2026-08-20`, which `new Date()` reads as UTC
 * midnight. Stored that way, a reader in Los Angeles is shown 19 August: the
 * calendar date the employer wrote would be silently decremented for a third
 * of the world. Anchoring a date-only value at 12:00 UTC keeps the same
 * calendar day from UTC-11 through UTC+12, which covers every inhabited zone
 * this product serves.
 *
 * A precision column (DATE vs DATETIME) is deliberately NOT added: no live
 * provider sends a date-only publication value today — Greenhouse and Ashby
 * both send full offsets — so it would be a column serving a hypothetical.
 */
export function publicationDate(
  value: unknown,
  now: Date = new Date(),
): Date | null {
  if (value === null || value === undefined) return null;

  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    // Epoch seconds and epoch milliseconds are both in the wild, and the
    // magnitude is the only thing that tells them apart.
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    date = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
      ? new Date(`${trimmed}T12:00:00.000Z`)
      : new Date(trimmed);
  }

  if (!date || Number.isNaN(date.getTime())) return null;
  if (date.getTime() > now.getTime() + EXTERNAL_JOB_LIMITS.maxPostedAtSkewMs) {
    return null;
  }
  // The same floor `timestamp()` uses: 1990 predates online job postings, so
  // anything earlier is an epoch-zero or default-value bug rather than an old
  // listing. Genuinely old postings are kept — age is not a reason to refuse.
  if (date.getFullYear() < 1990) return null;
  return date;
}

/**
 * A company name folded to its identity.
 *
 * "ABC Corp.", "ABC Corporation", "abc  corp" and "ABC Corp, Inc." are one
 * employer written four ways, and a dedupe that treats them as four companies
 * shows the candidate the same job four times. Legal suffixes and punctuation
 * come off; the words do not, because "ABC Labs" and "ABC Bank" are genuinely
 * different companies and no amount of folding may merge them.
 */
const LEGAL_SUFFIXES =
  /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|sa|nv|bv|ab|oy|as|plc|pte|pty|kk|kabushiki|kaisha|주식회사|㈜)\b\.?/g;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A job title folded to its identity.
 *
 * Punctuation, bracketed asides ("(Remote)", "[Seoul]") and req numbers come
 * off, because they are how one posting is written on three sites. Seniority
 * words deliberately DO NOT: "Senior Backend Engineer" and "Backend Engineer"
 * are usually two different openings at the same company, and merging them
 * would hide one of them entirely.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(req|requisition|job)\s*#?\s*\d+\b/g, ' ')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The registrable-ish host of a URL, lowercased, `www.` removed. */
export function domainOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

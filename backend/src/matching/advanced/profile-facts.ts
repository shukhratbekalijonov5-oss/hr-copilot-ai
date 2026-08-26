/**
 * The candidate's CURRENT profile as scoring facts — including the free-form
 * experience dates that the AI payload deliberately drops.
 *
 * Dates on experience entries are candidate-typed strings ("2021", "2021-03",
 * "Jan 2022", "현재"). Parsing is best-effort and conservative: a year is
 * extracted only when a literal 4-digit year is present, "present"-style
 * markers (several languages) mean the current year, and anything unparseable
 * stays null — no date is ever invented (Rule: no fabricated candidate facts).
 */

export interface ExperienceFact {
  title: string;
  company: string | null;
  description: string | null;
  /** As typed by the candidate. */
  startDate: string | null;
  endDate: string | null;
  /** Best-effort parsed years; null when the text names no year. */
  startYear: number | null;
  endYear: number | null;
  /** True when endDate reads as "present/current" in a supported language. */
  isCurrent: boolean;
}

export interface ProfileFacts {
  headline: string | null;
  summary: string | null;
  location: string | null;
  skills: string[];
  languages: string[];
  experience: ExperienceFact[];
  educationCount: number;
}

const PRESENT_MARKER =
  /present|current|now|ongoing|today|현재|재직|сейчас|настоящее|по\s*наст|hozir|hozirgacha/i;

const YEAR = /(?:19|20)\d{2}/;

export function parseYear(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = YEAR.exec(raw);
  return match ? Number(match[0]) : null;
}

export function isPresentMarker(raw: string | null | undefined): boolean {
  return !!raw && PRESENT_MARKER.test(raw);
}

/** Raw Prisma `CandidateAccount` fields → typed facts. Unknown shapes drop out. */
export function buildProfileFacts(account: {
  headline: string | null;
  summary: string | null;
  location: string | null;
  skills: string[];
  languages: string[];
  experience: unknown;
  education: unknown;
}): ProfileFacts {
  const currentYear = new Date().getUTCFullYear();
  const experience = (
    Array.isArray(account.experience) ? account.experience : []
  ).flatMap((entry): ExperienceFact[] => {
    const e = entry as Record<string, unknown>;
    if (typeof e?.title !== 'string' || !e.title) return [];
    const startDate = typeof e.startDate === 'string' ? e.startDate : null;
    const endDate = typeof e.endDate === 'string' ? e.endDate : null;
    const isCurrent = isPresentMarker(endDate);
    return [
      {
        title: e.title,
        company: typeof e.company === 'string' ? e.company : null,
        description: typeof e.description === 'string' ? e.description : null,
        startDate,
        endDate,
        startYear: parseYear(startDate),
        endYear: isCurrent ? currentYear : parseYear(endDate),
        isCurrent,
      },
    ];
  });

  return {
    headline: account.headline,
    summary: account.summary,
    location: account.location,
    skills: account.skills ?? [],
    languages: account.languages ?? [],
    experience,
    educationCount: Array.isArray(account.education)
      ? account.education.length
      : 0,
  };
}

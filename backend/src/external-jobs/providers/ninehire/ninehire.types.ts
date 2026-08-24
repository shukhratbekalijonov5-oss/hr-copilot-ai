/**
 * The Ninehire API payload, as officially documented.
 *
 * Loosely typed on purpose: this describes what a third party sent, not a
 * promise. Two documented inconsistencies are modelled deliberately, because
 * the official page contains both spellings and a provider that trusts one
 * would silently lose the field:
 *
 *   - the list SAMPLE shows `url` while the list FIELD TABLE says `applyUrl`;
 *   - the list uses `employmentTypes` (plural) while the DETAIL sample uses
 *     `employmentType` (singular).
 *
 * Nothing outside `ninehire.normalize.ts` may import these types.
 */

/**
 * One work site.
 *
 * `x` is longitude and `y` is latitude — confirmed against the documented
 * sample, where x=129.12 / y=35.17 is Busan and the reverse would be in the
 * Yellow Sea. `name` is a site LABEL ("부산지사" — Busan branch), not a city.
 */
export interface NinehireJobLocation {
  x?: unknown;
  y?: unknown;
  name?: unknown;
  address?: unknown;
}

/** Required years of experience. `over` = at least, `below` = at most. */
export interface NinehireCareerRange {
  over?: unknown;
  below?: unknown;
}

export interface NinehireJob {
  /** Workspace-unique id. Documented as "공고별 고유한 ID 값". */
  id?: unknown;
  title?: unknown;
  /** The apply page. See the note above about `url` vs `applyUrl`. */
  applyUrl?: unknown;
  url?: unknown;
  /** ISO datetime, or null for 상시 채용 — rolling, no deadline. */
  deadline?: unknown;
  tags?: unknown;
  /** "irrelevant" | "experienced" | "newcomer". */
  career?: unknown;
  careerRange?: NinehireCareerRange | null;
  /** "full_time" | "contractor" | "intern" | "part_time" | "freelancer" |
   *  "dispatched" | "day_labor" | "trainee". Multi-valued. */
  employmentTypes?: unknown;
  employmentType?: unknown;
  jobLocations?: NinehireJobLocation[];
  /** 직군 — an org group ("개발팀"). Not an industry. */
  jobGroup?: unknown;
  /** 직무 — a task/role label ("프론트엔드"). Source-defined. */
  jobTask?: unknown;
  /** 소속 — the affiliation within the workspace. */
  affiliation?: unknown;
  createdAt?: unknown;
  /** Whether the posting is private. */
  isPrivate?: unknown;
  /**
   * in_progress — 모집 중, 채용 진행중        (recruiting)
   * disabled    — 모집 중단, 채용 진행중       (paused; hiring continues)
   * closed      — 모집 중단, 채용 마감됨       (hiring CLOSED)
   * archived    — 모집 중단, 채용 보관됨       (archived)
   */
  status?: unknown;

  // -- detail endpoint only ------------------------------------------------
  /** HTML. */
  content?: unknown;
  isActive?: unknown;
  coverImageUrl?: unknown;
  cover?: unknown;
}

/** `{ count, results }` — the documented list envelope. */
export interface NinehireJobList {
  count?: unknown;
  results?: NinehireJob[];
}

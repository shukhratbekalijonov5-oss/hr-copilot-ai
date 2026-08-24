import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  EMPLOYMENT_TYPES,
  SENIORITY_LEVELS,
  WORK_MODES,
} from '../../normalize';
import {
  EXTERNAL_SEARCH_SORTS,
  type ExternalSearchSort,
} from '../external-search.policy';
import { PAY_PERIODS } from '../../normalize';
import { SUPPORTED_CURRENCIES } from '../../../common/vacancy/job-vocabulary';
import type {
  EmploymentType,
  PayPeriod,
  SeniorityLevel,
  WorkMode,
} from '../../../generated/prisma/enums';

/**
 * A pay floor, and optionally a target, in the candidate's own currency.
 *
 * Declared BEFORE the class that references it: `@Type(() => …)` evaluates at
 * decoration time, and a class expression cannot be read before its own
 * declaration has run. The application refuses to boot otherwise, which is a
 * good failure — it happens once, loudly, at startup.
 */
export class ExternalJobSalaryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  minAmount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  maxAmount?: number;

  @IsIn(SUPPORTED_CURRENCIES)
  currency!: string;

  @IsIn(PAY_PERIODS)
  payPeriod!: PayPeriod;
}

/**
 * What a candidate may ask of the external catalogue.
 *
 * ## Provider-neutral by construction
 *
 * There is no `provider`, no `board`, no `sourceType` field, and adding one
 * would be a product decision rather than a convenience. A job seeker does not
 * know or care whether a role is published through Greenhouse, Lever, Ashby or
 * a company's own careers page, and letting them filter by it would leak an
 * integration detail into the product's vocabulary — and quietly imply that
 * some ATSs carry better jobs than others.
 *
 * ## Hard and soft, in the shape of the request
 *
 *   query       HARD — decides which jobs are in the search at all
 *   countries   HARD — the one location filter that removes jobs
 *   everything else  SOFT — decides the ORDER
 *
 * That asymmetry is deliberate and is documented on each field. The failure it
 * prevents: a candidate ticks Remote, Full-time, Senior and a salary floor,
 * every one becomes an `AND`, six reasonable choices intersect to nothing, and
 * they conclude the catalogue has no backend roles when it has hundreds.
 */
export class ExternalJobSearchDto {
  /**
   * The text query. HARD: it decides the universe.
   *
   * Absent means "no text constraint", which is a browse rather than a failed
   * search — the whole current catalogue is eligible and the soft preferences
   * decide the order.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200, {
    message:
      'query must be between 1 and 200 characters — a longer string is not a ' +
      'job search',
  })
  query?: string;

  /**
   * Countries chosen FOR THIS SEARCH. HARD.
   *
   * The only location input that removes jobs. A country saved in the
   * candidate's preferences is a ranking signal instead: someone whose profile
   * says Seoul and who searches "Backend Engineer" is asking about backend
   * engineering, not about Seoul.
   *
   * A job matches when its primary location, ANY of its additional locations,
   * or its explicitly-listed remote-eligible countries include one of these.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[A-Za-z]{2}$/, {
    each: true,
    message: 'countries must be ISO 3166-1 alpha-2 codes',
  })
  countries?: string[];

  /** SOFT: remote-aligned jobs rank higher; hybrid and on-site remain. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WORK_MODES.length)
  @IsIn(WORK_MODES, { each: true })
  workModes?: WorkMode[];

  /** SOFT: a full-time preference reorders; it does not hide contract roles. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EMPLOYMENT_TYPES.length)
  @IsIn(EMPLOYMENT_TYPES, { each: true })
  employmentTypes?: EmploymentType[];

  /** SOFT. Most external providers never state seniority; unknown stays neutral. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SENIORITY_LEVELS.length)
  @IsIn(SENIORITY_LEVELS, { each: true })
  seniorityLevels?: SeniorityLevel[];

  /**
   * SOFT. A pay floor ranks jobs; it never removes them.
   *
   * Compared across currencies through the existing FX pipeline, so a
   * 40,000,000 KRW posting can answer a question asked in USD. A job whose
   * employer stated no salary is UNKNOWN — neutral, never a mismatch.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalJobSalaryDto)
  minCompensation?: ExternalJobSalaryDto;

  /**
   * What to order the results by. Defaults to RELEVANCE.
   *
   * A closed enum, checked here, and branched on explicitly in the service —
   * the string never reaches SQL. A sort parameter that becomes an `ORDER BY`
   * fragment is the classic way a read-only search endpoint turns into an
   * injection surface, and the DTO refusing anything outside the enum is the
   * first of the two locks.
   *
   * NEWEST changes only the ORDER. The hard universe is identical: the text
   * query still decides which jobs are in the search, an explicit country
   * still removes jobs, and the candidate's own exclusions still apply.
   */
  @IsOptional()
  @IsIn(EXTERNAL_SEARCH_SORTS)
  sort?: ExternalSearchSort;

  /** 1-based page of the stored ranking. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /**
   * Page size. Bounded so one response stays a reasonable payload; this bounds
   * the PAGE and never the ranking, and `total` always reports the full count.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

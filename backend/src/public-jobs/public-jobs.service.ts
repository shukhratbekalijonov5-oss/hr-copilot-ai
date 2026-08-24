import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CandidateAccountService } from '../candidate-account/candidate-account.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import {
  ApplicationSource,
  ApplicationStatus,
  VacancyStatus,
} from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { QueryPublicJobsDto } from './dto/query-public-jobs.dto';
import { FxRateService } from '../fx/fx-rate.service';
import { uniqueApplicantCounts } from '../common/vacancy-access/applicant-counts';
import {
  JOB_FEATURE_SELECT,
  normalizedJobFeatures,
} from '../matching/normalized-job-features';
import {
  compareSearchResults,
  hasSecondaryPreferences,
  searchAlignment,
  type SearchSecondaryFilters,
} from '../matching/search-alignment';

/**
 * Public job discovery and authenticated direct application.
 *
 * Discovery exposes ONLY OPEN vacancies and only advertisement-safe fields:
 * no applicant counts, no creator, no internal ids beyond the public slug, no
 * processing or evidence data. DRAFT/CLOSED/ARCHIVED vacancies do not exist as
 * far as these endpoints are concerned — an unknown or non-OPEN slug is a 404.
 */
/**
 * How much of the catalogue one search will order before paginating it.
 *
 * Generous on purpose — the whole point is that a search's results are ranked
 * as a whole rather than a page at a time — but not unbounded: past this,
 * ranking in application memory is the wrong tool and the honest fix is a
 * search engine, not a bigger number.
 */
const SEARCH_UNIVERSE_CAP = 1_000;

@Injectable()
export class PublicJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateAccounts: CandidateAccountService,
    private readonly events: DomainEventsService,
    private readonly fx: FxRateService,
  ) {}

  /**
   * Find Jobs.
   *
   * ## What decides WHICH jobs exist, and what only decides their ORDER
   *
   *   OPEN vacancies
   *     → primary text query            HARD  — defines the universe
   *     → explicit location             HARD  — the candidate picked a place
   *     → work mode / employment /
   *       experience / pay / saved
   *       location preference           SOFT  — ordering only
   *     → deterministic sort
   *     → pagination
   *
   * Searching "Backend Engineer" must return every backend vacancy this
   * catalogue holds. Ticking Remote, Full-time and Senior narrows nothing: it
   * says which of those backend jobs to read first. The previous
   * implementation `AND`-ed all five into SQL, so a handful of sensible
   * choices could intersect a thirty-job universe down to nothing and tell the
   * candidate there was no such work here.
   *
   * Location is the deliberate exception. Picking Seoul is a statement about
   * where the person can actually work, so it restricts — but ONLY when picked
   * for this search. A saved country preference arrives as `preferredCountries`
   * and merely ranks; where someone lives is not a decision about where they
   * want to work.
   *
   * ## Why the whole universe is ordered before it is paginated
   *
   * Ranking one database page would compare twenty rows against each other and
   * call the winner the best match, while a stronger job sat unread on page
   * three. The order has to exist over the entire result set for any page of
   * it to mean anything, so the universe is read, scored, sorted and only then
   * sliced. `SEARCH_UNIVERSE_CAP` bounds that read; a catalogue big enough to
   * hit it needs a real search engine, and silently ranking a fraction while
   * claiming otherwise would be the wrong way to find out.
   */
  async list(query: QueryPublicJobsDto): Promise<PaginatedResult<unknown>> {
    const where = this.hardUniverse(query);

    const soft: SearchSecondaryFilters = {
      workModes: query.workModes ?? [],
      employmentTypes: query.employmentTypes ?? [],
      seniorityLevels: query.seniorityLevels ?? [],
      compensation:
        query.salaryMin && query.salaryCurrency && query.payPeriod
          ? {
              minAmount: query.salaryMin,
              maxAmount: null,
              currency: query.salaryCurrency,
              payPeriod: query.payPeriod,
            }
          : null,
      preferredLocations: (query.preferredCountries ?? []).map((code) => ({
        countryCode: code.toUpperCase(),
        region: null,
        city: null,
      })),
    };

    // Nothing soft was asked for: the catalogue's own order is the answer, and
    // the database can paginate it without any of this.
    if (!hasSecondaryPreferences(soft)) {
      const [rows, total] = await this.prisma.$transaction([
        this.prisma.vacancy.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: { createdAt: 'desc' },
          select: SEARCH_LIST_SELECT,
        }),
        this.prisma.vacancy.count({ where }),
      ]);
      return paginated(
        await this.withApplicantCounts(rows),
        total,
        query.page,
        query.limit,
      );
    }

    // Cross-currency pay comes from the cached snapshot. `current()` never
    // fetches: a job search must not wait on a third party.
    const { table } = await this.fx.current();

    const universe = await this.prisma.vacancy.findMany({
      where,
      take: SEARCH_UNIVERSE_CAP,
      orderBy: { createdAt: 'desc' },
      select: SEARCH_LIST_SELECT,
    });

    const ranked = universe
      .map((row) => ({
        row,
        alignment: searchAlignment(normalizedJobFeatures(row), soft, table),
      }))
      .sort((a, b) =>
        compareSearchResults(
          {
            score: a.alignment.score,
            createdAt: a.row.createdAt,
            publicSlug: a.row.publicSlug,
          },
          {
            score: b.alignment.score,
            createdAt: b.row.createdAt,
            publicSlug: b.row.publicSlug,
          },
        ),
      );

    const page = ranked.slice(query.skip, query.skip + query.limit);
    const withCounts = await this.withApplicantCounts(page.map((e) => e.row));

    return paginated(
      withCounts.map((job, index) => ({
        ...job,
        // Why this job sits where it does. Present only when something soft
        // was actually asked — an unranked list has no ordering to explain.
        searchAlignment: {
          score: page[index].alignment.score,
          alignments: page[index].alignment.alignments,
        },
      })),
      ranked.length,
      query.page,
      query.limit,
    );
  }

  /**
   * The HARD half: everything that decides whether a job is in the results.
   *
   * Exactly three things may narrow a search — the vacancy being OPEN, the
   * primary text query, and a location chosen for THIS search. Anything else
   * added here silently becomes a filter, which is the failure this method
   * exists to make impossible to do by accident.
   */
  private hardUniverse(query: QueryPublicJobsDto): Prisma.VacancyWhereInput {
    const and: Prisma.VacancyWhereInput[] = [];

    if (query.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.location) {
      // Legacy free-text place. Most vacancies predate `country`, so this
      // stays a substring match rather than becoming an exact one.
      and.push({ location: { contains: query.location, mode: 'insensitive' } });
    }
    if (query.countries?.length) {
      // A REMOTE role workable from a requested country counts as being in
      // it — remote geography is a real answer to "where can I work".
      and.push({
        OR: [
          { country: { in: query.countries } },
          {
            workMode: 'REMOTE',
            remoteCountriesAllowed: { hasSome: query.countries },
          },
        ],
      });
    }

    return {
      status: VacancyStatus.OPEN,
      ...(and.length > 0 ? { AND: and } : {}),
    };
  }

  /**
   * Attaches the live unique applicant count and drops the internal id.
   *
   * The SAME count a recruiter sees on their dashboard, from the same shared
   * function — a job page advertising twelve applicants while the recruiter
   * reads nine would be the product telling two people different things about
   * one fact that a candidate is using to decide whether to apply.
   *
   * Aggregate only: no names, no ids, nothing about WHO applied.
   */
  private async withApplicantCounts<T extends { id: string }>(
    rows: T[],
  ): Promise<Omit<T, 'id'>[]> {
    const counts = await uniqueApplicantCounts(
      this.prisma,
      rows.map((row) => row.id),
    );
    return rows.map(({ id, ...rest }) => ({
      ...rest,
      applicantCount: counts.get(id) ?? 0,
    }));
  }

  async detail(publicSlug: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      // Status is part of the lookup: a CLOSED job's slug 404s exactly like a
      // slug that never existed.
      where: { publicSlug, status: VacancyStatus.OPEN },
      select: {
        id: true,
        ...PUBLIC_DETAIL_SELECT,
        requirements: {
          select: { text: true, type: true, required: true },
          orderBy: { type: 'asc' },
        },
        languages: {
          select: { languageCode: true, level: true, required: true },
          orderBy: [{ required: 'desc' }, { languageCode: 'asc' }],
        },
      },
    });
    if (!vacancy) throw new NotFoundException('Job not found');
    // The same live number the recruiter sees, and the id it was looked up by
    // never leaves the service.
    const [withCount] = await this.withApplicantCounts([vacancy]);
    return withCount;
  }

  /**
   * Authenticated direct application:
   *
   *   CandidateAccount -> OPEN vacancy -> org-side Candidate (one per account
   *   per organization, reused) -> Application(source=DIRECT).
   *
   * ## What an application IS
   *
   * Pure metadata: the relationship between one candidate and one vacancy,
   * with a status and an attempt history. NOTHING is copied. The candidate's
   * evidence — every personal file (≤ 3) and professional link (≤ 3) — stays
   * exactly where it lives, under the candidate's account, and recruiters
   * read it through the vacancy-contextual authorization chain
   * (owned vacancy -> legitimate applicant -> CURRENT evidence). Applying to
   * twenty vacancies stores one resume, one corpus of vectors, and twenty
   * application rows.
   *
   * A resume is still REQUIRED to apply: an application is an offer of
   * evidence, and the product has always required the document at its core.
   */
  async apply(userId: string, publicSlug: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { publicSlug, status: VacancyStatus.OPEN },
      select: { id: true, organizationId: true },
    });
    if (!vacancy) throw new NotFoundException('Job not found');

    const account = await this.candidateAccounts.requireAccount(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, email: true },
    });

    // The profile resume must exist as a live personal document RIGHT NOW —
    // not merely be pointed at.
    const resume = account.resumeDocumentId
      ? await this.prisma.document.findFirst({
          where: {
            id: account.resumeDocumentId,
            candidateAccountId: account.id,
            organizationId: null,
          },
          select: { id: true },
        })
      : null;
    if (!resume) {
      throw new UnprocessableEntityException(
        'Upload a resume to your candidate account before applying',
      );
    }

    // Duplicate policy: one LIVE application per vacancy per candidate account.
    //
    // A rejection ends an attempt; it does not ban the person from the role,
    // so a previous REJECTED application no longer blocks a new one — the old
    // row is left exactly as it is and the new attempt becomes a separate
    // application with its own id, status and createdAt. Every other status,
    // WITHDRAWN included, still blocks: this is deliberately about rejection
    // only, and the recruiter can still move a withdrawn one back by hand.
    //
    // The database enforces the same rule under concurrency through a partial
    // unique index (status <> 'REJECTED'); this check exists to answer with a
    // clean 409 instead of a constraint error.
    const existingCandidate = await this.prisma.candidate.findUnique({
      where: {
        organizationId_candidateAccountId: {
          organizationId: vacancy.organizationId,
          candidateAccountId: account.id,
        },
      },
      select: { id: true },
    });
    if (existingCandidate) {
      const liveApplication = await this.prisma.application.findFirst({
        where: {
          vacancyId: vacancy.id,
          candidateId: existingCandidate.id,
          status: { not: ApplicationStatus.REJECTED },
        },
        select: { id: true },
      });
      if (liveApplication) {
        throw new ConflictException('You have already applied to this job');
      }
    }

    const result = await this.prisma
      .$transaction(async (tx) => {
        const candidate = await tx.candidate.upsert({
          where: {
            organizationId_candidateAccountId: {
              organizationId: vacancy.organizationId,
              candidateAccountId: account.id,
            },
          },
          // An existing org-side record is reused as-is: recruiters may have
          // enriched it, and an application must not overwrite their data.
          update: {},
          create: {
            organizationId: vacancy.organizationId,
            candidateAccountId: account.id,
            fullName: user.fullName,
            email: user.email,
            phone: account.phone,
            location: account.location,
            currentTitle: account.headline,
          },
          select: { id: true },
        });

        const created = await tx.application.create({
          data: {
            vacancyId: vacancy.id,
            candidateId: candidate.id,
            status: ApplicationStatus.NEW,
            source: ApplicationSource.DIRECT,
          },
          select: {
            id: true,
            status: true,
            source: true,
            createdAt: true,
            vacancy: {
              select: {
                publicSlug: true,
                title: true,
                organization: { select: { name: true } },
              },
            },
          },
        });

        return { application: created, candidateId: candidate.id };
      })
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') {
          // Concurrent double-submit lost the race on the partial unique index
          // over live attempts — the other request created the application.
          throw new ConflictException('You have already applied to this job');
        }
        throw error;
      });

    // The application row is durably committed by now — tell the vacancy's
    // creator. (Never before: a rolled-back apply must produce no ghost
    // notification.)
    this.events.publish('application.created', {
      organizationId: vacancy.organizationId,
      vacancyId: vacancy.id,
      applicationId: result.application.id,
      candidateId: result.candidateId,
    });

    return result.application;
  }
}

/**
 * Advertisement-safe fields only — what a job CARD needs.
 *
 * Structured facts a seeker filters on (pay, where, how remote, how senior)
 * belong here; the long tail (visa detail, certifications, lifecycle) is
 * detail-only, so a 20-job list does not carry twenty full job profiles.
 *
 * Nothing internal is selectable through this constant: no creator, no
 * applicant counts, no organizationId, no vacancy id.
 */
const PUBLIC_LIST_SELECT = {
  publicSlug: true,
  title: true,
  department: true,
  location: true,
  employmentType: true,
  experienceLevel: true,
  createdAt: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  payPeriod: true,
  salaryNegotiable: true,
  country: true,
  region: true,
  city: true,
  workMode: true,
  seniorityLevel: true,
  organization: { select: { name: true } },
} as const;

/**
 * A list row, plus the columns ordering it needs.
 *
 * `id` and `createdAt` are read but never returned: the id feeds the applicant
 * count and is stripped before the row leaves the service, and `createdAt` is
 * both a card field and the ordering tie-break. The rest is
 * `JOB_FEATURE_SELECT` — the exact input `normalizedJobFeatures` reads — so
 * Find Jobs ranks a job from the same normalized shape AI Job Match does,
 * without pulling every description and requirement row to read a work mode.
 */
const SEARCH_LIST_SELECT = {
  ...PUBLIC_LIST_SELECT,
  ...JOB_FEATURE_SELECT,
} as const;

/**
 * The full structured job profile a candidate sees on the detail page.
 *
 * Work-authorization fields are advertisement content, not internal data: they
 * are the single most decision-changing fact for a candidate who needs a visa,
 * and hiding them would make the page less honest, not more private.
 */
const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_LIST_SELECT,
  description: true,
  officeDaysPerWeek: true,
  remoteCountriesAllowed: true,
  foreignApplicantsAccepted: true,
  visaSponsorship: true,
  existingWorkAuthorizationRequired: true,
  eligibleVisaTypes: true,
  citizenshipRequirement: true,
  eligibleNationalities: true,
  minExperienceYears: true,
  preferredExperienceYears: true,
  requiredEducation: true,
  preferredEducation: true,
  requiredCertifications: true,
  preferredCertifications: true,
  domainExperience: true,
  benefits: true,
  benefitsOther: true,
  applicationDeadline: true,
  expectedStartDate: true,
  openingsCount: true,
  hiringUrgency: true,
  contractDurationMonths: true,
} as const;

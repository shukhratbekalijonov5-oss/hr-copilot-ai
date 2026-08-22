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

/**
 * Public job discovery and authenticated direct application.
 *
 * Discovery exposes ONLY OPEN vacancies and only advertisement-safe fields:
 * no applicant counts, no creator, no internal ids beyond the public slug, no
 * processing or evidence data. DRAFT/CLOSED/ARCHIVED vacancies do not exist as
 * far as these endpoints are concerned — an unknown or non-OPEN slug is a 404.
 */
@Injectable()
export class PublicJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateAccounts: CandidateAccountService,
    private readonly events: DomainEventsService,
  ) {}

  async list(query: QueryPublicJobsDto): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VacancyWhereInput = {
      status: VacancyStatus.OPEN,
      ...(query.location ? { location: query.location } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vacancy.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: PUBLIC_LIST_SELECT,
      }),
      this.prisma.vacancy.count({ where }),
    ]);
    return paginated(data, total, query.page, query.limit);
  }

  async detail(publicSlug: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      // Status is part of the lookup: a CLOSED job's slug 404s exactly like a
      // slug that never existed.
      where: { publicSlug, status: VacancyStatus.OPEN },
      select: {
        ...PUBLIC_LIST_SELECT,
        description: true,
        requirements: {
          select: { text: true, type: true, required: true },
          orderBy: { type: 'asc' },
        },
      },
    });
    if (!vacancy) throw new NotFoundException('Job not found');
    return vacancy;
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

/** Advertisement-safe fields only. */
const PUBLIC_LIST_SELECT = {
  publicSlug: true,
  title: true,
  department: true,
  location: true,
  employmentType: true,
  experienceLevel: true,
  createdAt: true,
  organization: { select: { name: true } },
} as const;

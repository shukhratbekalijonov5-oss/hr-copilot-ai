import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { signAvatarUrl } from '../account/avatar-url';
import { TenantService } from '../common/tenant/tenant.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { ChatService } from '../chat/chat.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { OwnedVacancyService } from '../common/vacancy-access/owned-vacancy.service';
import { vacancyNotOwned } from '../common/vacancy-access/vacancy-policy';
import { APPLICANT_APPLICATION_SCOPE } from '../common/vacancy-access/applicant-scope';
import { uniqueApplicantCounts } from '../common/vacancy-access/applicant-counts';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { VacancyStatus } from '../generated/prisma/enums';
import { buildPublicSlug } from './vacancy-slug.util';
import {
  assertVacancyProfile,
  normalizeVacancyProfile,
  type VacancyProfileShape,
} from './vacancy-profile.validation';
import type { VacancyLanguageRequirementDto } from './dto/vacancy-language.dto';
import type { Prisma } from '../generated/prisma/client';
import type { CreateVacancyDto } from './dto/create-vacancy.dto';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto';
import type { QueryVacanciesDto } from './dto/query-vacancies.dto';
import type { QueryVacancyCandidatesDto } from './dto/vacancy-candidates.dto';
import type {
  CreateJobRequirementDto,
  UpdateJobRequirementDto,
} from './dto/job-requirement.dto';

/**
 * Vacancy CRUD under the vacancy-scoped workspace rule (see
 * common/vacancy-access/vacancy-policy.ts): the org-wide CATALOG stays
 * readable to every member, but every MUTATION — and every vacancy-context
 * operation — requires the caller to be the vacancy's creator. There is no
 * product cap on how many vacancies one HR user may create.
 */
@Injectable()
export class VacanciesService {
  private readonly logger = new Logger(VacanciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tenant: TenantService,
    private readonly producer: DocumentProcessingProducer,
    private readonly chat: ChatService,
    private readonly events: DomainEventsService,
    private readonly ownedVacancies: OwnedVacancyService,
  ) {}

  /**
   * THE vacancy-lifecycle invariant: a vacancy that stops being live loses
   * ALL of its interview conversations and messages, permanently.
   *
   * Centralized here — every status-mutating path (the /close and /archive
   * endpoints, and PATCH /vacancies/:id whose DTO also accepts `status`) runs
   * through this method, so no route can close a vacancy while leaving chats
   * behind. Deletion is a HARD delete executed in the SAME database
   * transaction as the status change: either both commit or neither does.
   *
   * ARCHIVED is treated like CLOSED on purpose: OPEN→ARCHIVED is reachable
   * directly and equally ends the hiring relationship — leaving chats alive
   * there would be a bypass in all but name. (The purge is idempotent, so
   * CLOSED→ARCHIVED simply deletes nothing.)
   *
   * Realtime/room cleanup is fanned out AFTER commit via domain events; if
   * the process dies in between, connected clients merely keep an open room
   * whose rows are gone — every subsequent read or send re-checks the
   * database and fails, so no message can outlive the vacancy.
   */
  private async applyStatusChange(
    organizationId: string,
    id: string,
    previousStatus: VacancyStatus,
    data: Prisma.VacancyUpdateInput,
    newStatus: VacancyStatus,
    include?: Prisma.VacancyInclude,
  ) {
    const ends =
      newStatus === VacancyStatus.CLOSED ||
      newStatus === VacancyStatus.ARCHIVED;

    let deletedConversationIds: string[] = [];
    const vacancy = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.vacancy.update({
        where: { id },
        data,
        ...(include ? { include } : {}),
      });
      if (ends) {
        deletedConversationIds = await this.chat.purgeVacancyConversationsTx(
          tx,
          id,
        );
      }
      return updated;
    });

    if (ends && deletedConversationIds.length > 0) {
      this.events.publish('chat.conversations.deleted', {
        vacancyId: id,
        reason: 'VACANCY_CLOSED',
        vacancyStatus: newStatus,
        conversationIds: deletedConversationIds,
      });
    }
    if (
      newStatus === VacancyStatus.CLOSED &&
      previousStatus !== VacancyStatus.CLOSED
    ) {
      this.events.publish('vacancy.closed', {
        organizationId,
        vacancyId: id,
        deletedConversationIds,
      });
    }
    return vacancy;
  }

  /**
   * Queues reconciliation of this vacancy with the candidate-discoverable job
   * index. Fired after EVERY vacancy mutation; the worker reads the current
   * database state (OPEN -> index candidate-visible fields, anything else ->
   * remove), so repeated/out-of-order syncs converge. Best-effort: the index
   * is a retrieval accelerator, and a queue outage must not fail recruiter
   * CRUD.
   */
  private async queueIndexSync(vacancyId: string): Promise<void> {
    try {
      await this.producer.enqueueVacancyIndexSync({ vacancyId });
    } catch (error) {
      this.logger.warn(
        `Vacancy ${vacancyId} index sync could not be queued: ${(error as Error).message}`,
      );
    }
  }

  /**
   * The stored fields the cross-field rules read. A PATCH is judged against
   * the row as it WILL BE, so the current values have to be in hand before a
   * fragment can be validated.
   */
  private static readonly PROFILE_SELECT = {
    salaryMin: true,
    salaryMax: true,
    currency: true,
    workMode: true,
    officeDaysPerWeek: true,
    remoteCountriesAllowed: true,
    minExperienceYears: true,
    preferredExperienceYears: true,
    citizenshipRequirement: true,
    eligibleNationalities: true,
    benefits: true,
    benefitsOther: true,
  } as const;

  /**
   * Turns a create/update payload into the columns to write.
   *
   * Three things happen here, in this order, and the order is the point:
   *
   *  1. only the keys the client actually SENT become a patch — an absent key
   *     means "leave it alone", never "set it to null";
   *  2. the patch is merged onto the stored row and normalized, so a value the
   *     row's own shape makes meaningless (office days on a REMOTE job) is
   *     cleared rather than left to contradict the rest;
   *  3. the merged, normalized result is validated. Validating the fragment
   *     instead would let a PATCH that only lowers `salaryMax` produce a
   *     stored row where min > max.
   *
   * Anything the normalizer cleared is written back explicitly — otherwise the
   * database would keep the stale value the API just decided was meaningless.
   */
  private buildProfileWrite(
    stored: VacancyProfileShape,
    dto: CreateVacancyDto | UpdateVacancyDto,
  ): {
    data: Record<string, unknown>;
    languages?: VacancyLanguageRequirementDto[];
  } {
    const { languages, ...scalars } = dto as CreateVacancyDto;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(scalars)) {
      if (value !== undefined) patch[key] = value;
    }

    for (const key of VacanciesService.DATE_FIELDS) {
      if (typeof patch[key] === 'string') {
        patch[key] = calendarDate(patch[key]);
      }
    }

    const merged = { ...stored, ...patch };
    const normalized = normalizeVacancyProfile(merged);
    assertVacancyProfile(normalized);

    for (const key of Object.keys(
      VacanciesService.PROFILE_SELECT,
    ) as (keyof VacancyProfileShape)[]) {
      if (JSON.stringify(normalized[key]) !== JSON.stringify(merged[key])) {
        patch[key] = normalized[key];
      }
    }

    return { data: patch, languages };
  }

  /**
   * Fields a date input fills in. They arrive as `yyyy-mm-dd`, which Prisma
   * refuses — it wants a full ISO-8601 DateTime.
   */
  private static readonly DATE_FIELDS = [
    'applicationDeadline',
    'expectedStartDate',
  ] as const;

  /**
   * Language requirements are REPLACED as a set, never merged row by row.
   *
   * `undefined` (the field was not sent) leaves them untouched; `[]` clears
   * them. The set is at most a handful of rows, and replace-all is the only
   * semantics that needs no ids the create form has never seen.
   */
  private static languageRows(languages: VacancyLanguageRequirementDto[]) {
    return languages.map((language) => ({
      languageCode: language.languageCode,
      level: language.level,
      required: language.required ?? true,
    }));
  }

  async create(
    organizationId: string,
    createdById: string,
    dto: CreateVacancyDto,
  ) {
    const organization = this.tenant.assertFound(
      await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true },
      }),
      'Organization',
    );

    // A create has no stored row to merge onto, so the payload IS the merged
    // result — but it runs through the same coherence pass as an edit, so the
    // two paths can never disagree about what a valid vacancy looks like.
    const { data, languages } = this.buildProfileWrite({}, dto);

    // The random suffix makes a collision vanishingly rare; the retry exists
    // so that even that case never surfaces to the caller.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const vacancy = await this.prisma.vacancy.create({
          data: {
            ...data,
            status: dto.status ?? VacancyStatus.DRAFT,
            publicSlug: buildPublicSlug(dto.title, organization.slug),
            organizationId,
            createdById,
            ...(languages
              ? {
                  languages: {
                    create: VacanciesService.languageRows(languages),
                  },
                }
              : {}),
          } as Prisma.VacancyUncheckedCreateInput,
          include: { requirements: true, languages: LANGUAGE_ORDER },
        });
        await this.queueIndexSync(vacancy.id);
        return vacancy;
      } catch (error) {
        if (attempt >= 3 || !isUniqueViolation(error, 'publicSlug')) {
          throw error;
        }
      }
    }
  }

  async findAll(
    organizationId: string,
    query: QueryVacanciesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VacancyWhereInput = {
      // Tenant filter first and always — never overridable by query input.
      ...this.tenant.scope(organizationId),
      ...(query.status ? { status: query.status } : {}),
      ...(query.department ? { department: query.department } : {}),
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
        include: {
          _count: {
            select: {
              // Applicants only — the same universe every other surface shows.
              applications: { where: APPLICANT_APPLICATION_SCOPE },
              requirements: true,
            },
          },
        },
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    const candidates = await this.candidateCounts(data.map((v) => v.id));
    return paginated(
      data.map((v) => ({ ...v, candidateCount: candidates.get(v.id) ?? 0 })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * MY VACANCIES — the selector source for the whole HR workspace. Only
   * vacancies the caller personally created in the active organization, slim
   * rows only (id/title/status/createdAt + counts): selectors never need the
   * full vacancy object.
   */
  async findMine(
    organizationId: string,
    userId: string,
    query: QueryVacanciesDto,
  ): Promise<PaginatedResult<unknown>> {
    const where: Prisma.VacancyWhereInput = {
      ...this.tenant.scope(organizationId),
      createdById: userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { title: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.vacancy.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              // Applicants only — the same universe every other surface shows.
              applications: { where: APPLICANT_APPLICATION_SCOPE },
              requirements: true,
            },
          },
        },
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    const candidates = await this.candidateCounts(data.map((v) => v.id));
    return paginated(
      data.map((v) => ({
        id: v.id,
        title: v.title,
        status: v.status,
        createdAt: v.createdAt,
        candidateCount: candidates.get(v.id) ?? 0,
        requirementCount: v._count.requirements,
      })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * How many PEOPLE are attached to each vacancy.
   *
   * Delegates to the shared counter so a recruiter's number and the number a
   * candidate reads on the job page are the same number, computed once. See
   * `uniqueApplicantCounts`.
   */
  private candidateCounts(vacancyIds: string[]): Promise<Map<string, number>> {
    return uniqueApplicantCounts(this.prisma, vacancyIds);
  }

  /**
   * The APPLICANTS of ONE selected (owned) vacancy — the source for the
   * Candidates page, the Compare picker and Candidate Detail context.
   *
   * One row per application, and every row is a real application: a person
   * with a CandidateAccount who applied to this vacancy themselves
   * (APPLICANT_APPLICATION_SCOPE). Recruiter-created candidates and
   * recruiter-made associations no longer exist as a feature, and the
   * historical ones are filtered out here rather than shown with a "manual"
   * label. Only org-side Candidate fields are exposed; CandidateAccount
   * internals never appear.
   */
  async listVacancyCandidates(
    organizationId: string,
    userId: string,
    vacancyId: string,
    query: QueryVacancyCandidatesDto,
  ): Promise<PaginatedResult<unknown>> {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);

    const where: Prisma.ApplicationWhereInput = {
      vacancyId,
      // Applicants only, and belt-and-braces tenancy with the ownership check
      // above — associations can only ever point at same-org candidates, but
      // the filter keeps that invariant local and unconditional.
      source: APPLICANT_APPLICATION_SCOPE.source,
      candidate: {
        ...this.tenant.scope(organizationId),
        ...APPLICANT_APPLICATION_SCOPE.candidate,
        ...(query.search
          ? {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      ...(query.status ? { status: query.status } : {}),
    };

    // ONE ROW PER PERSON, not per attempt.
    //
    // Since reapply-after-rejection a candidate can hold several applications
    // to one vacancy, and paginating over applications renders that person
    // once per attempt — the list would then disagree with the
    // `candidateCount` beside it (which already counts distinct people), and
    // the Compare picker fed from this list would let someone be compared
    // against themselves.
    //
    // Grouping happens in the database and transfers only (candidateId,
    // latest attempt) pairs, so the page stays cheap. Nothing is deduplicated
    // in the DATA: every attempt still exists and every attempt-level
    // endpoint still returns all of them — this is a view decision.
    const groups = await this.prisma.application.groupBy({
      by: ['candidateId'],
      where,
      _max: { createdAt: true },
    });
    const total = groups.length;

    // Newest attempt first, matching the previous ordering as closely as one
    // row per person allows.
    const ordered = groups
      .slice()
      .sort(
        (a, b) =>
          (b._max.createdAt?.getTime() ?? 0) -
          (a._max.createdAt?.getTime() ?? 0),
      )
      .slice(query.skip, query.skip + query.limit);

    // The CURRENT attempt for each person on this page: the newest one, which
    // is the same attempt Candidate Detail treats as live.
    const pageApplications = ordered.length
      ? await this.prisma.application.findMany({
          where: {
            ...where,
            candidateId: { in: ordered.map((group) => group.candidateId) },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            createdAt: true,
            candidateId: true,
            candidate: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                location: true,
                currentTitle: true,
                totalExperienceYears: true,
                _count: { select: { evidence: true } },
                // The LIVE person: current name/email/avatar and CURRENT
                // document count — the row must show who they are NOW, not a
                // first-apply-time copy of them.
                candidateAccount: {
                  select: {
                    user: {
                      select: {
                        fullName: true,
                        email: true,
                        avatarStorageKey: true,
                      },
                    },
                    _count: {
                      select: {
                        personalDocuments: { where: { organizationId: null } },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      : [];

    const latestByCandidate = new Map<
      string,
      (typeof pageApplications)[number]
    >();
    for (const application of pageApplications) {
      // Ordered newest-first, so the first one seen per candidate is the live
      // attempt and later (older) ones are skipped.
      if (!latestByCandidate.has(application.candidateId)) {
        latestByCandidate.set(application.candidateId, application);
      }
    }
    const rows = ordered
      .map((group) => latestByCandidate.get(group.candidateId))
      .filter(
        (row): row is (typeof pageApplications)[number] => row !== undefined,
      );

    return paginated(
      await Promise.all(
        rows.map(async (row) => {
          const account = row.candidate.candidateAccount;
          return {
            candidate: {
              id: row.candidate.id,
              fullName: account?.user.fullName ?? row.candidate.fullName,
              email: account?.user.email ?? row.candidate.email,
              phone: row.candidate.phone,
              location: row.candidate.location,
              currentTitle: row.candidate.currentTitle,
              totalExperienceYears: row.candidate.totalExperienceYears,
              avatarUrl: await signAvatarUrl(
                this.storage,
                account?.user.avatarStorageKey ?? null,
              ),
              documentCount: account?._count.personalDocuments ?? 0,
              evidenceCount: row.candidate._count.evidence,
            },
            application: {
              id: row.id,
              status: row.status,
              createdAt: row.createdAt,
            },
          };
        }),
      ),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(organizationId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        requirements: { orderBy: { type: 'asc' } },
        languages: LANGUAGE_ORDER,
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: {
          select: { applications: { where: APPLICANT_APPLICATION_SCOPE } },
        },
      },
    });
    const found = this.tenant.assertFound(vacancy, 'Vacancy');
    const candidates = await this.candidateCounts([found.id]);
    return { ...found, candidateCount: candidates.get(found.id) ?? 0 };
  }

  async update(
    organizationId: string,
    userId: string,
    id: string,
    dto: UpdateVacancyDto,
  ) {
    // Creator-only mutation; the DTO can carry `status`, so a plain PATCH is
    // also a lifecycle path — it must uphold the same close-deletes-chats
    // invariant as /close.
    const current = await this.ownedVacancies.requireOwned(
      userId,
      organizationId,
      id,
    );

    // Ownership is settled; now judge the EDIT against the row it lands on.
    const stored = await this.prisma.vacancy.findUniqueOrThrow({
      where: { id },
      select: VacanciesService.PROFILE_SELECT,
    });
    const { data, languages } = this.buildProfileWrite(stored, dto);

    const vacancy = await this.applyStatusChange(
      organizationId,
      id,
      current.status,
      {
        ...data,
        // Replace-all: absent leaves the set alone, [] clears it.
        ...(languages
          ? {
              languages: {
                deleteMany: {},
                create: VacanciesService.languageRows(languages),
              },
            }
          : {}),
      },
      dto.status ?? current.status,
      { requirements: true, languages: LANGUAGE_ORDER },
    );
    await this.queueIndexSync(id);
    return vacancy;
  }

  /** Explicit lifecycle transition; always a human action, creator-only. */
  async setStatus(
    organizationId: string,
    userId: string,
    id: string,
    status: VacancyStatus,
  ) {
    const vacancy = await this.ownedVacancies.requireOwned(
      userId,
      organizationId,
      id,
    );

    if (vacancy.status === status) return this.findOne(organizationId, id);
    if (vacancy.status === VacancyStatus.ARCHIVED) {
      throw new BadRequestException('An archived vacancy cannot change status');
    }

    const updated = await this.applyStatusChange(
      organizationId,
      id,
      vacancy.status,
      { status },
      status,
    );
    await this.queueIndexSync(id);
    return updated;
  }

  async remove(organizationId: string, userId: string, id: string) {
    const result = await this.removeOwned(organizationId, userId, [id]);
    return { id: result.deletedIds[0], deleted: true };
  }

  /**
   * Bulk delete of an EXPLICIT selection of the caller's own vacancies.
   *
   * All-or-nothing by design: the batch is validated up front (every id must
   * exist in the active organization — else 404, tenant nondisclosure — and
   * every one must have been created by the caller — else 403
   * VACANCY_NOT_OWNED) and nothing is deleted unless everything passes. A
   * mixed own/foreign selection therefore deletes NOTHING.
   *
   * There is deliberately no "delete everything I own" mode — the client
   * sends the ids it showed the user and got confirmed.
   */
  async bulkRemove(organizationId: string, userId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const result = await this.removeOwned(organizationId, userId, unique);
    return {
      deletedIds: result.deletedIds,
      deletedCount: result.deletedIds.length,
    };
  }

  /**
   * Shared deletion core (single + bulk). DELETE differs from CLOSE: close is
   * a reversible-in-spirit lifecycle stage that keeps the record; delete
   * removes the vacancy row and everything hanging off it. Both share one
   * invariant: no conversation survives. The purge runs through the SAME
   * ChatService helper the close path uses, inside the SAME transaction as
   * the row deletions, so "vacancy gone but chat alive" is unrepresentable —
   * the FK cascade would also remove the rows, but the established purge
   * service stays the single owner of that lifecycle.
   */
  private async removeOwned(
    organizationId: string,
    userId: string,
    ids: string[],
  ): Promise<{ deletedIds: string[] }> {
    const found = await this.prisma.vacancy.findMany({
      where: { id: { in: ids }, ...this.tenant.scope(organizationId) },
      select: {
        id: true,
        createdById: true,
        // Captured BEFORE deletion: the title and the applicant set must
        // outlive the rows so candidates can still be told WHAT was deleted.
        title: true,
        applications: {
          where: APPLICANT_APPLICATION_SCOPE,
          select: {
            candidate: {
              select: {
                id: true,
                candidateAccount: { select: { userId: true } },
              },
            },
          },
        },
      },
    });
    if (found.length !== ids.length) {
      // At least one id is unknown or belongs to another organization.
      throw new NotFoundException('Vacancy not found');
    }
    if (found.some((v) => v.createdById !== userId)) {
      throw vacancyNotOwned();
    }

    const deletedConversationsByVacancy = new Map<string, string[]>();
    await this.prisma.$transaction(async (tx) => {
      for (const vacancyId of ids) {
        const conversationIds = await this.chat.purgeVacancyConversationsTx(
          tx,
          vacancyId,
        );
        if (conversationIds.length > 0) {
          deletedConversationsByVacancy.set(vacancyId, conversationIds);
        }
      }
      await tx.vacancy.deleteMany({ where: { id: { in: ids } } });
    });

    // After commit: evict connected chat clients and reconcile the job index.
    for (const [vacancyId, conversationIds] of deletedConversationsByVacancy) {
      this.events.publish('chat.conversations.deleted', {
        vacancyId,
        reason: 'VACANCY_CLOSED',
        vacancyStatus: null,
        conversationIds,
      });
    }
    // One event per deleted vacancy, only now that the transaction committed
    // (a rolled-back delete publishes nothing). Recipients are this vacancy's
    // applicants, each of whom owns the account they applied with.
    for (const vacancy of found) {
      this.events.publish('vacancy.deleted', {
        organizationId,
        vacancyId: vacancy.id,
        vacancyTitle: vacancy.title,
        actorUserId: userId,
        recipients: vacancy.applications.flatMap((a) =>
          a.candidate.candidateAccount
            ? [
                {
                  userId: a.candidate.candidateAccount.userId,
                  candidateId: a.candidate.id,
                },
              ]
            : [],
        ),
      });
    }
    for (const vacancyId of ids) {
      await this.queueIndexSync(vacancyId);
    }
    this.logger.log(
      `Deleted ${ids.length} vacanc${ids.length === 1 ? 'y' : 'ies'} for user ${userId}`,
    );
    return { deletedIds: ids };
  }

  // -- Job requirements ----------------------------------------------------
  // Requirements inherit tenancy from their vacancy, so every method resolves
  // the parent vacancy under the org filter before touching the child row.

  async addRequirement(
    organizationId: string,
    userId: string,
    vacancyId: string,
    dto: CreateJobRequirementDto,
  ) {
    // Requirements are part of editing the vacancy — creator-only.
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    const requirement = await this.prisma.jobRequirement.create({
      data: { ...dto, vacancyId },
    });
    await this.queueIndexSync(vacancyId);
    return requirement;
  }

  async listRequirements(organizationId: string, vacancyId: string) {
    await this.assertVacancyInOrg(organizationId, vacancyId);
    return this.prisma.jobRequirement.findMany({ where: { vacancyId } });
  }

  async updateRequirement(
    organizationId: string,
    userId: string,
    vacancyId: string,
    requirementId: string,
    dto: UpdateJobRequirementDto,
  ) {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    await this.assertRequirementInOrg(organizationId, vacancyId, requirementId);
    const requirement = await this.prisma.jobRequirement.update({
      where: { id: requirementId },
      data: dto,
    });
    await this.queueIndexSync(vacancyId);
    return requirement;
  }

  async removeRequirement(
    organizationId: string,
    userId: string,
    vacancyId: string,
    requirementId: string,
  ) {
    await this.ownedVacancies.requireOwned(userId, organizationId, vacancyId);
    await this.assertRequirementInOrg(organizationId, vacancyId, requirementId);
    await this.prisma.jobRequirement.delete({ where: { id: requirementId } });
    await this.queueIndexSync(vacancyId);
    return { id: requirementId, deleted: true };
  }

  private async assertVacancyInOrg(organizationId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      select: { id: true },
    });
    return this.tenant.assertFound(vacancy, 'Vacancy');
  }

  private async assertRequirementInOrg(
    organizationId: string,
    vacancyId: string,
    requirementId: string,
  ) {
    const requirement = await this.prisma.jobRequirement.findFirst({
      where: {
        id: requirementId,
        vacancyId,
        vacancy: this.tenant.scope(organizationId),
      },
      select: { id: true },
    });
    return this.tenant.assertFound(requirement, 'Job requirement');
  }
}

/** True when a Prisma P2002 unique violation involves the given column. */
function isUniqueViolation(error: unknown, column: string): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== 'P2002') return false;
  const target = e.meta?.target;
  return Array.isArray(target)
    ? target.includes(column)
    : typeof target === 'string' && target.includes(column);
}

/**
 * One stable order for language requirements everywhere they are read:
 * must-haves first, then alphabetically by code. Without it Postgres is free
 * to return them in any order and the same vacancy renders differently
 * between two page loads.
 */
const LANGUAGE_ORDER: {
  orderBy: Prisma.VacancyLanguageRequirementOrderByWithRelationInput[];
} = { orderBy: [{ required: 'desc' }, { languageCode: 'asc' }] };

/**
 * A calendar date as an instant.
 *
 * "Apply by 30 September" is a DAY, not a moment, but the column is a
 * DateTime. Midnight UTC is the representation chosen because it is the only
 * one that survives the round trip the edit form depends on: the API renders
 * it back with `.slice(0, 10)` and must produce the same `yyyy-mm-dd` the
 * recruiter typed, in every timezone. A local-midnight or end-of-day value
 * would shift the date by one for readers on the other side of UTC.
 *
 * Anything already carrying a time is passed through untouched.
 */
function calendarDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
}

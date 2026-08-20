import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../common/tenant/tenant.service';
import { DocumentProcessingProducer } from '../queue/document-processing.producer';
import { ChatService } from '../chat/chat.service';
import { DomainEventsService } from '../common/events/domain-events.service';
import { paginated, type PaginatedResult } from '../common/dto/pagination.dto';
import { VacancyStatus } from '../generated/prisma/enums';
import { buildPublicSlug } from './vacancy-slug.util';
import type { Prisma } from '../generated/prisma/client';
import type { CreateVacancyDto } from './dto/create-vacancy.dto';
import type { UpdateVacancyDto } from './dto/update-vacancy.dto';
import type { QueryVacanciesDto } from './dto/query-vacancies.dto';
import type {
  CreateJobRequirementDto,
  UpdateJobRequirementDto,
} from './dto/job-requirement.dto';

@Injectable()
export class VacanciesService {
  private readonly logger = new Logger(VacanciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly producer: DocumentProcessingProducer,
    private readonly chat: ChatService,
    private readonly events: DomainEventsService,
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

    // The random suffix makes a collision vanishingly rare; the retry exists
    // so that even that case never surfaces to the caller.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const vacancy = await this.prisma.vacancy.create({
          data: {
            ...dto,
            status: dto.status ?? VacancyStatus.DRAFT,
            publicSlug: buildPublicSlug(dto.title, organization.slug),
            organizationId,
            createdById,
          },
          include: { requirements: true },
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
          _count: { select: { applications: true, requirements: true } },
        },
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(organizationId: string, id: string) {
    const vacancy = await this.prisma.vacancy.findFirst({
      where: { id, ...this.tenant.scope(organizationId) },
      include: {
        requirements: { orderBy: { type: 'asc' } },
        createdBy: { select: { id: true, fullName: true, email: true } },
        _count: { select: { applications: true } },
      },
    });
    return this.tenant.assertFound(vacancy, 'Vacancy');
  }

  async update(organizationId: string, id: string, dto: UpdateVacancyDto) {
    // The DTO can carry `status`, so a plain PATCH is also a lifecycle path —
    // it must uphold the same close-deletes-chats invariant as /close.
    const current = this.tenant.assertFound(
      await this.prisma.vacancy.findFirst({
        where: { id, ...this.tenant.scope(organizationId) },
        select: { id: true, status: true },
      }),
      'Vacancy',
    );

    const vacancy = await this.applyStatusChange(
      organizationId,
      id,
      current.status,
      dto,
      dto.status ?? current.status,
      { requirements: true },
    );
    await this.queueIndexSync(id);
    return vacancy;
  }

  /** Explicit lifecycle transition; always a human action. */
  async setStatus(organizationId: string, id: string, status: VacancyStatus) {
    const vacancy = this.tenant.assertFound(
      await this.prisma.vacancy.findFirst({
        where: { id, ...this.tenant.scope(organizationId) },
        select: { id: true, status: true },
      }),
      'Vacancy',
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

  async remove(organizationId: string, id: string) {
    await this.assertVacancyInOrg(organizationId, id);
    // Conversations/messages die with the vacancy via FK cascade; collect the
    // ids first so connected chat clients can be evicted from dead rooms.
    const conversations = await this.prisma.conversation.findMany({
      where: { vacancyId: id },
      select: { id: true },
    });
    await this.prisma.vacancy.delete({ where: { id } });
    if (conversations.length > 0) {
      this.events.publish('chat.conversations.deleted', {
        vacancyId: id,
        reason: 'VACANCY_CLOSED',
        vacancyStatus: null,
        conversationIds: conversations.map((c) => c.id),
      });
    }
    await this.queueIndexSync(id);
    return { id, deleted: true };
  }

  // -- Job requirements ----------------------------------------------------
  // Requirements inherit tenancy from their vacancy, so every method resolves
  // the parent vacancy under the org filter before touching the child row.

  async addRequirement(
    organizationId: string,
    vacancyId: string,
    dto: CreateJobRequirementDto,
  ) {
    await this.assertVacancyInOrg(organizationId, vacancyId);
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
    vacancyId: string,
    requirementId: string,
    dto: UpdateJobRequirementDto,
  ) {
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
    vacancyId: string,
    requirementId: string,
  ) {
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

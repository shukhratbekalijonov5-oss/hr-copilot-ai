import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import {
  ExternalJobCardService,
  type ExternalJobCard,
} from './external-job-card.service';
import { CandidateExternalFlagsService } from './candidate-external-flags.service';
import {
  ALREADY_TRACKED_CODE,
  MAX_APPLIED_AT_FUTURE_MS,
} from './external-application.policy';
import type { TrackExternalApplicationDto } from './dto/track-external-application.dto';
import type { UpdateExternalApplicationDto } from './dto/track-external-application.dto';
import type { ExternalApplicationsQueryDto } from './dto/external-applications-query.dto';

export interface ExternalApplicationTracker {
  id: string;
  externalJobId: string;
  status: string;
  appliedAt: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrackedApplicationRow extends ExternalApplicationTracker {
  job: (ExternalJobCard & { saved: boolean }) | null;
}

export interface TrackedApplicationsPage {
  page: number;
  pageSize: number;
  total: number;
  asOf: Date;
  results: TrackedApplicationRow[];
}

/**
 * The candidate's own record of applying to external jobs.
 *
 * ## Not an Application, structurally
 *
 * This service touches exactly two tables it owns plus reads of ExternalJob.
 * It cannot create an internal `Application` — it never imports that model —
 * and nothing here ever will, because an internal Application is a
 * relationship with a vacancy THIS product hosts, and these applications
 * happened on someone else's website, out of our sight.
 *
 * ## Only the candidate writes
 *
 * Every state in this table exists because the candidate stated it. Opening
 * the apply link changes nothing here (there is no code path from a link to
 * this service); a provider marking the job closed changes nothing here; and
 * no status is ever inferred. "The system must not claim the employer
 * confirmed anything" is implemented by having no writer other than the
 * candidate's own authenticated requests.
 *
 * ## Trackers outlive the job's lifecycle
 *
 * A job going CLOSED/EXPIRED/UNAVAILABLE is exactly when tracking matters
 * most — the candidate applied while it was open, and that history is theirs.
 * Lifecycle transitions are status updates on the job row and never touch
 * this table.
 */
@Injectable()
export class ExternalApplicationTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: CandidatePreferencesService,
    private readonly cards: ExternalJobCardService,
    private readonly flags: CandidateExternalFlagsService,
  ) {}

  async track(
    userId: string,
    externalJobId: string,
    dto: TrackExternalApplicationDto,
  ): Promise<ExternalApplicationTracker> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);

    const job = await this.prisma.externalJob.findUnique({
      where: { id: externalJobId },
      select: { id: true },
    });
    // Existence, not currency: a candidate may truthfully record an
    // application on a job that closed an hour after they submitted it.
    if (!job) throw new NotFoundException('External job not found');

    try {
      const row = await this.prisma.candidateExternalJobApplication.create({
        data: {
          candidateAccountId,
          externalJobId,
          status: dto.status ?? 'APPLIED',
          appliedAt: this.boundedAppliedAt(dto.appliedAt) ?? new Date(),
          note: this.cleanNote(dto.note),
        },
      });
      return this.shape(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        /*
         * The unique (candidateAccountId, externalJobId) fired: a tracker
         * already exists. Point the caller at it rather than silently
         * overwriting the candidate's earlier record — correcting a tracker
         * is a PATCH of the one they have.
         */
        const existing =
          await this.prisma.candidateExternalJobApplication.findUnique({
            where: {
              candidateAccountId_externalJobId: {
                candidateAccountId,
                externalJobId,
              },
            },
            select: { id: true },
          });
        throw new ConflictException({
          message: ALREADY_TRACKED_CODE,
          trackingId: existing?.id ?? null,
        });
      }
      throw error;
    }
  }

  async update(
    userId: string,
    trackingId: string,
    dto: UpdateExternalApplicationDto,
  ): Promise<ExternalApplicationTracker> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    await this.requireOwned(candidateAccountId, trackingId);

    const data: Prisma.CandidateExternalJobApplicationUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.appliedAt !== undefined) {
      const bounded = this.boundedAppliedAt(dto.appliedAt);
      if (bounded) data.appliedAt = bounded;
    }
    // null clears the note; undefined leaves it alone.
    if (dto.note !== undefined) data.note = this.cleanNote(dto.note);

    const row = await this.prisma.candidateExternalJobApplication.update({
      where: { id: trackingId },
      data,
    });
    return this.shape(row);
  }

  async remove(
    userId: string,
    trackingId: string,
  ): Promise<{ id: string; deleted: true }> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    await this.requireOwned(candidateAccountId, trackingId);
    await this.prisma.candidateExternalJobApplication.delete({
      where: { id: trackingId },
    });
    return { id: trackingId, deleted: true };
  }

  /** appliedAt DESC, id ASC — deterministic, paginated, one-status filter. */
  async list(
    userId: string,
    query: ExternalApplicationsQueryDto,
  ): Promise<TrackedApplicationsPage> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const where: Prisma.CandidateExternalJobApplicationWhereInput = {
      candidateAccountId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.candidateExternalJobApplication.count({ where }),
      this.prisma.candidateExternalJobApplication.findMany({
        where,
        orderBy: [{ appliedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const ids = rows.map((row) => row.externalJobId);
    const [cards, marks] = await Promise.all([
      this.cards.loadCards(ids),
      this.flags.flagsFor(candidateAccountId, ids),
    ]);

    return {
      page,
      pageSize,
      total,
      asOf: new Date(),
      results: rows.map((row) => {
        const card = cards.get(row.externalJobId) ?? null;
        return {
          ...this.shape(row),
          job: card
            ? { ...card, saved: marks.saved.has(row.externalJobId) }
            : null,
        };
      }),
    };
  }

  /**
   * 404 for "not yours" exactly as for "not there": distinguishing them
   * would tell candidate A which tracker ids candidate B holds.
   */
  private async requireOwned(
    candidateAccountId: string,
    trackingId: string,
  ): Promise<void> {
    const row = await this.prisma.candidateExternalJobApplication.findFirst({
      where: { id: trackingId, candidateAccountId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Application tracker not found');
  }

  /**
   * A self-reported date is still a date about the past. Future values
   * beyond clock skew are refused, not clamped — silently storing a
   * different moment than the candidate typed would be the system editing
   * their record.
   */
  private boundedAppliedAt(value: string | undefined): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('appliedAt must be a valid ISO date');
    }
    if (parsed.getTime() > Date.now() + MAX_APPLIED_AT_FUTURE_MS) {
      throw new BadRequestException('appliedAt cannot be in the future');
    }
    return parsed;
  }

  private cleanNote(note: string | null | undefined): string | null {
    if (note === undefined || note === null) return null;
    const trimmed = note.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private shape(row: {
    id: string;
    externalJobId: string;
    status: string;
    appliedAt: Date;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ExternalApplicationTracker {
    return {
      id: row.id,
      externalJobId: row.externalJobId,
      status: row.status,
      appliedAt: row.appliedAt,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

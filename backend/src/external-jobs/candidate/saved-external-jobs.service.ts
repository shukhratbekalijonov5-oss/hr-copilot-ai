import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import {
  ExternalJobCardService,
  type ExternalJobCard,
} from './external-job-card.service';
import {
  CandidateExternalFlagsService,
  type ExternalTrackingSummary,
} from './candidate-external-flags.service';
import type { PagedQueryDto } from './dto/paged-query.dto';

export interface SaveResult {
  externalJobId: string;
  saved: boolean;
  /** Present when saved — the ORIGINAL save moment, stable across repeats. */
  savedAt?: Date;
}

export interface SavedExternalJobRow extends ExternalJobCard {
  savedAt: Date;
  applicationTracking: ExternalTrackingSummary | null;
}

export interface SavedExternalJobsPage {
  page: number;
  pageSize: number;
  total: number;
  asOf: Date;
  results: SavedExternalJobRow[];
}

/**
 * Bookmarks over the external catalogue. Candidate-owned, reference-only.
 *
 * ## What a save is, and is not
 *
 * A save is a (candidateAccountId, externalJobId, savedAt) triple and nothing
 * more — never a copy of the job. The list renders whatever the canonical row
 * currently says, so a saved job that closed shows CLOSED, honestly, rather
 * than a snapshot of the day it looked open.
 *
 * ## Lifecycle
 *
 * Nothing in ingestion or lifecycle writes to this table. A job going
 * CLOSED/EXPIRED/UNAVAILABLE is a status UPDATE on the job; the bookmark
 * belongs to the candidate and only the candidate removes it. (The one
 * exception is referential: if a job row were ever hard-deleted — which the
 * lifecycle never does — the FK cascade removes the bookmark rather than
 * leaving it dangling.)
 *
 * ## Why save requires only EXISTENCE, not currency
 *
 * The search and detail views decide what is VISIBLE (ACTIVE|STALE). A save
 * races that visibility: a candidate can have the job open, watch it close
 * under them, and click Save a second later. Refusing because our crawler
 * moved first would lose a bookmark on a job they genuinely found; the list
 * shows its honest status either way. An id that matches no ExternalJob at
 * all is a plain 404 — bookmarks point into the catalogue, not at arbitrary
 * strings.
 */
@Injectable()
export class SavedExternalJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: CandidatePreferencesService,
    private readonly cards: ExternalJobCardService,
    private readonly flags: CandidateExternalFlagsService,
  ) {}

  /** Idempotent: saving twice returns the same original `savedAt`. */
  async save(userId: string, externalJobId: string): Promise<SaveResult> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    await this.requireJob(externalJobId);

    /*
     * Upsert on the composite unique key, so two concurrent saves of the same
     * job collide in the database and both read the surviving row — no
     * duplicate, no error, and `update: {}` means a repeat CHANGES NOTHING,
     * which is what keeps savedAt the original save moment.
     */
    const row = await this.prisma.candidateSavedExternalJob.upsert({
      where: {
        candidateAccountId_externalJobId: {
          candidateAccountId,
          externalJobId,
        },
      },
      create: { candidateAccountId, externalJobId },
      update: {},
      select: { createdAt: true },
    });
    return { externalJobId, saved: true, savedAt: row.createdAt };
  }

  /** Idempotent: unsaving what was never saved is the same success. */
  async unsave(userId: string, externalJobId: string): Promise<SaveResult> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    await this.prisma.candidateSavedExternalJob.deleteMany({
      where: { candidateAccountId, externalJobId },
    });
    return { externalJobId, saved: false };
  }

  /** The saved list: savedAt DESC, id ASC — deterministic, paginated. */
  async list(
    userId: string,
    query: PagedQueryDto,
  ): Promise<SavedExternalJobsPage> {
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const [total, rows] = await Promise.all([
      this.prisma.candidateSavedExternalJob.count({
        where: { candidateAccountId },
      }),
      this.prisma.candidateSavedExternalJob.findMany({
        where: { candidateAccountId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { externalJobId: true, createdAt: true },
      }),
    ]);

    const ids = rows.map((row) => row.externalJobId);
    const [cards, marks] = await Promise.all([
      this.cards.loadCards(ids),
      this.flags.flagsFor(candidateAccountId, ids),
    ]);

    const results: SavedExternalJobRow[] = [];
    for (const row of rows) {
      const card = cards.get(row.externalJobId);
      // Only possible if the job row was hard-deleted mid-request; the FK
      // cascade will have removed the bookmark by the next read.
      if (!card) continue;
      results.push({
        ...card,
        savedAt: row.createdAt,
        applicationTracking: marks.tracking.get(row.externalJobId) ?? null,
      });
    }

    return { page, pageSize, total, asOf: new Date(), results };
  }

  private async requireJob(externalJobId: string): Promise<void> {
    const job = await this.prisma.externalJob.findUnique({
      where: { id: externalJobId },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('External job not found');
  }
}

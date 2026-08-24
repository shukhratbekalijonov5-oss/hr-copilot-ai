import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ExternalApplicationStatus } from '../../generated/prisma/enums';

/**
 * The candidate-owned metadata a card shows about a job: `saved` and
 * `applicationTracking`.
 */
export interface ExternalTrackingSummary {
  id: string;
  status: ExternalApplicationStatus;
  appliedAt: Date;
}

export interface CandidateExternalFlags {
  saved: Set<string>;
  tracking: Map<string, ExternalTrackingSummary>;
}

export const EMPTY_FLAGS: CandidateExternalFlags = {
  saved: new Set(),
  tracking: new Map(),
};

/**
 * Bulk lookup of a candidate's own marks over a page of external jobs.
 *
 * ONE service, injected by every surface that decorates job cards — search
 * results, the detail view, the saved list and the tracking list — so
 * "which of these jobs has this candidate saved / tracked" has exactly one
 * implementation and exactly one query shape: two indexed `IN` lookups per
 * page, never one query per card.
 *
 * ## What this deliberately is not
 *
 * Not a ranking input. The flags are attached AFTER a search's stored order
 * is read, are absent from the snapshot and the request fingerprint, and
 * carry no score-shaped field. Saving a job must never move it — a bookmark
 * records interest, it does not create relevance. The unit tests on the
 * ranking pin this from the other side: identical order with and without
 * marks.
 */
@Injectable()
export class CandidateExternalFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async flagsFor(
    candidateAccountId: string,
    externalJobIds: string[],
  ): Promise<CandidateExternalFlags> {
    if (externalJobIds.length === 0) {
      return { saved: new Set(), tracking: new Map() };
    }

    const [savedRows, trackerRows] = await Promise.all([
      this.prisma.candidateSavedExternalJob.findMany({
        where: { candidateAccountId, externalJobId: { in: externalJobIds } },
        select: { externalJobId: true },
      }),
      this.prisma.candidateExternalJobApplication.findMany({
        where: { candidateAccountId, externalJobId: { in: externalJobIds } },
        select: {
          id: true,
          externalJobId: true,
          status: true,
          appliedAt: true,
        },
      }),
    ]);

    const saved = new Set(savedRows.map((row) => row.externalJobId));
    const tracking = new Map<string, ExternalTrackingSummary>();
    for (const row of trackerRows) {
      tracking.set(row.externalJobId, {
        id: row.id,
        status: row.status,
        appliedAt: row.appliedAt,
      });
    }
    return { saved, tracking };
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The canonical job facts a saved-list or tracking-list row displays.
 *
 * Field-for-field the same names as a search result's job fields, so the
 * frontend renders all three lists with one card component — minus the
 * scoring fields, which only a search possesses, and with NO status
 * restriction, which is the point:
 *
 * The search and the detail view show the CURRENT universe (ACTIVE|STALE) and
 * nothing else. The saved and tracking lists are the candidate's OWN records,
 * and their job may since have CLOSED or EXPIRED or gone UNAVAILABLE — the
 * row stays, and `status` says so honestly. Hiding it would erase the
 * candidate's bookmark; relabelling it would claim an employer is hiring who
 * is not. This loader is therefore deliberately NOT the search's `loadJobs`,
 * whose status filter is correct for search and wrong here.
 *
 * Crawler timestamps (`firstSeenAt`/`lastSeenAt`/`lastVerifiedAt`) and
 * ingestion internals stay absent, for the same reasons as everywhere else.
 */
export interface ExternalJobCard {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  /** ANY ExternalJobStatus — the honest current lifecycle state. */
  status: string;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additionalLocations: unknown;
  workMode: string | null;
  remoteCountriesAllowed: string[];
  employmentType: string | null;
  seniorityLevel: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
    payPeriod: string | null;
  };
  /** The employer's own publication date, or null. Never a crawler timestamp. */
  employerPostedAt: Date | null;
  applyUrl: string | null;
  provenance: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  };
}

@Injectable()
export class ExternalJobCardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Card data for a page of jobs, by id, in bulk. Never one query per card. */
  async loadCards(ids: string[]): Promise<Map<string, ExternalJobCard>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.externalJob.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        status: true,
        countryCode: true,
        region: true,
        city: true,
        additionalLocations: true,
        workMode: true,
        remoteCountriesAllowed: true,
        employmentType: true,
        seniorityLevel: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
        payPeriod: true,
        employerPostedAt: true,
        canonicalUrl: true,
        company: { select: { name: true, websiteUrl: true } },
        /*
         * ALL sources, unlike the search's ACTIVE-only select: a saved job
         * whose sources have closed still came from somewhere, and
         * "Source: greenhouse" remains true after delisting. ACTIVE sources
         * are preferred below so a current job answers identically to the
         * search response.
         */
        sources: {
          select: {
            provider: true,
            originalUrl: true,
            sourceUrl: true,
            status: true,
          },
        },
      },
    });

    const out = new Map<string, ExternalJobCard>();
    for (const row of rows) {
      const activeFirst = [...row.sources].sort((a, b) =>
        a.status === b.status ? 0 : a.status === 'ACTIVE' ? -1 : 1,
      );
      const applySource =
        activeFirst.find(
          (source) =>
            (source.originalUrl ?? source.sourceUrl) === row.canonicalUrl,
        ) ?? activeFirst[0];
      out.set(row.id, {
        externalJobId: row.id,
        title: row.title,
        company: row.company.name,
        companyWebsiteUrl: row.company.websiteUrl,
        status: row.status,
        location: {
          countryCode: row.countryCode,
          region: row.region,
          city: row.city,
        },
        additionalLocations: row.additionalLocations ?? [],
        workMode: row.workMode,
        remoteCountriesAllowed: row.remoteCountriesAllowed,
        employmentType: row.employmentType,
        seniorityLevel: row.seniorityLevel,
        salary: {
          min: row.salaryMin,
          max: row.salaryMax,
          currency: row.currency,
          payPeriod: row.payPeriod,
        },
        employerPostedAt: row.employerPostedAt,
        // The stored, provider-validated URL. Never assembled, never proxied.
        applyUrl: row.canonicalUrl,
        provenance: {
          primarySource: activeFirst[0]?.provider ?? null,
          applyVia: applySource?.provider ?? null,
          sourceCount: row.sources.length,
        },
      });
    }
    return out;
  }
}

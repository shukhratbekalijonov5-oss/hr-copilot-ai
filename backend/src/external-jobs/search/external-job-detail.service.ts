import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePreferencesService } from '../../candidate-preferences/candidate-preferences.service';
import {
  CandidateExternalFlagsService,
  type ExternalTrackingSummary,
} from '../candidate/candidate-external-flags.service';

/**
 * One external job, read for display.
 *
 * ## Why this is a separate read and not a bigger search response
 *
 * A description can be twenty thousand characters. Twenty of them on a page of
 * search results is a payload two orders of magnitude larger than the ranking
 * it exists to convey, paid on every keystroke-driven search, to render text
 * nobody has asked to read yet. Fetching it when a reader opens one job is the
 * smaller change, not the larger one.
 *
 * ## What it deliberately does not do
 *
 * No scoring, no ranking, no snapshot, no retrieval. It reads one row that the
 * search has already decided is in the universe, under the same status
 * predicate, and returns the facts a person needs in order to decide whether
 * to apply. Nothing here can influence an order.
 *
 * ## What it deliberately does not return
 *
 * Ingestion internals — `dedupeFingerprint`, `sourceKey`, `sourceScope`,
 * `claims`, `urlKeys`, `canonicalSourceId`, `normalizedTitle` — are absent by
 * construction: the select below names every column that leaves this service.
 * So are `firstSeenAt` / `lastSeenAt` / `lastVerifiedAt`, which are CRAWLER
 * timestamps. Rendering one of them as "posted 2 days ago" would attribute our
 * sweep schedule to the employer, and no provider in this catalogue states
 * when a role was actually published.
 */

export interface ExternalJobDetail {
  externalJobId: string;
  title: string;
  company: string;
  companyWebsiteUrl: string | null;
  /** ACTIVE or STALE. Nothing else is readable. */
  status: string;
  /** Plain text, sanitized at ingestion. Never markup. */
  description: string | null;
  requirementsText: string | null;
  location: {
    countryCode: string | null;
    region: string | null;
    city: string | null;
  };
  additionalLocations: unknown;
  workMode: string | null;
  /** Stated remote geography. Empty is unknown, never worldwide. */
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
  skills: string[];
  industries: string[];
  benefits: string[];
  languageCodes: string[];
  applyUrl: string | null;
  provenance: {
    primarySource: string | null;
    applyVia: string | null;
    sourceCount: number;
  };
  /** Whether the AUTHENTICATED CALLER bookmarked this job. Theirs alone. */
  saved: boolean;
  /**
   * The caller's own self-reported application tracker, or null. Personal
   * decoration, exactly as on a search result — never part of the job facts,
   * never derived from any provider signal.
   */
  applicationTracking: ExternalTrackingSummary | null;
}

@Injectable()
export class ExternalJobDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: CandidatePreferencesService,
    private readonly flags: CandidateExternalFlagsService,
  ) {}

  /**
   * The full record for one job in the CURRENT universe.
   *
   * A job that closed since the search ran is a 404 rather than a rendered
   * page with a dead Apply button: the reader is told it is gone, which is
   * true, instead of being sent to an employer who has stopped hiring.
   */
  async detail(
    externalJobId: string,
    userId: string,
  ): Promise<ExternalJobDetail> {
    const row = await this.prisma.externalJob.findFirst({
      where: { id: externalJobId, status: { in: ['ACTIVE', 'STALE'] } },
      select: {
        id: true,
        title: true,
        description: true,
        requirementsText: true,
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
        skills: true,
        industries: true,
        benefits: true,
        languageCodes: true,
        canonicalUrl: true,
        company: { select: { name: true, websiteUrl: true } },
        sources: {
          select: { provider: true, originalUrl: true, sourceUrl: true },
          where: { status: 'ACTIVE' },
        },
      },
    });
    if (!row) throw new NotFoundException('External job not found');

    /*
     * The caller's own marks on this job. Looked up AFTER the status
     * predicate decided visibility, so being saved never resurrects a closed
     * job here — the saved LIST is where a closed bookmark honestly appears.
     */
    const candidateAccountId = await this.preferences.requireAccountId(userId);
    const marks = await this.flags.flagsFor(candidateAccountId, [row.id]);

    /*
     * Which source receives the application. Identical rule to the search
     * response, so "Apply via" says the same thing on the card and in the
     * detail view — two answers to that question would be one too many.
     */
    const applySource =
      row.sources.find(
        (source) =>
          (source.originalUrl ?? source.sourceUrl) === row.canonicalUrl,
      ) ?? row.sources[0];

    return {
      externalJobId: row.id,
      title: row.title,
      company: row.company.name,
      companyWebsiteUrl: row.company.websiteUrl,
      status: row.status,
      description: row.description,
      requirementsText: row.requirementsText,
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
      skills: row.skills,
      industries: row.industries,
      benefits: row.benefits,
      languageCodes: row.languageCodes,
      // The stored, provider-validated URL. Never assembled, never proxied.
      applyUrl: row.canonicalUrl,
      provenance: {
        primarySource: row.sources[0]?.provider ?? null,
        applyVia: applySource?.provider ?? null,
        sourceCount: row.sources.length,
      },
      saved: marks.saved.has(row.id),
      applicationTracking: marks.tracking.get(row.id) ?? null,
    };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { NormalizedExternalJobInput } from './external-job.contract';
import { assessMerge, fingerprintOf, sourceKeyOf } from './dedupe';
import { urlIdentitiesOf } from './url-identity';
import {
  chooseCanonicalUrl,
  claimsOf,
  isClaims,
  resolveClaims,
  resolveField,
  resolveSalary,
} from './field-merge';
import {
  absenceVerdict,
  isCurrentlySearchable,
  resolveJobStatus,
} from './lifecycle';
import { domainOf, normalizeCompanyName, normalizeTitle } from './normalize';
import { DEFAULT_STALENESS_MS } from './external-jobs.constants';
import type { Prisma } from '../generated/prisma/client';
import type { ExternalProvider } from '../generated/prisma/enums';

/** What a merge decision needs to know about a candidate job. */
const MERGE_CANDIDATE_SELECT = {
  id: true,
  externalCompanyId: true,
  canonicalUrl: true,
  countryCode: true,
  city: true,
  company: { select: { domain: true } },
  sources: { select: { provider: true, sourceKey: true, urlKeys: true } },
} as const;

interface MergeCandidate {
  id: string;
  externalCompanyId: string;
  canonicalUrl: string | null;
  countryCode: string | null;
  city: string | null;
  company: { domain: string | null };
  sources: { provider: string; sourceKey: string; urlKeys: string[] }[];
  /** True when more than one job already claims one of these URLs. */
  ambiguous: boolean;
}

/** How many source rows one absence scan page reads. */
const ABSENCE_SCAN_BATCH = 500;
/** How many rows one retirement statement touches. */
const ABSENCE_UPDATE_BATCH = 200;

/**
 * Turning provider sightings into canonical external jobs.
 *
 * ## Idempotency is a database property here, not a code convention
 *
 * A provider sweep runs every few hours forever, and every run re-observes
 * most of the same postings. So "ingest" means UPSERT, keyed on two unique
 * constraints the database enforces: `(provider, sourceKey)` for a sighting
 * and `dedupeFingerprint` for a canonical job. Two workers racing on the same
 * posting collide on an index rather than quietly creating twins, which is the
 * failure mode that would be invisible until a candidate saw the same job
 * four times.
 *
 * ## One bad job never costs the run
 *
 * Every posting is ingested independently and failures are counted, not
 * thrown. A provider returning four hundred jobs, one of which has a malformed
 * salary, must store three hundred and ninety-nine.
 */
@Injectable()
export class ExternalIngestionService {
  private readonly logger = new Logger(ExternalIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ingest one page of normalized jobs.
   *
   * Returns per-job outcomes so a run row can be updated with real counters
   * rather than guesses.
   */
  async ingestBatch(
    jobs: NormalizedExternalJobInput[],
    scopeKey: string | null = null,
    now: Date = new Date(),
  ): Promise<{
    created: number;
    updated: number;
    merged: number;
    failed: number;
    unmerged: number;
  }> {
    const counters = {
      created: 0,
      updated: 0,
      merged: 0,
      failed: 0,
      unmerged: 0,
    };

    for (const job of jobs) {
      try {
        const outcome = await this.ingestOne(job, scopeKey, now);
        counters[outcome] += 1;
      } catch (error) {
        // Isolation: this posting is lost, the rest of the page is not. The
        // provider and source id are enough to find it again; the payload is
        // deliberately not logged, because provider responses can carry
        // contact details and we do not put those in log files.
        counters.failed += 1;
        this.logger.warn(
          `External job skipped (${job.provider} ${job.sourceJobId ?? job.sourceUrl}): ` +
            `${(error as Error).message}`,
        );
      }
    }
    return counters;
  }

  /**
   * One sighting → one canonical job.
   *
   * The order matters: company first (jobs hang off it), then the canonical
   * job by fingerprint, then the merge decision, then the source row, then a
   * re-resolution of every field from all surviving sources.
   */
  private async ingestOne(
    input: NormalizedExternalJobInput,
    scopeKey: string | null,
    now: Date,
  ): Promise<'created' | 'updated' | 'merged' | 'unmerged'> {
    const fingerprint = fingerprintOf(input);
    const sourceKey = sourceKeyOf(input);
    const urlKeys = urlIdentitiesOf(input);

    /*
     * Two ways to find the job this sighting belongs to, and the second one is
     * what makes cross-provider provenance possible at all.
     *
     * The fingerprint asks "is there already a job with this company, title,
     * place and employment type". That works between two ATS boards, which
     * describe a posting in similar words. It does NOT work between a
     * company's careers page and the ATS behind it: the page says "Linear" and
     * "North America", the board says "linear" and `addressCountry: USA`, and
     * the page often states no employment type at all — three different
     * fingerprints for one requisition.
     *
     * So when the fingerprint misses, the apply URL is asked instead. That is
     * an indexed lookup on `urlKeys`, not a scan: dedupe over a growing
     * catalogue has to stay a key lookup or it becomes quadratic the week the
     * catalogue gets interesting.
     */
    const byFingerprint = await this.findByFingerprint(fingerprint);
    const existing = byFingerprint ?? (await this.findByUrl(urlKeys));

    if (!existing) {
      const company = await this.resolveCompany(input, now);
      const createdId = await this.createJob(
        input,
        company.id,
        fingerprint,
        sourceKey,
        scopeKey,
        now,
      );
      /*
       * A new job's status is derived, never assumed.
       *
       * `createJob` writes a provisional ACTIVE/CLOSED, but only
       * `resolveJobStatus` knows the whole rule — and one part of it can fire
       * on the very first sighting: a posting whose employer-stated deadline
       * has already passed is EXPIRED the moment it arrives. Without this the
       * job would sit ACTIVE until some later sweep happened to touch it, and
       * candidates would be shown a posting that closed before we ever saw it.
       *
       * Found the first time a provider actually populated `expiresAt`.
       */
      await this.reconcileJob(createdId, now);
      return 'created';
    }

    const verdict = existing.ambiguous
      ? {
          merge: false,
          confidence: 'POSSIBLE' as const,
          reason:
            'More than one canonical job already publishes this application ' +
            'URL, so which one this sighting belongs to is not decidable',
        }
      : assessMerge(
          input,
          {
            canonicalUrl: existing.canonicalUrl,
            companyDomain: existing.company.domain,
            countryCode: existing.countryCode,
            city: existing.city,
            sources: existing.sources,
          },
          sourceKey,
        );

    if (!verdict.merge) {
      /*
       * The fingerprint matched but nothing corroborated it, so these may be
       * two different requisitions that happen to share a company name and a
       * title. Merging would hide one of them permanently; keeping both shows
       * a duplicate that a later observation (a domain, a city, a shared apply
       * URL) can still resolve.
       *
       * The fingerprint column is unique, so the second job is stored under a
       * disambiguated one that records WHY it could not be merged.
       */
      /*
       * The fingerprint column is unique. When the candidate was found BY
       * FINGERPRINT the plain value is taken, so the refused sighting needs a
       * disambiguated one; when it was found by URL the fingerprint is free
       * and is used as-is, which keeps a later, better-corroborated
       * observation able to find this job the ordinary way.
       */
      const company = await this.resolveCompany(input, now);
      const disambiguated = byFingerprint
        ? createHash('sha256')
            .update(`${fingerprint}|unmerged|${input.provider}|${sourceKey}`)
            .digest('hex')
        : fingerprint;
      const already = await this.prisma.externalJob.findUnique({
        where: { dedupeFingerprint: disambiguated },
        select: { id: true },
      });
      if (already) {
        await this.touchSource(
          already.id,
          input,
          sourceKey,
          scopeKey,
          verdict,
          now,
        );
        /*
         * Reconcile, like every other path that touches a source.
         *
         * Its absence here was a real defect: a sighting kept separate because
         * a merge could not be corroborated would refresh its SOURCE row on
         * every sweep and never re-derive the canonical job from it. The job's
         * facts froze at whatever the row said the day it was created.
         *
         * Invisible until now, because the fields that path writes rarely
         * change. `employerPostedAt` made it visible: it is the first canonical
         * field that starts null for every existing row and can only ever be
         * filled by a reconcile, so four Ashby duplicates sat dateless through
         * two full syncs while their own source rows carried the date.
         */
        await this.reconcileJob(already.id, now);
        return 'updated';
      }
      const unmergedId = await this.createJob(
        input,
        company.id,
        disambiguated,
        sourceKey,
        scopeKey,
        now,
        verdict,
      );
      await this.reconcileJob(unmergedId, now);
      this.logger.debug(
        `Ambiguous external duplicate kept separate (${input.provider} ` +
          `${sourceKey}): ${verdict.reason}`,
      );
      return 'unmerged';
    }

    const isNewSource = !existing.sources.some(
      (source) =>
        source.provider === input.provider && source.sourceKey === sourceKey,
    );
    await this.touchSource(
      existing.id,
      input,
      sourceKey,
      scopeKey,
      verdict,
      now,
    );
    await this.enrichCompany(existing.externalCompanyId, input, now);
    await this.reconcileJob(existing.id, now);
    return isNewSource ? 'merged' : 'updated';
  }

  /** The canonical job stored under this identity, if there is one. */
  private async findByFingerprint(
    fingerprint: string,
  ): Promise<MergeCandidate | null> {
    const job = await this.prisma.externalJob.findUnique({
      where: { dedupeFingerprint: fingerprint },
      select: MERGE_CANDIDATE_SELECT,
    });
    return job ? { ...job, ambiguous: false } : null;
  }

  /**
   * The canonical job an existing sighting already publishes one of these URLs
   * for.
   *
   * More than one match is reported rather than resolved. It means two
   * canonical jobs already claim the same application link — a state the
   * merge rules are supposed to prevent — and picking one of them at random
   * would attach a company's careers page to whichever row happened to sort
   * first. Left ambiguous, the sighting stays separate and visible.
   */
  private async findByUrl(urlKeys: string[]): Promise<MergeCandidate | null> {
    if (urlKeys.length === 0) return null;
    const matches = await this.prisma.externalJobSource.findMany({
      where: { urlKeys: { hasSome: urlKeys } },
      select: { externalJobId: true },
      distinct: ['externalJobId'],
      take: 2,
    });
    if (matches.length === 0) return null;
    const job = await this.prisma.externalJob.findUnique({
      where: { id: matches[0].externalJobId },
      select: MERGE_CANDIDATE_SELECT,
    });
    if (!job) return null;
    return { ...job, ambiguous: matches.length > 1 };
  }

  /**
   * Let a confirmed sighting add the company DOMAIN this employer was missing.
   *
   * Greenhouse, Lever and Ashby state a company name and no website, so every
   * ATS-only employer is stored with an empty domain — the weaker half of the
   * dedupe identity. A company's own careers page supplies the strong half,
   * and it is trustworthy here precisely because this runs only after a merge
   * that was decided by a shared application URL: the employer's own
   * requisition already tied the two observations together, so the domain is
   * not being guessed from a name that happened to look similar.
   *
   * Only ever fills a blank. An existing domain is never overwritten, and a
   * domain already claimed by another company row is left alone rather than
   * fought over.
   */
  private async enrichCompany(
    companyId: string,
    input: NormalizedExternalJobInput,
    now: Date,
  ): Promise<void> {
    const domain = domainOf(input.companyWebsiteUrl);
    const company = await this.prisma.externalCompany.findUnique({
      where: { id: companyId },
      select: { id: true, normalizedName: true, domain: true },
    });
    if (!company) return;

    if (!domain || company.domain) {
      await this.prisma.externalCompany.update({
        where: { id: companyId },
        data: { lastSeenAt: now },
      });
      return;
    }

    const taken = await this.prisma.externalCompany.findUnique({
      where: {
        normalizedName_domain: {
          normalizedName: company.normalizedName,
          domain,
        },
      },
      select: { id: true },
    });
    if (taken) {
      await this.prisma.externalCompany.update({
        where: { id: companyId },
        data: { lastSeenAt: now },
      });
      return;
    }

    await this.prisma.externalCompany.update({
      where: { id: companyId },
      data: {
        domain,
        websiteUrl: input.companyWebsiteUrl,
        countryCode: input.companyCountryCode ?? undefined,
        lastSeenAt: now,
      },
    });
    this.logger.log(
      `External company ${company.normalizedName} gained domain ${domain} ` +
        `from a ${input.provider} sighting merged on a shared apply URL`,
    );
  }

  /**
   * The company this posting belongs to, created if unseen.
   *
   * Identity is the domain when a source states one and the folded name
   * otherwise — see `normalizeCompanyName` for why the fallback is weaker and
   * what it deliberately does not fold together.
   */
  private async resolveCompany(
    input: NormalizedExternalJobInput,
    now: Date,
  ): Promise<{ id: string }> {
    const normalizedName = normalizeCompanyName(input.companyName);
    const domain = domainOf(input.companyWebsiteUrl);

    return this.prisma.externalCompany.upsert({
      where: {
        normalizedName_domain: { normalizedName, domain: domain ?? '' },
      },
      create: {
        name: input.companyName,
        normalizedName,
        domain: domain ?? '',
        websiteUrl: input.companyWebsiteUrl,
        countryCode: input.companyCountryCode,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { lastSeenAt: now },
      select: { id: true },
    });
  }

  private async createJob(
    input: NormalizedExternalJobInput,
    companyId: string,
    fingerprint: string,
    sourceKey: string,
    scopeKey: string | null,
    now: Date,
    verdict?: { confidence: string; reason: string },
  ): Promise<string> {
    const created = await this.prisma.externalJob.create({
      data: {
        dedupeFingerprint: fingerprint,
        externalCompanyId: companyId,
        title: input.title,
        normalizedTitle: normalizeTitle(input.title),
        description: input.description,
        requirementsText: input.requirementsText,
        countryCode: input.countryCode,
        region: input.region,
        city: input.city,
        // Stored as stated. Nothing queries it yet; see the schema comment.
        additionalLocations:
          input.additionalLocations.length > 0
            ? (input.additionalLocations as unknown as Prisma.InputJsonValue)
            : undefined,
        workMode: input.workMode,
        remoteCountriesAllowed: input.remoteCountriesAllowed,
        employmentType: input.employmentType,
        seniorityLevel: input.seniorityLevel,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        currency: input.currency,
        payPeriod: input.payPeriod,
        skills: input.skills,
        industries: input.industries,
        benefits: input.benefits,
        languageCodes: input.languageCodes,
        visaSponsorship: input.visaSponsorship,
        existingWorkAuthorizationRequired:
          input.existingWorkAuthorizationRequired,
        eligibleVisaTypes: input.eligibleVisaTypes,
        canonicalUrl: input.originalUrl ?? input.sourceUrl,
        expiresAt: input.expiresAt,
        status: input.closedAtSource ? 'CLOSED' : 'ACTIVE',
        closedAt: input.closedAtSource ? now : null,
        firstSeenAt: now,
        lastSeenAt: now,
        lastVerifiedAt: now,
        sources: {
          create: this.sourceData(input, sourceKey, scopeKey, now, verdict),
        },
      },
      select: { id: true },
    });
    return created.id;
  }

  private sourceData(
    input: NormalizedExternalJobInput,
    sourceKey: string,
    scopeKey: string | null,
    now: Date,
    verdict?: { confidence: string; reason: string },
  ): Prisma.ExternalJobSourceCreateWithoutJobInput {
    return {
      provider: input.provider,
      accessMethod: input.accessMethod,
      sourceJobId: input.sourceJobId,
      sourceKey,
      sourceScope: scopeKey,
      sourceUrl: input.sourceUrl,
      originalUrl: input.originalUrl,
      // Recomputed on every observation, so a change of canonicalization rules
      // takes effect on the next sweep rather than needing a backfill.
      urlKeys: urlIdentitiesOf(input),
      claims: claimsOf(input),
      status: input.closedAtSource ? 'CLOSED' : 'ACTIVE',
      mergeConfidence:
        (verdict?.confidence as 'EXACT' | 'HIGH' | 'POSSIBLE') ?? 'EXACT',
      mergeReason: verdict?.reason ?? null,
      payloadFingerprint: payloadFingerprint(input),
      observedAt: now,
      lastSeenAt: now,
      closedAt: input.closedAtSource ? now : null,
    };
  }

  /** Record this sighting, creating the source row or refreshing it. */
  private async touchSource(
    jobId: string,
    input: NormalizedExternalJobInput,
    sourceKey: string,
    scopeKey: string | null,
    verdict: { confidence: string; reason: string },
    now: Date,
  ): Promise<void> {
    await this.prisma.externalJobSource.upsert({
      where: {
        provider_sourceKey: { provider: input.provider, sourceKey },
      },
      create: {
        externalJobId: jobId,
        ...this.sourceData(input, sourceKey, scopeKey, now, verdict),
      },
      update: {
        lastSeenAt: now,
        // A source seen again is ACTIVE again. A posting that came back after
        // being marked GONE is a real thing that happens — a board hiccup, a
        // requisition reopened — and refusing to revive it would leave a live
        // job permanently invisible.
        status: input.closedAtSource ? 'CLOSED' : 'ACTIVE',
        closedAt: input.closedAtSource ? now : null,
        sourceUrl: input.sourceUrl,
        originalUrl: input.originalUrl,
        urlKeys: urlIdentitiesOf(input),
        claims: claimsOf(input),
        sourceScope: scopeKey,
        payloadFingerprint: payloadFingerprint(input),
      },
    });
  }

  /**
   * Re-derive the canonical job from ALL of its sources.
   *
   * Done after every change rather than incrementally, because a job's facts
   * are a function of its sightings and computing them any other way means
   * maintaining a running total that drifts. Cheap: a job has a handful of
   * sources, not thousands.
   */
  async reconcileJob(jobId: string, now: Date = new Date()): Promise<void> {
    const job = await this.prisma.externalJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        expiresAt: true,
        // The current values of everything a SEARCH reads, so this can tell a
        // real edit from a re-observation. See `searchableUpdatedAt`.
        ...SEARCHABLE_SELECT,
        sources: {
          select: {
            id: true,
            provider: true,
            sourceUrl: true,
            originalUrl: true,
            status: true,
            observedAt: true,
            lastSeenAt: true,
            claims: true,
          },
        },
      },
    });
    if (!job) return;

    const live = job.sources.filter((source) => source.status === 'ACTIVE');
    const canonical = chooseCanonicalUrl(
      // Only live sources may supply the apply link: sending a candidate to a
      // posting the source itself said is closed wastes their time.
      (live.length > 0 ? live : job.sources).map((source) => ({
        provider: source.provider,
        sourceUrl: source.sourceUrl,
        originalUrl: source.originalUrl,
        observedAt: source.lastSeenAt,
      })),
    );

    /*
     * Re-derive the job's FACTS from every source that stated any.
     *
     * Only sources carrying claims take part. A source row written before this
     * column existed has not fallen silent — it is unknown — and treating the
     * two the same would blank a whole catalogue's worth of fields on the
     * first sweep after deployment. With no claims anywhere, the job's stored
     * fields are left exactly as they are.
     */
    const claiming = (live.length > 0 ? live : job.sources).flatMap((source) =>
      isClaims(source.claims)
        ? [
            {
              provider: source.provider,
              observedAt: source.lastSeenAt,
              claims: source.claims,
            },
          ]
        : [],
    );
    const resolved = claiming.length > 0 ? resolveClaims(claiming) : null;
    /*
     * `employerPostedBy` and `employerPostedSemantics` are audit output, not
     * columns: which provider won a date conflict and which publication event
     * its field names are answerable from the source rows themselves, and a
     * second copy on the canonical row is a second thing to keep in step.
     * Split off here so the spread below cannot hand Prisma an unknown field.
     */
    const fields = resolved ? omitAudit(resolved) : null;

    const status = resolveJobStatus({
      sources: job.sources.map((source) => ({
        status: source.status,
        lastSeenAt: source.lastSeenAt,
      })),
      expiresAt: job.expiresAt,
      stalenessMs: DEFAULT_STALENESS_MS,
      now,
    });

    const lastSeenAt = job.sources.reduce<Date | null>(
      (latest, source) =>
        !latest || source.lastSeenAt > latest ? source.lastSeenAt : latest,
      null,
    );

    const canonicalSourceId = canonical
      ? ((live.length > 0 ? live : job.sources).find(
          (source) =>
            (source.originalUrl ?? source.sourceUrl) === canonical.url,
        )?.id ?? null)
      : null;

    await this.prisma.externalJob.update({
      where: { id: jobId },
      data: {
        ...(fields ?? {}),
        canonicalUrl: canonical?.url ?? null,
        canonicalSourceId,
        status,
        lastSeenAt: lastSeenAt ?? now,
        lastVerifiedAt: now,
        closedAt: status === 'CLOSED' || status === 'EXPIRED' ? now : null,
        /*
         * Bumped ONLY when something a searcher could notice actually moved.
         *
         * `updatedAt` is useless for this: every provider sweep re-observes
         * every posting and writes `lastVerifiedAt`, so it advances several
         * times a day on a job nobody has touched. The candidate-facing search
         * keys its universe revision off THIS column, and using the other one
         * would invalidate every stored search on every sweep — churn that
         * would look exactly like the cache not working.
         */
        searchableUpdatedAt: searchableChanged(job, { ...fields, status })
          ? now
          : undefined,
      },
    });
  }

  /**
   * What a COMPLETE listing implies for the postings that were not in it.
   *
   * ## Both preconditions, or nothing happens
   *
   * This is the only path in the system that can retire a job nobody said was
   * closed, so it refuses to run unless `absenceVerdict` agrees on two points:
   * the run actually succeeded, and this provider's listings are complete.
   * A timeout, a 500, a truncated page, a `meta.total` that did not match —
   * any of them and every posting is left exactly as it was. It will drift to
   * STALE on its own if it has genuinely gone, which is the honest outcome:
   * we stopped seeing it and we do not know why.
   *
   * ## Scoped to one listing
   *
   * Absence is judged per scope — one Greenhouse board — because that is the
   * only universe the fetch actually enumerated. Sweeping board A tells us
   * nothing about board B, and a global diff would empty every other board the
   * first time one was synced by itself.
   *
   * Sources are marked GONE, never deleted. GONE says "the source stopped
   * listing it", which `resolveJobStatus` deliberately distinguishes from
   * CLOSED ("the employer said so") — and keeping the row is what lets a later
   * sweep notice the posting came back.
   */
  async markAbsent(input: {
    provider: ExternalProvider;
    scopeKey: string;
    observedSourceKeys: Set<string>;
    runSucceeded: boolean;
    absenceImpliesClosed: boolean;
    now?: Date;
  }): Promise<{ sourcesRetired: number; jobsClosed: number }> {
    const now = input.now ?? new Date();
    const verdict = absenceVerdict({
      runSucceeded: input.runSucceeded,
      absenceImpliesClosed: input.absenceImpliesClosed,
    });
    if (!verdict) {
      this.logger.log(
        `Absence not actionable for ${input.provider}/${input.scopeKey} ` +
          `(runSucceeded=${input.runSucceeded}, ` +
          `absenceImpliesClosed=${input.absenceImpliesClosed}); nothing retired`,
      );
      return { sourcesRetired: 0, jobsClosed: 0 };
    }

    const missing: { id: string; externalJobId: string }[] = [];
    let cursor: string | undefined;
    // Paged rather than loaded whole: a board of ten thousand postings must
    // not become one ten-thousand-row array plus a NOT IN clause of the same
    // size. Only three small columns are read.
    for (;;) {
      const batch = await this.prisma.externalJobSource.findMany({
        where: {
          provider: input.provider,
          sourceScope: input.scopeKey,
          status: 'ACTIVE',
        },
        select: { id: true, sourceKey: true, externalJobId: true },
        orderBy: { id: 'asc' },
        take: ABSENCE_SCAN_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      for (const source of batch) {
        if (!input.observedSourceKeys.has(source.sourceKey)) {
          missing.push({ id: source.id, externalJobId: source.externalJobId });
        }
      }
      if (batch.length < ABSENCE_SCAN_BATCH) break;
      cursor = batch[batch.length - 1].id;
    }

    if (missing.length === 0) return { sourcesRetired: 0, jobsClosed: 0 };

    for (let i = 0; i < missing.length; i += ABSENCE_UPDATE_BATCH) {
      const chunk = missing.slice(i, i + ABSENCE_UPDATE_BATCH);
      await this.prisma.externalJobSource.updateMany({
        where: { id: { in: chunk.map((source) => source.id) } },
        data: { status: verdict, closedAt: now },
      });
    }

    // Re-derive each affected job. A job with another live source stays
    // ACTIVE: one board dropping a posting proves nothing while another still
    // lists it.
    let jobsClosed = 0;
    const affected = [
      ...new Set(missing.map((source) => source.externalJobId)),
    ];
    for (const jobId of affected) {
      await this.reconcileJob(jobId, now);
      const after = await this.prisma.externalJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (after && !isCurrentlySearchable(after.status)) jobsClosed += 1;
    }

    this.logger.log(
      `Absence sweep ${input.provider}/${input.scopeKey}: ` +
        `${missing.length} source(s) retired, ${jobsClosed} job(s) left the ` +
        `current universe`,
    );
    return { sourcesRetired: missing.length, jobsClosed };
  }

  /** Re-export so callers do not reach into the merge module directly. */
  readonly resolveField = resolveField;
  readonly resolveSalary = resolveSalary;
}

/**
 * Exactly the columns the candidate-facing search reads.
 *
 * The definition of "search-relevant" lives here, once. A field belongs in
 * this list if changing it could change which jobs a search returns or in what
 * order — and deliberately not otherwise: `lastSeenAt`, `lastVerifiedAt` and
 * `canonicalUrl` all move without changing a single result.
 */
const SEARCHABLE_SELECT = {
  title: true,
  description: true,
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
  status: true,
  /*
   * A newly learned publication date changes what NEWEST sorting returns, so
   * it belongs here: the search's universe revision is derived from
   * `searchableUpdatedAt`, and a date that moved without bumping it would
   * leave every candidate's stored newest-first run showing the old order.
   *
   * A re-observation that resolves to the SAME date changes nothing and bumps
   * nothing — which is the property that keeps a provider sweep from
   * invalidating the whole cache several times a day.
   */
  employerPostedAt: true,
} as const;

type SearchableSnapshot = {
  [K in keyof typeof SEARCHABLE_SELECT]?: unknown;
};

/**
 * The resolved fields, minus the two that are audit output rather than columns.
 *
 * `resolveClaims` reports which provider won the publication-date conflict and
 * which publication event its field names, because that is genuinely useful
 * when explaining a date. Neither is stored: both are answerable from the
 * source rows, and a second copy on the canonical row is a second thing that
 * can fall out of step with the first.
 */
function omitAudit(
  resolved: ReturnType<typeof resolveClaims>,
): Omit<
  ReturnType<typeof resolveClaims>,
  'employerPostedBy' | 'employerPostedSemantics'
> {
  const fields = { ...resolved };
  delete (fields as Record<string, unknown>).employerPostedBy;
  delete (fields as Record<string, unknown>).employerPostedSemantics;
  return fields;
}

/** Whether reconciling this job changed anything a searcher could see. */
export function searchableChanged(
  before: SearchableSnapshot,
  after: SearchableSnapshot,
): boolean {
  for (const key of Object.keys(
    SEARCHABLE_SELECT,
  ) as (keyof typeof SEARCHABLE_SELECT)[]) {
    // A field the reconcile did not compute is a field it is not changing.
    if (!(key in after) || after[key] === undefined) continue;
    if (
      JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A hash of the facts that matter, so an unchanged re-observation is cheap to
 * recognize. Deliberately excludes timestamps: a posting whose only difference
 * is when we looked at it has not changed.
 */
export function payloadFingerprint(input: NormalizedExternalJobInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.title,
        input.description,
        input.countryCode,
        input.city,
        input.workMode,
        input.employmentType,
        input.seniorityLevel,
        input.salaryMin,
        input.salaryMax,
        input.currency,
        input.payPeriod,
      ]),
    )
    .digest('hex');
}

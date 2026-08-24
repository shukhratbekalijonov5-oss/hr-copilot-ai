import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ExternalSearchService } from './external-search.service';
import { ExternalJobDetailService } from './external-job-detail.service';
import { ExternalJobSearchDto } from './dto/external-job-search.dto';
import { SavedExternalJobsService } from '../candidate/saved-external-jobs.service';
import { ExternalApplicationTrackingService } from '../candidate/external-application-tracking.service';
import { PagedQueryDto } from '../candidate/dto/paged-query.dto';
import { TrackExternalApplicationDto } from '../candidate/dto/track-external-application.dto';
import { CandidateScoped } from '../../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresCapability } from '../../entitlements/requires-capability.decorator';
import { ExternalWhyMatchService } from '../premium-ai/external-why-match.service';
import { WhyMatchDto } from '../premium-ai/dto/why-match.dto';

/**
 * Candidate-facing routes over the external job catalogue: search, detail,
 * bookmarks, and starting an application tracker.
 *
 * `@CandidateScoped`: every route requires a live CANDIDATE account, so an
 * ORGANIZATION account is refused whatever its token says. Never
 * `@OrgScoped` — external jobs belong to no tenant, and a recruiter has no
 * business reading a job seeker's bookmarks or trackers.
 *
 * There is no account id anywhere in the path, body or query. The subject is
 * always the authenticated caller, which is what makes one candidate reading
 * another's data impossible rather than merely forbidden.
 *
 * ROUTE ORDER IS LOAD-BEARING: `GET saved` is declared ABOVE
 * `GET :externalJobId` so the literal segment wins over the parameter. All
 * routes under this path prefix live in this ONE controller for exactly that
 * reason — split across controllers, the order would depend on module wiring.
 *
 * POST rather than GET for search because the request has structure — several
 * array filters and a nested compensation object — and because a saved search
 * is a body, not a query string of forty characters.
 */
/*
 * EXTERNAL AI SEARCH — the MAX product, gated at CLASS level so every route
 * in the external workspace (search, detail, bookmarks, tracker creation)
 * carries the same entitlement and no future route here can be forgotten.
 * Ordinary internal /jobs and applying stay FREE; the internal AI Job Match
 * is the separate PRO surface. The two universes never share a ranking.
 */
@CandidateScoped()
@RequiresCapability('EXTERNAL_AI_SEARCH')
@Controller('candidate-account/me/external-jobs')
export class ExternalSearchController {
  constructor(
    private readonly service: ExternalSearchService,
    private readonly details: ExternalJobDetailService,
    private readonly saved: SavedExternalJobsService,
    private readonly tracking: ExternalApplicationTrackingService,
    private readonly whyMatchService: ExternalWhyMatchService,
  ) {}

  /**
   * Run (or page through) a search.
   *
   * 200 rather than 201: this creates a snapshot as an implementation detail
   * of answering a question, and the caller is asking a question. Paging is
   * the same call with a different `page` — it re-reads the stored ranking
   * rather than recomputing, which is what keeps page 2 consistent with
   * page 1.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@CurrentUser('id') userId: string, @Body() dto: ExternalJobSearchDto) {
    return this.service.search(userId, dto);
  }

  /**
   * The candidate's bookmarks, newest first.
   *
   * The ONE candidate surface that shows non-current jobs: a saved job that
   * has since closed appears with its honest status rather than vanishing —
   * the bookmark is the candidate's, not the crawler's.
   */
  @Get('saved')
  savedList(@CurrentUser('id') userId: string, @Query() query: PagedQueryDto) {
    return this.saved.list(userId, query);
  }

  /** Bookmark one job. Idempotent — saving twice is the same bookmark. */
  @Post(':externalJobId/save')
  @HttpCode(HttpStatus.OK)
  save(
    @CurrentUser('id') userId: string,
    @Param('externalJobId', ParseUUIDPipe) externalJobId: string,
  ) {
    return this.saved.save(userId, externalJobId);
  }

  /** Remove the bookmark. Idempotent — unsaving the unsaved is the same 200. */
  @Delete(':externalJobId/save')
  @HttpCode(HttpStatus.OK)
  unsave(
    @CurrentUser('id') userId: string,
    @Param('externalJobId', ParseUUIDPipe) externalJobId: string,
  ) {
    return this.saved.unsave(userId, externalJobId);
  }

  /**
   * "I applied to this job" — the candidate's explicit statement, and the
   * ONLY thing that creates a tracker. Opening the apply link calls nothing:
   * a page visit is not an application, so there is deliberately no code
   * path from the link to this route.
   *
   * 201: this genuinely creates the candidate's record. A second POST is a
   * 409 carrying the existing `trackingId` — correcting a record is a PATCH
   * of the one they have, never a silent overwrite.
   */
  @Post(':externalJobId/application')
  track(
    @CurrentUser('id') userId: string,
    @Param('externalJobId', ParseUUIDPipe) externalJobId: string,
    @Body() dto: TrackExternalApplicationDto,
  ) {
    return this.tracking.track(userId, externalJobId, dto);
  }

  /**
   * "Why does this job match me?" — MAX, lazy, one job at a time.
   *
   * Declared ABOVE the `:externalJobId` GET for the same routing reason as
   * `saved`, though this one is a POST so the collision is theoretical.
   *
   * POST rather than GET because it can create something (a generation and a
   * cache entry) and because it takes a body. It is NOT called by search:
   * search returns deterministic results with no model in the path, and this
   * runs only when a person asks about one specific job.
   *
   * Entitlement is inherited from the class — `EXTERNAL_AI_SEARCH`, i.e. MAX,
   * exactly as Task 4C.6 requires and with no new capability invented.
   */
  @Post(':externalJobId/why-match')
  @HttpCode(HttpStatus.OK)
  whyMatch(
    @CurrentUser('id') userId: string,
    @Param('externalJobId', ParseUUIDPipe) externalJobId: string,
    @Body() dto: WhyMatchDto,
  ) {
    return this.whyMatchService.whyMatch(userId, externalJobId, dto.locale);
  }

  /**
   * One job, in full, for a reader who opened it.
   *
   * The job FACTS are shared — two candidates opening the same job see the
   * same posting. What differs per caller is only the caller's own marks:
   * `saved` and `applicationTracking`, which is why the route now knows who
   * is asking. Scores, bands and order still live exclusively in the search
   * response.
   *
   * `ParseUUIDPipe` rejects anything that is not an id shape before a query
   * runs, so a hand-edited URL is a 400 rather than a database round trip.
   */
  @Get(':externalJobId')
  detail(
    @CurrentUser('id') userId: string,
    @Param('externalJobId', ParseUUIDPipe) externalJobId: string,
  ) {
    return this.details.detail(externalJobId, userId);
  }
}

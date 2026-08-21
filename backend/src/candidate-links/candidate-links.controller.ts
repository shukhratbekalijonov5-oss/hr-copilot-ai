import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CandidateLinksService } from './candidate-links.service';
import { UpsertCandidateLinkDto } from './dto/upsert-candidate-link.dto';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * The candidate's own professional links.
 *
 * Mounted under `candidate-account/me/` alongside `me/documents`, because it is
 * the same thing from the product's point of view: the evidence a job seeker
 * maintains about themselves. @CandidateScoped, so an ORGANIZATION account is
 * refused whatever its token claims, and there is no id in any path but the
 * link's own — the subject is always the caller.
 *
 * There is NO recruiter-side counterpart of this controller, and there must
 * never be one. HR cannot create candidates, cannot upload their files, and
 * cannot add, edit, delete or refresh their links: all candidate evidence
 * originates with the candidate.
 */
@CandidateScoped()
@Controller('candidate-account/me/links')
export class CandidateLinksController {
  constructor(private readonly service: CandidateLinksService) {}

  /** The caller's links plus the remaining slot count for the UI. */
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.service.list(userId);
  }

  /** Adds a link (max 3) and queues the fetch. 409 on the fourth. */
  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCandidateLinkDto,
  ) {
    return this.service.create(userId, dto);
  }

  /** Edits the URL and/or label. A changed URL re-fetches from scratch. */
  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertCandidateLinkDto,
  ) {
    return this.service.update(userId, id, dto);
  }

  /**
   * Removes the link and its personal index entries. Application snapshots
   * already submitted are untouched, by design.
   */
  @Delete(':id')
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(userId, id);
  }

  /** Retry a transient failure, or refresh a page that has changed. */
  @Post(':id/reprocess')
  reprocess(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.reprocess(userId, id);
  }
}

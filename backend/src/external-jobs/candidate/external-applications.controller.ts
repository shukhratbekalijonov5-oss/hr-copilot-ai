import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ExternalApplicationTrackingService } from './external-application-tracking.service';
import { UpdateExternalApplicationDto } from './dto/track-external-application.dto';
import { ExternalApplicationsQueryDto } from './dto/external-applications-query.dto';
import { CandidateScoped } from '../../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresCapability } from '../../entitlements/requires-capability.decorator';

/**
 * The candidate's external application trackers, addressed by tracker id.
 *
 * Deliberately a DIFFERENT path family (`external-job-applications`) from the
 * internal `/candidate-account/me/applications`: an internal Application is a
 * relationship with a vacancy this product hosts; these are the candidate's
 * own notes about applications made on other companies' websites. The two
 * never share a route, a model or a service.
 *
 * Ownership is resolved from the authenticated caller on every route; a
 * tracker that exists but belongs to someone else answers exactly like one
 * that does not exist.
 */
// Part of the same MAX product as the external workspace above — a tracker
// is a feature OF external search, not a free-floating notebook.
@CandidateScoped()
@RequiresCapability('EXTERNAL_AI_SEARCH')
@Controller('candidate-account/me/external-job-applications')
export class ExternalApplicationsController {
  constructor(private readonly tracking: ExternalApplicationTrackingService) {}

  /** The tracking list: appliedAt DESC, optionally one status. */
  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ExternalApplicationsQueryDto,
  ) {
    return this.tracking.list(userId, query);
  }

  /** The candidate corrects their own record — any subset, any direction. */
  @Patch(':trackingId')
  update(
    @CurrentUser('id') userId: string,
    @Param('trackingId', ParseUUIDPipe) trackingId: string,
    @Body() dto: UpdateExternalApplicationDto,
  ) {
    return this.tracking.update(userId, trackingId, dto);
  }

  /** Removes the record entirely. By specific id, so unknown/foreign is 404. */
  @Delete(':trackingId')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser('id') userId: string,
    @Param('trackingId', ParseUUIDPipe) trackingId: string,
  ) {
    return this.tracking.remove(userId, trackingId);
  }
}

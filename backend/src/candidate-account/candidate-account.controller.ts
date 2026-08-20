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
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CandidateAccountService } from './candidate-account.service';
import { UpsertCandidateAccountDto } from './dto/upsert-candidate-account.dto';
import { JobMatchesDto } from './dto/job-matches.dto';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { ValidatableFile } from '../documents/file-validation';

/**
 * Self-service job-seeker endpoints. @CandidateScoped: every route requires a
 * live CANDIDATE account — an ORGANIZATION account gets 403 whatever its
 * token says. Never @OrgScoped: a candidate account belongs to the user, not
 * to any tenant.
 *
 * There is no :userId anywhere — the subject is always the caller.
 */
@CandidateScoped()
@Controller('candidate-account')
export class CandidateAccountController {
  constructor(private readonly service: CandidateAccountService) {}

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCandidateAccountDto,
  ) {
    return this.service.create(userId, dto);
  }

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.service.getMine(userId);
  }

  @Patch('me')
  update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertCandidateAccountDto,
  ) {
    return this.service.updateMine(userId, dto);
  }

  @Post('me/resume')
  @UseInterceptors(FileInterceptor('file'))
  uploadResume(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: ValidatableFile | undefined,
  ) {
    return this.service.uploadResume(userId, file);
  }

  @Get('me/resume')
  resumeDownload(@CurrentUser('id') userId: string) {
    return this.service.getResumeDownload(userId);
  }

  @Get('me/applications')
  applications(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.listMyApplications(userId, query);
  }

  @Get('me/applications/:id')
  application(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getMyApplication(userId, id);
  }

  /** The only status transition a candidate may perform. */
  @HttpCode(HttpStatus.OK)
  @Post('me/applications/:id/withdraw')
  withdraw(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.withdraw(userId, id);
  }

  /**
   * AI job matching over the caller's own profile + personal resume. Needs no
   * organization membership of any kind; a dual-identity user's active
   * organization plays no part in it.
   */
  @HttpCode(HttpStatus.OK)
  @Post('me/job-matches')
  jobMatches(@CurrentUser('id') userId: string, @Body() dto: JobMatchesDto) {
    return this.service.jobMatches(userId, dto);
  }

  @Get('me/saved-jobs')
  savedJobs(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.service.listSavedJobs(userId, query);
  }

  @HttpCode(HttpStatus.OK)
  @Post('me/saved-jobs/:slug')
  saveJob(@CurrentUser('id') userId: string, @Param('slug') slug: string) {
    return this.service.saveJob(userId, slug);
  }

  @Delete('me/saved-jobs/:slug')
  unsaveJob(@CurrentUser('id') userId: string, @Param('slug') slug: string) {
    return this.service.unsaveJob(userId, slug);
  }
}

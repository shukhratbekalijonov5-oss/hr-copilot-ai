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

  /**
   * Legacy single-resume flow: REPLACES the current primary resume. Kept for
   * the existing frontend; new UI should use the me/documents collection.
   */
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

  /**
   * The caller's evidence state: how many files and links they currently have,
   * and the revision those counts are at.
   *
   * Cheap (two counts) and deliberately separate from the collections, because
   * the screens that need it — the Job Match gate and its staleness check —
   * need the numbers and not the rows. The revision is what lets a rendered
   * match result say whether it still describes the current evidence.
   */
  @Get('me/evidence')
  evidence(@CurrentUser('id') userId: string) {
    return this.service.getEvidenceState(userId);
  }

  // -- Personal document collection (max 3 files, owner-only) --------------

  @Get('me/documents')
  documents(@CurrentUser('id') userId: string) {
    return this.service.listPersonalDocuments(userId);
  }

  /** Adds a document; 409 PERSONAL_DOCUMENT_LIMIT_REACHED when at the cap. */
  @Post('me/documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: ValidatableFile | undefined,
  ) {
    return this.service.uploadPersonalDocument(userId, file);
  }

  @Get('me/documents/:id/download-url')
  documentDownload(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getPersonalDocumentDownload(userId, id);
  }

  /** Permanent delete of ONE own document: bytes, rows and vectors. */
  @Delete('me/documents/:id')
  deleteDocument(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deletePersonalDocument(userId, id);
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

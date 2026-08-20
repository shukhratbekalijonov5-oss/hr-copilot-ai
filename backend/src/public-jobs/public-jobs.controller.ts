import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PublicJobsService } from './public-jobs.service';
import { QueryPublicJobsDto } from './dto/query-public-jobs.dto';
import { Public } from '../common/decorators/public.decorator';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * The public job board. Browsing needs no authentication; applying is
 * @CandidateScoped — only a CANDIDATE account may apply, an ORGANIZATION
 * account gets 403. Jobs are addressed by their stable publicSlug only.
 */
@Controller('public/jobs')
export class PublicJobsController {
  constructor(private readonly service: PublicJobsService) {}

  @Public()
  @Get()
  list(@Query() query: QueryPublicJobsDto) {
    return this.service.list(query);
  }

  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.service.detail(slug);
  }

  /** Authenticated candidate-only application (deliberately NOT @Public). */
  @CandidateScoped()
  @HttpCode(HttpStatus.CREATED)
  @Post(':slug/apply')
  apply(@CurrentUser('id') userId: string, @Param('slug') slug: string) {
    return this.service.apply(userId, slug);
  }
}

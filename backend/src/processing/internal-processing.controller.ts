import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ProcessingService } from './processing.service';
import {
  REPORTABLE_STAGES,
  ReportProgressDto,
} from './dto/report-progress.dto';
import { Public } from '../common/decorators/public.decorator';
import { InternalServiceGuard } from '../common/guards/internal-service.guard';

/**
 * Service-to-service callback surface. Not for browsers.
 *
 * `@Public()` opts out of the *user* JWT guard only — InternalServiceGuard then
 * requires the shared service token instead. Throttling is skipped because the
 * caller is the AI service reporting several stages per document.
 */
@Public()
@SkipThrottle()
@UseGuards(InternalServiceGuard)
@Controller('internal/processing')
export class InternalProcessingController {
  constructor(private readonly processingService: ProcessingService) {}

  /**
   * Records a pipeline stage that the AI service has actually completed.
   *
   * This exists so progress is real rather than fabricated: a single
   * request/response call could only guess at intermediate states, so the
   * service that does the work reports each stage as it finishes.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('progress')
  async reportProgress(@Body() dto: ReportProgressDto): Promise<void> {
    if (!REPORTABLE_STAGES.includes(dto.stage)) {
      // COMPLETED/FAILED are terminal and belong to the queue worker.
      throw new BadRequestException(
        `Stage ${dto.stage} cannot be reported by the AI service`,
      );
    }

    await this.processingService.recordStage(
      dto.organizationId,
      dto.documentId,
      dto.stage,
      dto.progress,
    );
  }
}

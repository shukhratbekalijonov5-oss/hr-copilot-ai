import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { AiAnswerService } from './ai-answer.service';
import { EvidenceSearchDto } from './dto/evidence-search.dto';
import {
  AiAnswerDto,
  CandidateSummaryDto,
  InterviewQuestionsDto,
} from './dto/ai-answer.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';

/**
 * HR-facing evidence search.
 *
 * This is the only search surface exposed to the frontend; the AI service's
 * /internal/* routes are never reachable from a browser. The organization is
 * taken from the authenticated user, never from the request body.
 */
@OrgScoped()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @HttpCode(HttpStatus.OK)
  @Post('evidence')
  searchEvidence(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: EvidenceSearchDto,
  ) {
    return this.searchService.searchEvidence(organizationId, dto);
  }
}

/**
 * Grounded AI endpoints.
 *
 * Separate controller so the existing `POST /api/search/evidence` contract is
 * untouched — a frontend session is already building against it.
 */
@OrgScoped()
@Controller('ai')
export class AiController {
  constructor(private readonly aiAnswerService: AiAnswerService) {}

  /** Grounded answer with validated citations. */
  @HttpCode(HttpStatus.OK)
  @Post('answer')
  answer(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: AiAnswerDto,
  ) {
    return this.aiAnswerService.answer(organizationId, dto);
  }

  /** What this candidate's documents state. Not a quality assessment. */
  @HttpCode(HttpStatus.OK)
  @Post('candidates/:candidateId/summary')
  summary(
    @CurrentUser('organizationId') organizationId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: CandidateSummaryDto,
  ) {
    return this.aiAnswerService.summariseCandidate(
      organizationId,
      candidateId,
      dto.locale ?? 'en',
    );
  }

  /** Interview prompts for a human, drawn from present and missing evidence. */
  @HttpCode(HttpStatus.OK)
  @Post('candidates/:candidateId/vacancies/:vacancyId/interview-questions')
  interviewQuestions(
    @CurrentUser('organizationId') organizationId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Param('vacancyId', ParseUUIDPipe) vacancyId: string,
    @Body() dto: InterviewQuestionsDto,
  ) {
    return this.aiAnswerService.interviewQuestions(
      organizationId,
      candidateId,
      vacancyId,
      dto.locale ?? 'en',
    );
  }
}

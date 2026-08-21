import { Module } from '@nestjs/common';
import { AiController, SearchController } from './search.controller';
import { SearchService } from './search.service';
import { AiAnswerService } from './ai-answer.service';
import { CandidateEvidenceModule } from '../candidate-evidence/candidate-evidence.module';

@Module({
  imports: [CandidateEvidenceModule],
  controllers: [SearchController, AiController],
  providers: [SearchService, AiAnswerService],
  exports: [SearchService, AiAnswerService],
})
export class SearchModule {}

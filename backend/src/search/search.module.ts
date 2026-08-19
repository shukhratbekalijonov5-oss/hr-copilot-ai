import { Module } from '@nestjs/common';
import { AiController, SearchController } from './search.controller';
import { SearchService } from './search.service';
import { AiAnswerService } from './ai-answer.service';

@Module({
  controllers: [SearchController, AiController],
  providers: [SearchService, AiAnswerService],
  exports: [SearchService, AiAnswerService],
})
export class SearchModule {}

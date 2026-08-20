import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { OrgConversationsController } from './org-conversations.controller';
import { CandidateConversationsController } from './candidate-conversations.controller';

@Module({
  controllers: [OrgConversationsController, CandidateConversationsController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}

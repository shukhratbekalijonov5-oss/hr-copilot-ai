import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CandidateScoped } from '../common/decorators/candidate-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';

/**
 * Candidate-side interview chat. @CandidateScoped (live account-type check);
 * the subject is always the caller — a candidate can only ever list and read
 * conversations whose CandidateAccount is their own, and a foreign id 404s
 * indistinguishably from a non-existent one.
 */
@CandidateScoped()
@Controller('candidate-account/me/conversations')
export class CandidateConversationsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.chatService.listForCandidate(userId, query);
  }

  @Get(':id')
  get(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getForCandidate(userId, id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.chatService.listMessagesForCandidate(userId, id, query);
  }

  @Post(':id/messages')
  send(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessageAsCandidate(userId, id, dto.content);
  }
}

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
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * Organization-side interview chat under the vacancy-scoped workspace rule:
 * an HR user reads and writes ONLY the conversations of vacancies they
 * personally created — organization membership alone no longer grants access
 * to a colleague's interview chats. Conversation CREATION stays impossible
 * here: only the interview-invitation transition
 * (POST /applications/:id/invite-interview) creates conversations.
 * organizationId always comes from the guard-validated membership, never from
 * the client.
 */
@OrgScoped()
@Controller('conversations')
export class OrgConversationsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryConversationsDto,
  ) {
    return this.chatService.listForOrganization(
      user.organizationId!,
      user.id,
      query,
    );
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getForOrganization(
      user.organizationId!,
      user.id,
      id,
    );
  }

  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.chatService.listMessagesForOrganization(
      user.organizationId!,
      user.id,
      id,
      query,
    );
  }

  @Post(':id/messages')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessageAsOrganization(
      user.organizationId!,
      user.id,
      id,
      dto.content,
    );
  }
}

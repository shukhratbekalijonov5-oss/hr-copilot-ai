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
 * Organization-side interview chat. Every member role may read and write —
 * INTERVIEWERs are exactly the people interviews are held with — while
 * conversation CREATION stays impossible here: only the interview-invitation
 * transition (POST /applications/:id/invite-interview) creates conversations.
 * organizationId always comes from the guard-validated membership, never from
 * the client.
 */
@OrgScoped()
@Controller('conversations')
export class OrgConversationsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryConversationsDto,
  ) {
    return this.chatService.listForOrganization(organizationId, query);
  }

  @Get(':id')
  get(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getForOrganization(organizationId, id);
  }

  @Get(':id/messages')
  messages(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.chatService.listMessagesForOrganization(
      organizationId,
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

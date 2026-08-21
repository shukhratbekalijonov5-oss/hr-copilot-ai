import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

/**
 * The recipient-only notification API — used by BOTH sides of the product, so
 * deliberately neither @OrgScoped nor @CandidateScoped: authentication is the
 * gate, and every query is anchored on the authenticated user id inside the
 * service. There is NO create endpoint: notifications are only ever created
 * by the backend listener from committed business events.
 *
 * Organization scoping here is WORKSPACE PRESENTATION, not authorization —
 * the hard wall is `recipientUserId === caller`, always. Because these
 * routes are not @OrgScoped, the guard-resolved `organizationId` is null;
 * the token's active-org claim decides which workspace's HR rows to show
 * (candidates have none and see only their personal rows). A stale claim can
 * at most show the caller THEIR OWN notifications from a workspace they
 * left — never anyone else's.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notifications.list(user.id, activeOrg(user), query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.id, activeOrg(user));
  }

  @Patch(':id/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.id, activeOrg(user), id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id, activeOrg(user));
  }
}

/** Guard-resolved org first (when present), else the token's workspace claim. */
function activeOrg(user: AuthenticatedUser): string | null {
  return user.organizationId ?? user.activeOrganizationClaim ?? null;
}

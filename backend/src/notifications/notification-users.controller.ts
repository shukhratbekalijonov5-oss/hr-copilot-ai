import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  Param,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Service-to-service guard for the notification user lookup: the Java
 * Notification Service presents the shared credential in `X-Internal-Token`.
 * Comparison is constant-time, and an UNSET credential rejects everything —
 * a deployment that forgot to configure the token exposes nothing. Browsers
 * never hold this token; the route is @Public only in the JWT sense.
 */
@Injectable()
export class InternalNotificationTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config
      .get<string>('notifications.userLookupToken', '')
      .trim();
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>();
    const provided = request.headers['x-internal-token'] ?? '';
    if (configured.length === 0 || provided.length === 0) {
      throw new UnauthorizedException();
    }
    const a = Buffer.from(configured, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/**
 * The CURRENT-recipient lookup the Java Notification Service calls at email
 * SEND time — which is the entire mechanism behind "email always goes to the
 * user's current address": nothing downstream ever persists an address as
 * delivery authority; every send re-asks this endpoint.
 *
 * Deliberately minimal: exactly one user by id, exactly four fields, 404
 * for anything unknown. This is not a user administration surface.
 */
@Public()
@UseGuards(InternalNotificationTokenGuard)
@Controller('internal/notification-users')
export class NotificationUsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':userId')
  async lookup(@Param('userId') userId: string): Promise<{
    userId: string;
    email: string;
    fullName: string;
    locale: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, preferredLocale: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      locale: user.preferredLocale,
    };
  }
}

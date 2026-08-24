import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterCandidateDto } from './dto/register-candidate.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { SwitchOrganizationDto } from './dto/switch-organization.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../generated/prisma/enums';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Creates a CANDIDATE account (User + CandidateAccount). Public. Rate
   * limited harder than the default to blunt credential stuffing. The old
   * combined POST /auth/register is gone: one email is exactly one account
   * type, so each type has its own explicit registration.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/candidate')
  registerCandidate(
    @Body() dto: RegisterCandidateDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.registerCandidate(dto, { userAgent });
  }

  /** Creates an ORGANIZATION account (User + Organization + OWNER membership). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/organization')
  registerOrganization(
    @Body() dto: RegisterOrganizationDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.registerOrganization(dto, { userAgent });
  }

  /**
   * One endpoint serves both sign-in doors: the optional `accountType`
   * declares which door the client rendered, and mismatching credentials are
   * refused after password verification (see LoginDto).
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.authService.login(dto, { userAgent, ip });
  }

  /**
   * Rotates the refresh token. Public route: the refresh token itself is the
   * credential (an expired access token must not block a refresh). Throttled
   * tighter than the default — a legitimate client refreshes once per access
   * token lifetime, not dozens of times a minute.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /** Revokes the CURRENT session only; other devices stay signed in. */
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logout(user);
  }

  /** Signs out everywhere: revokes every live session of the caller. */
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAll(user);
  }

  /** The caller's own live sessions; the current one is flagged. */
  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user);
  }

  /** Remote sign-out of ONE own session. Foreign/unknown ids are 404. */
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.revokeSession(user, id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.currentUser(user);
  }

  /**
   * Activates one of the caller's own organizations. Authenticated but not
   * @OrgScoped: it must work when the current token has no (or a stale)
   * organization context.
   */
  @HttpCode(HttpStatus.OK)
  @Post('switch-organization')
  switchOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchOrganizationDto,
  ) {
    return this.authService.switchOrganization(user, dto.organizationId);
  }

  /** Adds a teammate to the caller's active organization. */
  @OrgScoped()
  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Post('users')
  inviteUser(
    @CurrentUser('organizationId') organizationId: string,
    @Body() dto: InviteUserDto,
  ) {
    return this.authService.inviteUser(organizationId, dto);
  }
}

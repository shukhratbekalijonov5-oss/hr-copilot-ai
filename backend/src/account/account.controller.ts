import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountService } from './account.service';
import { UpdateAccountProfileDto } from './dto/update-account-profile.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { ValidatableFile } from '../documents/file-validation';

/**
 * Self-service account editing, for BOTH account types.
 *
 * Neither @OrgScoped nor @CandidateScoped: name, email and picture live on the
 * `users` row, which an HR user and a job seeker own in exactly the same way.
 * Scoping this to one side would mean two implementations of the same three
 * fields, and a candidate with no organization could not reach an org-scoped
 * one at all. Authentication alone is the right gate — the global JwtAuthGuard
 * provides it.
 *
 * There is no `:id` in any path. The subject is always the caller, so no
 * request can name another account, and tenant isolation is untouched: nothing
 * here reads or writes an organization-scoped table.
 */
@Controller('account')
export class AccountController {
  constructor(private readonly service: AccountService) {}

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.service.getMine(userId);
  }

  @Patch('me')
  update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAccountProfileDto,
  ) {
    return this.service.updateProfile(userId, dto);
  }

  /** Uploads or replaces the profile picture. */
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: ValidatableFile | undefined,
  ) {
    return this.service.uploadAvatar(userId, file);
  }

  /** Clears the profile picture. The account itself is untouched. */
  @Delete('me/avatar')
  deleteAvatar(@CurrentUser('id') userId: string) {
    return this.service.deleteAvatar(userId);
  }
}

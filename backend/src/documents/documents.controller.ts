import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { QueryDocumentsDto } from './dto/query-documents.dto';
import { LocalStorageService } from '../storage/local-storage.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import type { ValidatableFile } from './file-validation';

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly localStorage: LocalStorageService,
    private readonly configService: ConfigService,
  ) {}

  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser('organizationId') organizationId: string,
    @UploadedFile() file: ValidatableFile | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documentsService.upload(organizationId, file, dto);
  }

  @Get()
  findAll(
    @CurrentUser('organizationId') organizationId: string,
    @Query() query: QueryDocumentsDto,
  ) {
    return this.documentsService.findAll(organizationId, query);
  }

  /**
   * Local-driver download target. Public by design: authorisation is carried by
   * the HMAC signature and expiry minted in LocalStorageService.getSignedUrl,
   * exactly like a presigned R2 URL. With STORAGE_DRIVER=r2 this route is
   * unused — clients are sent straight to Cloudflare.
   */
  @Public()
  @Get('download')
  async download(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res() res: Response,
  ): Promise<void> {
    const body = await this.localStorage.readSigned(
      key ?? '',
      Number.parseInt(expires ?? '', 10),
      signature ?? '',
    );
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', body.byteLength);
    res.send(body);
  }

  @Get(':id')
  findOne(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentsService.findOne(organizationId, id);
  }

  @Get(':id/download-url')
  getDownloadUrl(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentsService.getDownloadUrl(organizationId, id);
  }

  @Roles(Role.OWNER, Role.HR_ADMIN)
  @Delete(':id')
  remove(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentsService.remove(organizationId, id);
  }
}

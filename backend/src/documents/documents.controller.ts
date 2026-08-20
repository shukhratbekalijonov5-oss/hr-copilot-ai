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
import { OrgScoped } from '../common/decorators/org-scoped.decorator';
import { Role } from '../generated/prisma/enums';
import type { ValidatableFile } from './file-validation';

@OrgScoped()
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
   *
   * The response must carry the REAL content type: the candidate-detail page
   * renders this URL in an iframe, and a PDF served as
   * `application/octet-stream` is downloaded (or ignored) by the browser
   * instead of rendered — the preview panel just stays blank. Metadata is
   * looked up by the signed key AFTER the signature verified; it grants
   * nothing. `inline` (never `attachment`) is what allows in-page rendering.
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
    const metadata = await this.documentsService.getServingMetadata(key ?? '');

    res.setHeader(
      'content-type',
      metadata?.mimeType ?? 'application/octet-stream',
    );
    res.setHeader(
      'content-disposition',
      inlineDisposition(metadata?.originalFileName ?? 'document'),
    );
    // Short-lived signed responses with resume content must never land in a
    // shared cache.
    res.setHeader('cache-control', 'private, no-store');
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

  /** Requeues a failed document without needing a re-upload. */
  @Roles(Role.OWNER, Role.HR_ADMIN, Role.RECRUITER)
  @Post(':id/reprocess')
  reprocess(
    @CurrentUser('organizationId') organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.documentsService.reprocess(organizationId, id);
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

/**
 * `inline` Content-Disposition with a safely encoded filename. The plain
 * `filename` fallback strips CR/LF/quotes (header-injection hygiene); the
 * RFC 5987 `filename*` carries the exact UTF-8 name for modern browsers —
 * uploads are routinely Korean/Russian/Uzbek.
 */
export function inlineDisposition(originalFileName: string): string {
  const fallback = originalFileName.replace(/[\r\n"\\]/g, '_');
  const encoded = encodeURIComponent(originalFileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

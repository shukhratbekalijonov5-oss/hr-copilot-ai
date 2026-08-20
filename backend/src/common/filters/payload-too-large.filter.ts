import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { DOCUMENT_ERROR_CODES } from '../../documents/document-policy';

/**
 * Normalises every 413 to the stable FILE_TOO_LARGE contract.
 *
 * An oversized upload is rejected at whichever layer sees it first: Multer's
 * `limits.fileSize` (which Nest surfaces as a bare "File too large"
 * PayloadTooLargeException with no `code`), or the service-level validator
 * (which already attaches the code). The frontend localizes on `code`, so the
 * Multer-layer rejection must carry it too — this filter is where the two
 * paths converge.
 */
@Catch(PayloadTooLargeException)
export class PayloadTooLargeFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const response = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: string }).message
        : 'File exceeds the upload size limit';

    response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      error: 'Payload Too Large',
      message,
      code: DOCUMENT_ERROR_CODES.FILE_TOO_LARGE,
    });
  }
}

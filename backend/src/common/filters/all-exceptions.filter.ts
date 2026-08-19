import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Last line of defence for error responses.
 *
 * Nest already renders HttpExceptions sensibly; the job here is the *other*
 * case. An unexpected error — a Prisma failure, a driver timeout — can carry a
 * connection string, a query containing candidate data, or internal paths in
 * its message. Those must never reach the client, so anything that is not an
 * HttpException is reported as a flat 500 and the detail goes to the server log
 * only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Websocket/RPC contexts have no HTTP response to write to.
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(exception.getResponse());
      return;
    }

    const message =
      exception instanceof Error ? exception.message : String(exception);

    // Server-side only. Never echoed to the client.
    this.logger.error(
      `Unhandled error on ${request.method} ${redactPath(request.url)}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
}

/**
 * Strips the query string before logging. Signed-download links carry an HMAC
 * signature there, and logging those would make the log itself a credential.
 */
function redactPath(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : `${url.slice(0, index)}?<redacted>`;
}

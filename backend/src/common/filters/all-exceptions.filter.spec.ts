import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function httpHost(
  url = '/api/candidates',
  method = 'GET',
): {
  host: ArgumentsHost;
  response: { status: jest.Mock; json: jest.Mock };
} {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url, method }),
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // The filter logs unexpected errors server-side; keep the suite quiet.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('HttpExceptions pass through unchanged', () => {
    it('preserves a 404 body', () => {
      const { host, response } = httpHost();

      filter.catch(new NotFoundException('Candidate not found'), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Candidate not found' }),
      );
    });

    it('preserves validation detail on a 400', () => {
      const { host, response } = httpHost();

      filter.catch(new BadRequestException(['email must be an email']), host);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(response.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: ['email must be an email'] }),
      );
    });
  });

  describe('unexpected errors are not leaked', () => {
    /**
     * The case that matters: a driver error can carry the connection string.
     * It must reach the log, never the client.
     */
    it('replaces a database error with a flat 500', () => {
      const { host, response } = httpHost();
      const leaky = new Error(
        'connect ECONNREFUSED postgresql://user:hunter2@db.internal:5432/hr',
      );

      filter.catch(leaky, host);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      const body = JSON.stringify(response.json.mock.calls[0][0]);
      expect(body).not.toContain('hunter2');
      expect(body).not.toContain('postgresql://');
      expect(body).not.toContain('db.internal');
      expect(response.json).toHaveBeenCalledWith({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    });

    it('handles a thrown non-Error value', () => {
      const { host, response } = httpHost();

      filter.catch('something odd', host);

      expect(response.status).toHaveBeenCalledWith(500);
    });

    it('redacts the query string when logging', () => {
      const { host } = httpHost(
        '/api/documents/download?key=x&signature=secret123',
      );
      const logSpy = jest
        .spyOn(filter['logger'], 'error')
        .mockImplementation(() => undefined);

      filter.catch(new Error('boom'), host);

      const logged = String(logSpy.mock.calls[0][0]);
      expect(logged).not.toContain('secret123');
      expect(logged).toContain('<redacted>');
    });
  });

  describe('non-HTTP contexts', () => {
    it('rethrows rather than writing an HTTP response', () => {
      const wsHost = { getType: () => 'ws' } as unknown as ArgumentsHost;
      const error = new Error('ws failure');

      expect(() => filter.catch(error, wsHost)).toThrow(error);
    });
  });
});

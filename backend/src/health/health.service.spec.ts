import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

describe('HealthService', () => {
  let prisma: { ping: jest.Mock };
  let redis: { ping: jest.Mock };
  let service: HealthService;

  beforeEach(() => {
    prisma = { ping: jest.fn().mockResolvedValue(undefined) };
    redis = { ping: jest.fn().mockResolvedValue(undefined) };
    service = new HealthService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  describe('live', () => {
    it('reports ok without touching any dependency', () => {
      const result = service.live();

      expect(result.status).toBe('ok');
      expect(result.uptime).toEqual(expect.any(Number));
      expect(prisma.ping).not.toHaveBeenCalled();
      expect(redis.ping).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('reports ok when PostgreSQL and Redis both answer', async () => {
      const result = await service.ready();

      expect(result).toEqual({
        status: 'ok',
        checks: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });

    it('reports error when PostgreSQL is down', async () => {
      prisma.ping.mockRejectedValue(new Error('connection refused'));

      const result = await service.ready();

      expect(result.status).toBe('error');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.redis.status).toBe('up');
    });

    it('reports error when Redis is down', async () => {
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.ready();

      expect(result.status).toBe('error');
      expect(result.checks.redis.status).toBe('down');
    });

    it('checks both dependencies even when the first one fails', async () => {
      prisma.ping.mockRejectedValue(new Error('down'));

      await service.ready();

      expect(redis.ping).toHaveBeenCalled();
    });

    it('surfaces the driver code Prisma hides behind a generic message', () => {
      // Prisma reports connection failures as an unhelpful "Invalid invocation"
      // message with the real reason on `.code`.
      const prismaStyle = Object.assign(
        new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n\n'),
        { code: 'ECONNREFUSED' },
      );
      prisma.ping.mockRejectedValue(prismaStyle);

      return service.ready().then((result) => {
        expect(result.checks.database.error).toContain('ECONNREFUSED');
      });
    });

    it('unwraps a nested cause', async () => {
      const wrapped = new Error('query failed', {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      });
      prisma.ping.mockRejectedValue(wrapped);

      const result = await service.ready();

      expect(result.checks.database.error).toContain('ECONNREFUSED');
    });

    it('never leaks a connection string in the error output', async () => {
      // Drivers report failures without the URL; assert we do not add it back.
      prisma.ping.mockRejectedValue(new Error('connection refused'));
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379'));

      const serialised = JSON.stringify(await service.ready());

      expect(serialised).not.toMatch(/postgresql:\/\//);
      expect(serialised).not.toMatch(/redis:\/\//);
      expect(serialised).not.toMatch(/password/i);
    });
  });
});

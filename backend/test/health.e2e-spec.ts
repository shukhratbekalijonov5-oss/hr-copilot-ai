import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';

/**
 * Exercises the probe routes over real HTTP without requiring PostgreSQL or
 * Redis to be running: the two dependencies are stubbed so both the healthy
 * and the degraded response can be asserted deterministically.
 */
describe('Health endpoints (e2e)', () => {
  let app: INestApplication;
  const prisma = { ping: jest.fn() };
  const redis = { ping: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.ping.mockReset().mockResolvedValue(undefined);
    redis.ping.mockReset().mockResolvedValue(undefined);
  });

  describe('GET /health/live', () => {
    it('returns 200 while the process is alive', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
    });

    it('stays 200 even when the dependencies are down', async () => {
      prisma.ping.mockRejectedValue(new Error('down'));
      redis.ping.mockRejectedValue(new Error('down'));

      // Liveness answers "is the process running", not "can it serve".
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 when PostgreSQL and Redis both answer', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        checks: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });

    it('returns 503 when PostgreSQL is unreachable', async () => {
      prisma.ping.mockRejectedValue(new Error('connection refused'));

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.checks.database.status).toBe('down');
    });

    it('returns 503 when Redis is unreachable', async () => {
      redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.checks.redis.status).toBe('down');
    });

    it('never returns a connection string', async () => {
      prisma.ping.mockRejectedValue(new Error('connection refused'));

      const response = await request(app.getHttpServer()).get('/health/ready');

      expect(JSON.stringify(response.body)).not.toMatch(
        /postgresql:\/\/|redis:\/\//,
      );
    });
  });
});

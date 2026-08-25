import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProcessingIoAdapter } from './processing/io.adapter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { noStoreMiddleware } from './common/http/no-store.middleware';
import type { Express } from 'express';
import { PayloadTooLargeFilter } from './common/filters/payload-too-large.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  /**
   * Port resolution.
   *
   * The Next.js frontend owns 3000 locally, so the API defaults to 3001 and is
   * overridable with PORT. The value is read through ConfigService (which in
   * turn reads PORT, defaulting to 3001 in config/configuration.ts) rather than
   * being hardcoded anywhere in the codebase.
   */
  const port = config.get<number>('app.port', 3001);
  const frontendUrl = config.get<string>(
    'app.frontendUrl',
    'http://localhost:3000',
  );
  const globalPrefix = config.get<string>('app.globalPrefix', 'api');

  app.setGlobalPrefix(globalPrefix, {
    // Probes stay at the root so orchestrators need not know the API prefix.
    exclude: ['health/live', 'health/ready'],
  });

  /**
   * Reverse-proxy awareness, OFF unless deliberately configured.
   *
   * Behind TLS-terminating ingress every request reaches Node from the
   * proxy's address; without `trust proxy`, req.ip would be the proxy for
   * ALL clients — collapsing the per-IP throttler and the login-lockout IP
   * scoping into one shared bucket. Set TRUST_PROXY to the number of proxy
   * hops in front of the API (typically 1) — or an express `trust proxy`
   * preset such as `loopback`. Never enable it without a proxy actually
   * stripping/overwriting X-Forwarded-For, or clients could spoof their IP.
   */
  const trustProxy = config.get<string>('app.trustProxy', '');
  if (trustProxy) {
    const value = /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy;
    const express = app.getHttpAdapter().getInstance() as unknown as Express;
    express.set('trust proxy', value);
    logger.log(`Trusting reverse proxy (trust proxy = ${trustProxy})`);
  }

  // Private data must never land in a shared cache. One rule covers every
  // bearer-authenticated response plus the token-issuing auth routes.
  app.use(noStoreMiddleware(globalPrefix));

  /**
   * CORS: a single explicit origin, never '*' — credentials are enabled and the
   * wildcard is both rejected by browsers and unsafe in that combination.
   */
  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useWebSocketAdapter(new ProcessingIoAdapter(app, config));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Rejects unknown properties outright. This is what stops a client from
      // smuggling an `organizationId` into any DTO — tenancy comes from the JWT.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Ensures an unexpected error never returns a driver message to the client.
  // The more specific filter (later in the list) wins for 413s, so an
  // oversized upload always carries the stable FILE_TOO_LARGE code whether
  // Multer or the service-level validator rejected it.
  app.useGlobalFilters(new AllExceptionsFilter(), new PayloadTooLargeFilter());

  app.enableShutdownHooks();

  await app.listen(port);

  // Safe startup output only: no connection strings, secrets or tokens.
  logger.log(`HR Copilot API listening on port ${port}`);
  logger.log(`Health:   http://localhost:${port}/health/live`);
  logger.log(`API base: http://localhost:${port}/${globalPrefix}`);
}

void bootstrap();

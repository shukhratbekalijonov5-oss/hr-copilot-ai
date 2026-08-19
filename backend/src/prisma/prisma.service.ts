import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { describeError } from '../common/errors/describe-error';

/**
 * Prisma 7 connects through a driver adapter rather than a schema-level `url`.
 * The connection string is read from ConfigService and is never logged.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('database.url');
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    // With a driver adapter, $connect() does not itself open a socket, so it
    // succeeds even when the server is unreachable. Issue a real query so the
    // startup log reflects the actual state rather than claiming a connection
    // that does not exist.
    await this.$connect();
    try {
      await this.ping();
      this.logger.log('Database connection established');
    } catch (error) {
      // Startup continues: the readiness probe is what reports not-ready, and
      // the message never includes the connection string.
      this.logger.warn(
        `Database unavailable at startup: ${describeError(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight liveness probe used by the readiness endpoint. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}

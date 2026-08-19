import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Shared Redis connection used for health checks and any direct cache access.
 *
 * BullMQ intentionally does NOT reuse this client: it requires
 * `maxRetriesPerRequest: null` on its own blocking connections, which is a poor
 * setting for ordinary request/response traffic.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(configService: ConfigService) {
    const url = configService.getOrThrow<string>('redis.url');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    // Never interpolate the URL — it may carry credentials.
    this.client.on('error', (error: Error) =>
      this.logger.error(`Redis client error: ${error.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis connection established');
    } catch (error) {
      // Redis being down must not prevent the process from starting; the
      // readiness probe is what reports it as not-ready.
      this.logger.warn(
        `Redis unavailable at startup: ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error(`Unexpected PING reply: ${reply}`);
    }
  }
}

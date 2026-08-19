import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type CheckStatus = 'up' | 'down';

export interface DependencyCheck {
  status: CheckStatus;
  /** Present only when down. Carries the driver message, never a connection URL. */
  error?: string;
}

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: Record<string, DependencyCheck>;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: the process is up and able to answer. No dependencies touched. */
  live(): { status: 'ok'; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: can this instance actually serve traffic right now? */
  async ready(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
    ]);

    const checks = { database, redis };
    const healthy = Object.values(checks).every((c) => c.status === 'up');
    return { status: healthy ? 'ok' : 'error', checks };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<DependencyCheck> {
  try {
    await fn();
    return { status: 'up' };
  } catch (error) {
    // Driver messages are safe to surface; URLs and credentials are not, and
    // ioredis/pg do not include them in these messages.
    return { status: 'down', error: (error as Error).message };
  }
}

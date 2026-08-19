import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Probes are public and exempt from rate limiting so an orchestrator can poll
 * them freely. They expose no tenant data and no configuration values.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** 200 whenever the process is alive. */
  @Get('live')
  live() {
    return this.healthService.live();
  }

  /** 200 when PostgreSQL and Redis both answer, 503 otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.healthService.ready();
    res.status(
      report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return report;
  }
}

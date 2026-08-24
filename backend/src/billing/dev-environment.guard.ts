import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Makes a route exist only OUTSIDE production.
 *
 * The rule is one comparison with no override: `NODE_ENV === 'production'`
 * → 404. Deliberately NOT a feature flag — a flag can be set by mistake,
 * and the whole point of a QA-only plan switch is that no configuration
 * combination re-enables it where money is real. The 404 is shaped exactly
 * like Nest's answer for a route that was never registered, so production
 * does not even confirm the path exists.
 *
 * This is also only the FIRST lock: the Java endpoint the guarded route
 * calls is itself absent in a production payment service (Spring
 * `@Profile({"dev","test"})` — the bean does not exist), so a production
 * plan switch would need BOTH deployments to be misbuilt at once.
 */
@Injectable()
export class DevEnvironmentGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const nodeEnv = this.config.get<string>('app.nodeEnv', 'development');
    if (nodeEnv !== 'production') return true;

    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    throw new NotFoundException(
      `Cannot ${request.method ?? 'POST'} ${request.url ?? ''}`,
    );
  }
}

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Makes the plan-switch route exist only outside production — with ONE
 * deliberate, owner-requested exception: `PORTFOLIO_DEMO_MODE=true`
 * re-enables it on a demo deployment so visitors can experience paid
 * tiers without a charge. The flag gates ONLY this route, is explicit
 * (never inferred), and the Java payment service applies the same gate
 * independently — a demo switch still requires BOTH deployments to opt
 * in, and every switch is audited there as source=PORTFOLIO_DEMO.
 *
 * Everywhere else the 404 is shaped exactly like Nest's answer for a
 * route that was never registered, so production does not even confirm
 * the path exists. The route itself remains authenticated and
 * candidate-scoped, and only ever acts on the CALLER'S own account (the
 * DTO rejects any smuggled userId).
 */
@Injectable()
export class DevEnvironmentGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const nodeEnv = this.config.get<string>('app.nodeEnv', 'development');
    if (nodeEnv !== 'production') return true;
    if (this.config.get<boolean>('app.portfolioDemoMode', false) === true) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; url?: string }>();
    throw new NotFoundException(
      `Cannot ${request.method ?? 'POST'} ${request.url ?? ''}`,
    );
  }
}

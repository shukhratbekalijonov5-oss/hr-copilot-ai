import { Logger } from '@nestjs/common';
import { parseScopeConfig, type ProviderScope } from '../../provider-scopes';

/**
 * Which Greenhouse boards this deployment reads.
 *
 * A thin naming layer over the shared scope registry: "board token" is
 * Greenhouse's word for the tenant slug every provider has, and the rules
 * about discovery, validation and path safety are identical for all of them.
 * See `provider-scopes.ts` for why they are what they are.
 */

export interface GreenhouseBoard extends ProviderScope {
  /** The board token as it appears in the API path. */
  boardToken: string;
}

export function parseBoardConfig(
  raw: string | undefined,
  logger?: Logger,
): GreenhouseBoard[] {
  return parseScopeConfig(raw, { logger, provider: 'Greenhouse' }).map(
    (scope) => ({ ...scope, boardToken: scope.slug }),
  );
}

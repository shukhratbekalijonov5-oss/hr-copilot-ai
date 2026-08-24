import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { parseScopeConfig } from '../../provider-scopes';

/**
 * Authorized Ninehire workspaces, and where their keys live.
 *
 * ## Why Ninehire needs its own registry
 *
 * Greenhouse, Lever and Ashby read PUBLIC boards: the scope list is the whole
 * configuration, and reading a board nobody told us about would be rude but
 * not unauthorized. Ninehire is different. Its API is authenticated per
 * WORKSPACE, so a workspace is only readable when an operator who is entitled
 * to that workspace has supplied its key. There is no public fallback, no
 * discovery, and no way to enumerate customers — a workspace with no
 * configured credential simply does not exist as far as this code is
 * concerned.
 *
 * ## The key is never in the scope list
 *
 * `EXTERNAL_NINEHIRE_SOURCES=acme:NINEHIRE_KEY_ACME` names an ENVIRONMENT
 * VARIABLE, not a secret. The value lives in that variable, is read at request
 * time, and never appears in the scope list, in `.env.example`, in a log line,
 * in a queue payload or in the database.
 *
 * Two consequences worth stating, because both are deliberate:
 *
 *  - adding a workspace is configuration, never a code change;
 *  - a source whose key reference resolves to nothing is DROPPED at
 *    construction rather than registered, because a source that can only ever
 *    return 401 is worse than no source: it fails on a schedule forever and
 *    teaches whoever reads the logs to ignore them.
 */

export interface NinehireSource {
  /** Operator-chosen identifier. Becomes the ingestion scope. */
  scope: string;
  /** Human label; also the company name when the payload states none. */
  label: string;
  /** The NAME of the environment variable holding the key. Never the key. */
  secretRef: string;
  enabled: boolean;
}

/**
 * An environment-variable name, and nothing that could be a secret.
 *
 * Deliberately narrow: uppercase, digits and underscores. A value containing
 * lowercase, punctuation or length beyond a name is far more likely to be
 * somebody pasting the key itself into the wrong field, and quietly accepting
 * that would put a live credential into the scope list — which is logged.
 */
const SECRET_REF = /^[A-Z][A-Z0-9_]{2,63}$/;

export function parseNinehireSources(
  raw: string | undefined,
  config: Pick<ConfigService, 'get'>,
  logger?: Logger,
): NinehireSource[] {
  // The scope half is validated exactly as every other provider's is.
  const scopes = parseScopeConfig(raw, { logger, provider: 'Ninehire' });
  const sources: NinehireSource[] = [];

  for (const scope of scopes) {
    /*
     * The label carries the secret reference: `scope:SECRET_REF` reuses the
     * shared `slug:Label` grammar rather than inventing a second one, and the
     * shared parser has already rejected URLs, traversal and encodings.
     */
    const secretRef = scope.label.trim();
    if (!SECRET_REF.test(secretRef)) {
      // The value is never echoed — if this IS a pasted key, logging it would
      // be the leak this check exists to prevent.
      logger?.warn(
        `Ninehire source "${scope.slug}" does not name a valid environment ` +
          `variable for its API key; skipping it`,
      );
      continue;
    }
    if (!readSecret(config, secretRef)) {
      logger?.warn(
        `Ninehire source "${scope.slug}" references ${secretRef}, which is ` +
          `not set; skipping it rather than scheduling requests that can only 401`,
      );
      continue;
    }
    sources.push({
      scope: scope.slug,
      label: scope.slug,
      secretRef,
      enabled: true,
    });
  }
  return sources;
}

/**
 * The key for a source, read at request time.
 *
 * Private by convention and by call site: nothing outside the provider's
 * request builder calls this, the result is put straight into an Authorization
 * header, and it is never returned upward, stored, or interpolated into a
 * string that could be logged.
 */
export function readSecret(
  config: Pick<ConfigService, 'get'>,
  secretRef: string,
): string | null {
  const value = config.get<string>(secretRef, '');
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

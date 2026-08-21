/**
 * robots.txt, respected.
 *
 * A candidate's link is fetched by a server, on a schedule, without a human at
 * the keyboard — that is a bot, and bots follow the site's stated rules. This
 * is not a security control (robots.txt protects nothing) but a
 * good-citizenship one, and it is part of the product's promise that nothing
 * here works around a site's access decisions.
 *
 * A missing, unreachable or unparseable robots.txt means "no rules stated",
 * which is allowed — the absence of a policy is not a prohibition.
 */

const MAX_RULES = 500;

export interface RobotsPolicy {
  isAllowed(path: string): boolean;
}

export const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true };

/**
 * Parses robots.txt for one user-agent.
 *
 * Implements the parts that matter for a single-page fetcher: grouped
 * `User-agent` blocks, `Allow`/`Disallow` paths, `*` and `$` wildcards, and
 * longest-match-wins with Allow beating Disallow on a tie (the de-facto
 * standard). Crawl-delay and Sitemap are irrelevant here and ignored.
 */
export function parseRobots(
  body: string,
  userAgentToken: string,
): RobotsPolicy {
  const token = userAgentToken.toLowerCase();

  let currentAgents: string[] = [];
  let sawDirective = false;
  const groups = new Map<string, Rule[]>();

  for (const rawLine of body.split(/\r?\n/).slice(0, 10_000)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      // A new User-agent line after directives starts a new group.
      if (sawDirective) {
        currentAgents = [];
        sawDirective = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      continue;
    }

    if (field !== 'allow' && field !== 'disallow') continue;
    sawDirective = true;
    for (const agent of currentAgents) {
      const rules = groups.get(agent);
      if (rules && rules.length < MAX_RULES) {
        rules.push({ allow: field === 'allow', pattern: value });
      }
    }
  }

  // Most specific group wins: our own token, else the wildcard, else no rules.
  const rules =
    [...groups.entries()].find(
      ([agent]) => token.includes(agent) && agent !== '*',
    )?.[1] ??
    groups.get('*') ??
    [];

  if (rules.length === 0) return ALLOW_ALL;

  return {
    isAllowed(path: string): boolean {
      let decision: { allow: boolean; length: number } | null = null;
      for (const rule of rules) {
        // An empty Disallow means "nothing is disallowed" and matches nothing.
        if (rule.pattern === '') continue;
        if (!matches(rule.pattern, path)) continue;
        const length = rule.pattern.length;
        if (
          !decision ||
          length > decision.length ||
          (length === decision.length && rule.allow)
        ) {
          decision = { allow: rule.allow, length };
        }
      }
      return decision ? decision.allow : true;
    },
  };
}

interface Rule {
  allow: boolean;
  pattern: string;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const expression = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${expression}${anchored ? '$' : ''}`).test(path);
}

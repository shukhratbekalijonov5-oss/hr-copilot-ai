import type { NextFunction, Request, Response } from 'express';

/**
 * Marks every response that can carry private data as non-cacheable:
 *
 *  - any request presenting an Authorization header (all private routes are
 *    bearer-authenticated, so this covers account, candidate, org, chat,
 *    notification, billing and AI surfaces in one rule), and
 *  - the auth routes themselves (login/register/refresh responses carry
 *    tokens but arrive WITHOUT an Authorization header).
 *
 * Deliberately nothing else: public content (public jobs, health) keeps its
 * default headers so a CDN/proxy MAY cache it. A route that sets its own
 * stricter header (signed downloads) still wins — this runs first.
 */
export function noStoreMiddleware(globalPrefix: string) {
  const authPathPrefix = `/${globalPrefix.replace(/^\/+|\/+$/g, '')}/auth`;
  return (req: Request, res: Response, next: NextFunction): void => {
    const onAuthRoute =
      req.path === authPathPrefix || req.path.startsWith(`${authPathPrefix}/`);
    if (req.headers.authorization || onAuthRoute) {
      res.setHeader('Cache-Control', 'no-store, private');
    }
    next();
  };
}

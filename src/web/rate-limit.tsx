import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../lib/ratelimit.js';
import { ErrorPage } from './pages/error.js';
import { renderPage } from './render.js';

// Per-IP limit on sign-in and OAuth routes (V§13): a brake on floods and guessing, not a
// security boundary (PKCE, consent, and CSRF are). Render's proxy puts the visitor's address
// first in X-Forwarded-For. A client can forge that header to dodge the limit, which only
// costs it the brake; it can't get past anything else. Verify the header on Render in P5.
export function clientIp(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor === undefined || forwardedFor === '' ? 'unknown' : forwardedFor;
}

export function limitPerIp(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    if (limiter.allowRequest(clientIp(c))) {
      await next();
      return;
    }
    c.header('Retry-After', '60');
    return renderPage(
      c,
      <ErrorPage title="Too many requests" message="Please wait a minute and try again." />,
      429,
    );
  };
}

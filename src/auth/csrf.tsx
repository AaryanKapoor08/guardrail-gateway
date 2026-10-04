import type { MiddlewareHandler } from 'hono';
import { csrf } from 'hono/csrf';
import type { Env } from '../config/env.js';
import { safeEqual } from '../lib/crypto.js';
import { ErrorPage } from '../web/pages/error.js';
import { renderPage } from '../web/render.js';
import type { SignedInEnv } from './sessions.js';

// Two layers of cross-site request forgery protection (V§13):
// 1. Every form POST must come from our own origin (Hono's Origin / Sec-Fetch-Site check).
// 2. Every signed-in form carries a per-session token that another site can't read.

// Machine-to-machine routes are called by other servers, which send no Origin header. They are
// protected differently: PKCE or token possession (/oauth/token, /oauth/revoke), bearer tokens
// (/mcp), and signatures (/webhooks).
const MACHINE_ROUTE_PREFIXES = ['/oauth/token', '/oauth/revoke', '/mcp', '/webhooks/'];

function isMachineRoute(path: string): boolean {
  return MACHINE_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function originCheck(env: Env): MiddlewareHandler {
  // Compare with our configured public origin, not the request URL: behind Render's proxy the
  // server sees http:// while the browser sends an https:// Origin.
  const checkOrigin = csrf({ origin: new URL(env.APP_BASE_URL).origin });
  return async (c, next) => {
    if (isMachineRoute(c.req.path)) {
      await next();
      return;
    }
    await checkOrigin(c, next);
  };
}

export function CsrfField(props: { token: string }) {
  return <input type="hidden" name="csrf" value={props.token} />;
}

// Must run after `requireSession`. Hono caches the parsed body, so handlers can parse it again.
export const verifyCsrf: MiddlewareHandler<SignedInEnv> = async (c, next) => {
  const form = await c.req.parseBody();
  const sentToken = form.csrf;
  if (typeof sentToken !== 'string' || !safeEqual(sentToken, c.var.session.csrfToken)) {
    return renderPage(
      c,
      <ErrorPage
        title="This form has expired"
        message="Go back, refresh the page, and try again."
      />,
      403,
    );
  }
  await next();
};

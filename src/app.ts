import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { registerApprovalRoutes } from './approvals/routes.js';
import { originCheck } from './auth/csrf.js';
import { registerLoginRoutes } from './auth/login-routes.js';
import type { Env } from './config/env.js';
import type { Deps } from './deps.js';
import { registerAuthorizeRoutes } from './oauth-server/authorize.js';
import { registerMetadataRoutes } from './oauth-server/metadata.js';
import { registerRevokeRoutes } from './oauth-server/revoke.js';
import { registerTokenRoutes } from './oauth-server/token.js';
import { contentSecurityPolicy } from './web/csp.js';
import { limitPerIp } from './web/rate-limit.js';
import { registerWebRoutes } from './web/routes.js';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// V§13: no framing (clickjacking), no referrer leaks of approval URLs. HSTS only in production,
// where the site is always HTTPS. The Content-Security-Policy is set by web/csp.ts.
function securityHeaders(env: Env) {
  return secureHeaders({
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity:
      env.NODE_ENV === 'production' ? `max-age=${ONE_YEAR_SECONDS}; includeSubDomains` : false,
  });
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.use('*', securityHeaders(deps.env));
  app.use('*', contentSecurityPolicy());
  app.use('*', originCheck(deps.env));
  app.use(
    '/static/*',
    serveStatic({ root: './public', rewriteRequestPath: (path) => path.replace(/^\/static/, '') }),
  );

  app.get('/health', async (context) => {
    try {
      await deps.db.execute(sql`select 1`);
      return context.json({ status: 'ok' });
    } catch (error) {
      // Handled: the health check's job is to report the outage (Render restarts or alerts),
      // not to crash. The error is logged without connection details.
      deps.logger.logError('[Health] database check failed', error, { route: '/health' });
      return context.json({ status: 'degraded' }, 503);
    }
  });

  // Per-IP limit on sign-in and every OAuth route (V§13).
  app.use('/login', limitPerIp(deps.limiters.signInPerIp));
  app.use('/oauth/*', limitPerIp(deps.limiters.signInPerIp));

  registerMetadataRoutes(app, deps.env);
  registerAuthorizeRoutes(app, deps);
  registerTokenRoutes(app, deps);
  registerRevokeRoutes(app, deps);
  registerLoginRoutes(app, deps);
  registerWebRoutes(app, deps);
  registerApprovalRoutes(app, deps);

  return app;
}

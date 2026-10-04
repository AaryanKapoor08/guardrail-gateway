import { serveStatic } from '@hono/node-server/serve-static';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { originCheck } from './auth/csrf.js';
import { registerLoginRoutes } from './auth/login-routes.js';
import type { Env } from './config/env.js';
import type { Deps } from './deps.js';
import { registerWebRoutes } from './web/routes.js';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

// V§13: no framing (clickjacking), no third-party anything, forms only post to us, no referrer
// leaks of approval URLs. HSTS only in production, where the site is always HTTPS.
function securityHeaders(env: Env) {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    strictTransportSecurity:
      env.NODE_ENV === 'production' ? `max-age=${ONE_YEAR_SECONDS}; includeSubDomains` : false,
  });
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  app.use('*', securityHeaders(deps.env));
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

  registerLoginRoutes(app, deps);
  registerWebRoutes(app, deps);

  return app;
}

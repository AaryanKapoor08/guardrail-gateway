import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Deps } from './deps.js';

export function createApp(deps: Deps): Hono {
  const app = new Hono();

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

  return app;
}

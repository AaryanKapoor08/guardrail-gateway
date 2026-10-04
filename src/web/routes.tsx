import type { Hono } from 'hono';
import { loadSession, requireSession } from '../auth/sessions.js';
import type { Deps } from '../deps.js';
import { DashboardPage } from './pages/dashboard.js';
import { HomePage } from './pages/home.js';
import { renderPage } from './render.js';

export function registerWebRoutes(app: Hono, deps: Deps): void {
  app.get('/', async (c) => {
    const signedIn = await loadSession(deps, c);
    return renderPage(c, <HomePage signedIn={signedIn ?? undefined} />);
  });

  app.get('/dashboard', requireSession(deps), (c) =>
    renderPage(c, <DashboardPage signedIn={{ session: c.var.session, user: c.var.user }} />),
  );
}

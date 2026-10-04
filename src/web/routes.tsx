import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { listUserAccounts, setAccountAllowed } from '../accounts/service.js';
import { verifyCsrf } from '../auth/csrf.js';
import { disconnectUser } from '../auth/disconnect.js';
import { destroySession, loadSession, requireSession, type SignedInEnv } from '../auth/sessions.js';
import type { Deps } from '../deps.js';
import { NeedsReauthError, NotFoundError } from '../lib/errors.js';
import { syncIfStale, syncUserConnectionsAndAccounts } from '../snaptrade/sync.js';
import { DashboardPage, type SyncProblem } from './pages/dashboard.js';
import { ErrorPage } from './pages/error.js';
import { HomePage } from './pages/home.js';
import { renderPage } from './render.js';

const AllowFormSchema = z.object({ allowed: z.enum(['true', 'false']) });

// A failed sync never breaks the dashboard: the page shows what we already have, plus a banner.
async function syncForPageLoad(deps: Deps, userId: string): Promise<SyncProblem> {
  try {
    await syncIfStale(deps, userId);
    return null;
  } catch (error) {
    if (error instanceof NeedsReauthError) {
      return 'needs-reauth';
    }
    deps.logger.logError('[Dashboard] account sync failed', error, { userId });
    return 'unavailable';
  }
}

async function showDashboard(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  const syncProblem = await syncForPageLoad(deps, user.id);
  const accounts = await listUserAccounts(deps, user.id);
  return renderPage(
    c,
    <DashboardPage
      signedIn={{ session, user }}
      accounts={accounts}
      syncProblem={syncProblem}
      mcpUrl={`${deps.env.APP_BASE_URL}/mcp`}
    />,
  );
}

async function changeAccountAllowed(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  const form = AllowFormSchema.safeParse(await c.req.parseBody());
  if (!form.success) {
    return renderPage(
      c,
      <ErrorPage title="Something was missing" message="Go back and try again." />,
      400,
    );
  }
  try {
    await setAccountAllowed(deps, {
      userId: user.id,
      accountRef: c.req.param('ref') ?? '',
      allowed: form.data.allowed === 'true',
    });
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
    return renderPage(
      c,
      <ErrorPage title="Not found" message={error.message} signedIn={{ session, user }} />,
      404,
    );
  }
  return c.redirect('/dashboard');
}

async function refreshAccounts(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  try {
    await syncUserConnectionsAndAccounts(deps, user.id);
    return c.redirect('/dashboard');
  } catch (error) {
    // Handled: tell the user what to do; the data we already have is unchanged.
    deps.logger.logError('[Dashboard] forced account sync failed', error, { userId: user.id });
    const message =
      error instanceof NeedsReauthError
        ? error.message
        : "We couldn't reach SnapTrade. Try again in a minute.";
    return renderPage(
      c,
      <ErrorPage
        title="Couldn't refresh your accounts"
        message={message}
        signedIn={{ session, user }}
        linkHref="/dashboard"
        linkText="Back to the dashboard"
      />,
      502,
    );
  }
}

async function disconnect(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { revokedAtSnapTrade } = await disconnectUser(deps, c.var.user.id);
  await destroySession(deps, c);
  const message = revokedAtSnapTrade
    ? 'Guardrail Gateway no longer has access to your SnapTrade accounts, and every connected AI app was cut off. Your history is kept; sign in again any time.'
    : 'We deleted our copy of your SnapTrade access and cut off every connected AI app, but SnapTrade did not confirm the revocation. Also remove Guardrail Gateway in your SnapTrade dashboard.';
  return renderPage(c, <ErrorPage title="Disconnected" message={message} />);
}

export function registerWebRoutes(app: Hono, deps: Deps): void {
  app.get('/', async (c) => {
    const signedIn = await loadSession(deps, c);
    return renderPage(c, <HomePage signedIn={signedIn ?? undefined} />);
  });

  app.get('/dashboard', requireSession(deps), (c) => showDashboard(deps, c));
  app.post('/accounts/refresh', requireSession(deps), verifyCsrf, (c) => refreshAccounts(deps, c));
  app.post('/disconnect', requireSession(deps), verifyCsrf, (c) => disconnect(deps, c));
  app.post('/accounts/:ref/allow', requireSession(deps), verifyCsrf, (c) =>
    changeAccountAllowed(deps, c),
  );
}

import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { listUserAccounts, newlyFoundAccounts, setAccountAllowed } from '../accounts/service.js';
import { verifyCsrf } from '../auth/csrf.js';
import { disconnectUser } from '../auth/disconnect.js';
import { destroySession, loadSession, requireSession, type SignedInEnv } from '../auth/sessions.js';
import type { Deps } from '../deps.js';
import { listPaperPositions } from '../executors/paper.js';
import { grantHasTradeScope } from '../intents/context.js';
import { liveModeProblems } from '../intents/controls.js';
import { cancelIntent } from '../intents/decisions.js';
import { listRecentIntents } from '../intents/service.js';
import { NeedsReauthError, NotFoundError } from '../lib/errors.js';
import { disconnectApp, listConnectedApps } from '../oauth-server/grants.js';
import { syncIfStale, syncUserConnectionsAndAccounts } from '../snaptrade/sync.js';
import { AppsPage } from './pages/apps.js';
import { DashboardPage, type SyncProblem } from './pages/dashboard.js';
import { ErrorPage } from './pages/error.js';
import { HomePage } from './pages/home.js';
import { IntentsPage } from './pages/intents.js';
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
  const [accounts, pendingIntents, paperPositions, ordersAtBroker, hasTradeScope] =
    await Promise.all([
      listUserAccounts(deps, user.id),
      listRecentIntents(deps, user.id, { limit: 20, statuses: ['PENDING_APPROVAL'] }),
      listPaperPositions(deps.db, user.id),
      listRecentIntents(deps, user.id, { limit: 20, statuses: ['SUBMITTED', 'UNKNOWN'] }),
      grantHasTradeScope(deps.db, user.id),
    ]);
  return renderPage(
    c,
    <DashboardPage
      signedIn={{ session, user }}
      accounts={accounts}
      syncProblem={syncProblem}
      mcpUrl={`${deps.env.APP_BASE_URL}/mcp`}
      pendingIntents={pendingIntents}
      paperPositions={paperPositions}
      ordersAtBroker={ordersAtBroker}
      liveModeProblems={liveModeProblems(deps, user, hasTradeScope)}
      newAccounts={newlyFoundAccounts(accounts, deps.now())}
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

const INTENT_HISTORY_LIMIT = 50;

async function showIntents(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  const intents = await listRecentIntents(deps, user.id, { limit: INTENT_HISTORY_LIMIT });
  return renderPage(c, <IntentsPage signedIn={{ session, user }} intents={intents} />);
}

async function cancelFromHistory(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  try {
    await cancelIntent(deps, { userId: user.id, intentId: c.req.param('id') ?? '', actor: 'user' });
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
    return renderPage(
      c,
      <ErrorPage title="Order not found" message={error.message} signedIn={{ session, user }} />,
      404,
    );
  }
  return c.redirect('/intents');
}

async function showApps(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  const apps = await listConnectedApps(deps.db, user.id);
  return renderPage(c, <AppsPage signedIn={{ session, user }} apps={apps} />);
}

async function revokeApp(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  const grantId = z.uuid().safeParse(c.req.param('id'));
  try {
    if (!grantId.success) {
      throw new NotFoundError("We couldn't find that app.");
    }
    await disconnectApp(deps, { userId: user.id, grantId: grantId.data });
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
    return renderPage(
      c,
      <ErrorPage title="App not found" message={error.message} signedIn={{ session, user }} />,
      404,
    );
  }
  return c.redirect('/apps');
}

export function registerWebRoutes(app: Hono, deps: Deps): void {
  app.get('/', async (c) => {
    const signedIn = await loadSession(deps, c);
    return renderPage(c, <HomePage signedIn={signedIn ?? undefined} />);
  });

  app.get('/dashboard', requireSession(deps), (c) => showDashboard(deps, c));
  app.post('/accounts/refresh', requireSession(deps), verifyCsrf, (c) => refreshAccounts(deps, c));
  app.post('/disconnect', requireSession(deps), verifyCsrf, (c) => disconnect(deps, c));
  app.get('/intents', requireSession(deps), (c) => showIntents(deps, c));
  app.post('/intents/:id/cancel', requireSession(deps), verifyCsrf, (c) =>
    cancelFromHistory(deps, c),
  );
  app.post('/accounts/:ref/allow', requireSession(deps), verifyCsrf, (c) =>
    changeAccountAllowed(deps, c),
  );
  app.get('/apps', requireSession(deps), (c) => showApps(deps, c));
  app.post('/apps/:id/revoke', requireSession(deps), verifyCsrf, (c) => revokeApp(deps, c));
}

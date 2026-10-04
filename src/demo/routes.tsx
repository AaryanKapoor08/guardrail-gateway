import { and, eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { verifyCsrf } from '../auth/csrf.js';
import { requireSession, type SignedInEnv, setSessionCookie } from '../auth/sessions.js';
import { accounts } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { listPaperPositions } from '../executors/paper.js';
import { getIntent, listRecentIntents, proposeOrder } from '../intents/service.js';
import type { IntentView } from '../intents/view.js';
import { NotFoundError } from '../lib/errors.js';
import { ErrorPage } from '../web/pages/error.js';
import { clientIp } from '../web/rate-limit.js';
import { renderPage } from '../web/render.js';
import { DEMO_TFSA_ID } from './demo-brokerage.js';
import { countDemoUsers, MAX_ACTIVE_DEMO_USERS, startDemo } from './demo-users.js';
import { findGuidedStep, GUIDED_DEMO_PROPOSER } from './guided-steps.js';
import { SignInPage, TryPage } from './pages.js';

// POST /demo/start, GET /signin, GET /try, POST /try/:step (V§4.7). /demo/start has no session
// yet, so it is protected by the Origin check (originCheck in app.ts) and its own limits.

function mcpRequestIdFrom(value: unknown): string | undefined {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function busyPage(c: Context, message: string) {
  return renderPage(
    c,
    <ErrorPage
      title="The demo is busy"
      message={message}
      linkHref="/login"
      linkText="Sign in with SnapTrade"
    />,
    429,
  );
}

async function startDemoRequest(deps: Deps, c: Context): Promise<Response> {
  if (!deps.limiters.demoStartsPerIp.allowRequest(clientIp(c))) {
    return busyPage(
      c,
      'Too many demos were started from your network in the last hour. Try again later.',
    );
  }
  if ((await countDemoUsers(deps)) >= MAX_ACTIVE_DEMO_USERS) {
    return busyPage(c, 'The demo is busy, try again soon or sign in with SnapTrade.');
  }
  const form = await c.req.parseBody();
  const { sessionId } = await startDemo(deps);
  setSessionCookie(c, deps.env, sessionId);
  // Came from Claude's connector sign-in: go on to the consent page for this demo account.
  const mcpRequestId = mcpRequestIdFrom(form.mcp_request);
  return c.redirect(
    mcpRequestId === undefined ? '/try' : `/oauth/authorize/resume?request=${mcpRequestId}`,
  );
}

async function demoTfsaRef(deps: Deps, userId: string): Promise<string> {
  const [row] = await deps.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, DEMO_TFSA_ID)));
  if (row === undefined) {
    throw new NotFoundError('The demo account is missing. Start a new demo.');
  }
  return row.id;
}

// A shared result id from the query string, shown only if it is this user's intent.
async function resultFor(deps: Deps, userId: string, intentId: string | undefined) {
  if (intentId === undefined) {
    return null;
  }
  try {
    return await getIntent(deps, userId, intentId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return null;
    }
    throw error;
  }
}

async function showTry(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { session, user } = c.var;
  if (!user.isDemo) {
    return c.redirect('/dashboard');
  }
  const [intents, result, paperPositions] = await Promise.all([
    listRecentIntents(deps, user.id, { limit: 50 }),
    resultFor(deps, user.id, c.req.query('result')),
    listPaperPositions(deps.db, user.id),
  ]);
  return renderPage(
    c,
    <TryPage
      signedIn={{ session, user }}
      intents={intents}
      result={result}
      paperPositions={paperPositions}
      mcpUrl={`${deps.env.APP_BASE_URL}/mcp`}
    />,
  );
}

async function runStep(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const { user } = c.var;
  const step = findGuidedStep(c.req.param('step') ?? '');
  if (!user.isDemo || step === undefined) {
    return c.redirect('/dashboard');
  }
  const result = await proposeOrder(deps, {
    userId: user.id,
    proposer: { actor: 'user', actorDetail: GUIDED_DEMO_PROPOSER, grantId: null },
    input: {
      account_ref: await demoTfsaRef(deps, user.id),
      symbol: step.order.symbol,
      side: 'buy',
      quantity: step.order.quantity,
      order_type: 'market',
    },
  });
  if (result.kind !== 'intent') {
    return renderPage(
      c,
      <ErrorPage
        title="That step didn't run"
        message={result.reason}
        linkHref="/try"
        linkText="Back to the guided demo"
      />,
      400,
    );
  }
  const intent: IntentView = result.intent;
  return c.redirect(`/try?result=${intent.id}#result`);
}

export function registerDemoRoutes(app: Hono, deps: Deps): void {
  app.post('/demo/start', (c) => startDemoRequest(deps, c));
  app.get('/signin', (c) =>
    renderPage(c, <SignInPage mcpRequestId={mcpRequestIdFrom(c.req.query('mcp_request'))} />),
  );
  app.get('/try', requireSession(deps), (c) => showTry(deps, c));
  app.post('/try/:step', requireSession(deps), verifyCsrf, (c) => runStep(deps, c));
}

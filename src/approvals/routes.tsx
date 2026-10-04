import type { Context, Hono } from 'hono';
import { verifyCsrf } from '../auth/csrf.js';
import { requireSession, type SignedInEnv } from '../auth/sessions.js';
import type { Deps } from '../deps.js';
import { approveIntent, denyIntent } from '../intents/decisions.js';
import { getIntent } from '../intents/service.js';
import { countDuplicatePending } from '../intents/view.js';
import { NotFoundError } from '../lib/errors.js';
import { ErrorPage } from '../web/pages/error.js';
import { renderPage } from '../web/render.js';
import { ApprovalPage } from './approval-page.js';

// GET shows the order and never changes it (apart from reflecting expiry). Approve and Deny are
// POSTs with a CSRF token, so an opened link (or an email scanner) can never act (V§4.4).

function notFound(c: Context<SignedInEnv>) {
  const { session, user } = c.var;
  return renderPage(
    c,
    <ErrorPage
      title="Order not found"
      message="We couldn't find that order in your account."
      signedIn={{ session, user }}
      linkHref="/dashboard"
      linkText="Back to the dashboard"
    />,
    404,
  );
}

// Unknown ids and other users' intents both answer 404, so ids can't be probed (V§13).
async function withIntentNotFoundAs404(
  c: Context<SignedInEnv>,
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof NotFoundError) {
      return notFound(c);
    }
    throw error;
  }
}

async function showApproval(deps: Deps, c: Context<SignedInEnv>, notice?: string) {
  const { session, user } = c.var;
  const intent = await getIntent(deps, user.id, c.req.param('id') ?? '');
  const duplicateCount = await countDuplicatePending(deps.db, intent);
  return renderPage(
    c,
    <ApprovalPage
      signedIn={{ session, user }}
      intent={intent}
      duplicateCount={duplicateCount}
      notice={notice}
    />,
    notice === undefined ? 200 : 503,
  );
}

async function approve(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const intentId = c.req.param('id') ?? '';
  const result = await approveIntent(deps, { userId: c.var.user.id, intentId });
  if (result.kind === 'unavailable') {
    return showApproval(
      deps,
      c,
      `Couldn't get a fresh price from your broker, so nothing was approved. ${result.reason}`,
    );
  }
  return c.redirect(`/approvals/${intentId}`);
}

async function deny(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const intentId = c.req.param('id') ?? '';
  await denyIntent(deps, { userId: c.var.user.id, intentId });
  return c.redirect(`/approvals/${intentId}`);
}

export function registerApprovalRoutes(app: Hono, deps: Deps): void {
  app.get('/approvals/:id', requireSession(deps), (c) =>
    withIntentNotFoundAs404(c, () => showApproval(deps, c)),
  );
  app.post('/approvals/:id/approve', requireSession(deps), verifyCsrf, (c) =>
    withIntentNotFoundAs404(c, () => approve(deps, c)),
  );
  app.post('/approvals/:id/deny', requireSession(deps), verifyCsrf, (c) =>
    withIntentNotFoundAs404(c, () => deny(deps, c)),
  );
}

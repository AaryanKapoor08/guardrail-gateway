import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { deleteAccount } from '../accounts/deletion.js';
import { listAuditEvents } from '../audit/read.js';
import { verifyCsrf } from '../auth/csrf.js';
import { destroySession, loadSession, requireSession, type SignedInEnv } from '../auth/sessions.js';
import type { Deps } from '../deps.js';
import { setKillSwitch, setMode } from '../intents/controls.js';
import {
  type PolicyFormValues,
  policyToFormValues,
  savePolicy,
} from '../settings/policy-editor.js';
import { loadPolicy } from '../settings/policy-store.js';
import { AuditPage } from './pages/audit.js';
import { DELETE_CONFIRMATION, DeleteAccountPage, GoodbyePage } from './pages/delete-account.js';
import { ErrorPage } from './pages/error.js';
import { PolicyPage } from './pages/policy.js';
import { PrivacyPage } from './pages/privacy.js';
import { renderPage } from './render.js';

// The user's controls (V§6.6): policy, kill switch, mode, audit log, account deletion, and the
// public privacy page. Each route parses its form, calls one service function, then renders or
// redirects.

const AUDIT_LOG_LIMIT = 100;

function signedInOf(c: Context<SignedInEnv>) {
  return { session: c.var.session, user: c.var.user };
}

async function showPolicy(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const policy = await loadPolicy(deps.db, c.var.user.id);
  return renderPage(
    c,
    <PolicyPage
      signedIn={signedInOf(c)}
      values={policyToFormValues(policy.rules)}
      version={policy.version}
      problems={[]}
      isSaved={c.req.query('saved') === '1'}
    />,
  );
}

const textField = z.string().default('');

const PolicyFormSchema = z.object({
  allowedSides: z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform((value) => (typeof value === 'string' ? [value] : value)),
  maxOrderValue: textField,
  maxDailyValue: textField,
  maxOrdersPerDay: textField,
  symbolAllowlist: textField,
  symbolDenylist: textField,
  policyCurrency: textField,
  approvalWindowMinutes: textField,
});

async function updatePolicy(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const form = PolicyFormSchema.safeParse(await c.req.parseBody({ all: true }));
  if (!form.success) {
    return renderPage(
      c,
      <ErrorPage
        title="That form didn't make sense"
        message="Reload the policy page and try again."
      />,
      400,
    );
  }
  const values: PolicyFormValues = form.data;
  const result = await savePolicy(deps, { userId: c.var.user.id, values });
  if (result.ok) {
    return c.redirect('/policy?saved=1');
  }
  const policy = await loadPolicy(deps.db, c.var.user.id);
  return renderPage(
    c,
    <PolicyPage
      signedIn={signedInOf(c)}
      values={values}
      version={policy.version}
      problems={result.problems}
      isSaved={false}
    />,
    400,
  );
}

const KillSwitchFormSchema = z.object({ state: z.enum(['on', 'off']) });

async function changeKillSwitch(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const form = KillSwitchFormSchema.safeParse(await c.req.parseBody());
  if (!form.success) {
    return c.redirect('/dashboard');
  }
  await setKillSwitch(deps, { userId: c.var.user.id, on: form.data.state === 'on' });
  return c.redirect('/dashboard#kill-switch');
}

const ModeFormSchema = z.object({ mode: z.enum(['paper', 'live']) });

async function changeMode(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const form = ModeFormSchema.safeParse(await c.req.parseBody());
  if (!form.success) {
    return c.redirect('/dashboard');
  }
  const result = await setMode(deps, { userId: c.var.user.id, mode: form.data.mode });
  if (result.ok) {
    return c.redirect('/dashboard');
  }
  return renderPage(
    c,
    <ErrorPage
      title="Live mode isn't available"
      message={result.problems.join(' ')}
      signedIn={signedInOf(c)}
      linkHref="/dashboard"
      linkText="Back to the dashboard"
    />,
    409,
  );
}

async function showAudit(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const entries = await listAuditEvents(deps.db, c.var.user.id, AUDIT_LOG_LIMIT);
  return renderPage(c, <AuditPage signedIn={signedInOf(c)} entries={entries} />);
}

async function deleteAccountRequest(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const form = await c.req.parseBody();
  if (form.confirm !== DELETE_CONFIRMATION) {
    return renderPage(
      c,
      <DeleteAccountPage
        signedIn={signedInOf(c)}
        problem={`Nothing was deleted. Type ${DELETE_CONFIRMATION} in capital letters to confirm.`}
      />,
      400,
    );
  }
  const { user } = c.var;
  const { revokedAtSnapTrade } = await deleteAccount(deps, user);
  await destroySession(deps, c);
  return renderPage(c, <GoodbyePage revokedAtSnapTrade={revokedAtSnapTrade} />);
}

export function registerSettingsRoutes(app: Hono, deps: Deps): void {
  app.get('/policy', requireSession(deps), (c) => showPolicy(deps, c));
  app.post('/policy', requireSession(deps), verifyCsrf, (c) => updatePolicy(deps, c));
  app.post('/kill-switch', requireSession(deps), verifyCsrf, (c) => changeKillSwitch(deps, c));
  app.post('/mode', requireSession(deps), verifyCsrf, (c) => changeMode(deps, c));
  app.get('/audit', requireSession(deps), (c) => showAudit(deps, c));
  app.get('/account/delete', requireSession(deps), (c) =>
    renderPage(c, <DeleteAccountPage signedIn={signedInOf(c)} />),
  );
  app.post('/account/delete', requireSession(deps), verifyCsrf, (c) =>
    deleteAccountRequest(deps, c),
  );
  app.get('/privacy', async (c) => {
    const signedIn = await loadSession(deps, c);
    return renderPage(c, <PrivacyPage signedIn={signedIn ?? undefined} />);
  });
}

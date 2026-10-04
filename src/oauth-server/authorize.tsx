import { and, eq, gt } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { writeAudit } from '../audit/write.js';
import { verifyCsrf } from '../auth/csrf.js';
import { loadSession, requireSession, type SignedInEnv } from '../auth/sessions.js';
import { lockUserRow } from '../db/locks.js';
import { mcpAuthCodes, mcpAuthRequests } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';
import { allowFormRedirectTo } from '../web/csp.js';
import { ErrorPage } from '../web/pages/error.js';
import { renderPage } from '../web/render.js';
import { checkAuthorizeParameters, redirectBackUrl } from './authorize-params.js';
import {
  checkClientIdUrl,
  fetchClientMetadata,
  isLoopbackRedirect,
  redirectUriAllowed,
} from './cimd.js';
import { ConsentPage } from './consent-page.js';
import { activeGrantFor } from './grants.js';
import { SCOPE_OFFLINE_ACCESS } from './metadata.js';

// GET /oauth/authorize (V§11.3 steps 1–7): check the app, remember the request, make sure the
// user is signed in, then ask for consent. The code is issued only on the consent POST.

export const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 60 * 1000;

type AuthRequest = typeof mcpAuthRequests.$inferSelect;

// Before the app and its redirect URI are verified, errors are shown on our own page: we must
// never redirect to an address we haven't validated.
function badRequestPage(c: Context, message: string) {
  return renderPage(c, <ErrorPage title="Can't connect this app" message={message} />, 400);
}

function expiredRequestPage(c: Context) {
  return badRequestPage(
    c,
    'This connection request expired or was already used. Start connecting again from your AI app.',
  );
}

async function startAuthorization(deps: Deps, c: Context): Promise<Response> {
  const query = c.req.query();
  const clientId = query.client_id ?? '';
  const clientCheck = checkClientIdUrl(deps.env, clientId);
  if (!clientCheck.ok) {
    return badRequestPage(c, clientCheck.reason);
  }
  const client = await fetchClientMetadata(deps, clientId);
  if (!client.ok) {
    return badRequestPage(c, client.reason);
  }
  const redirectUri = query.redirect_uri ?? '';
  if (!redirectUriAllowed(redirectUri, client.metadata.redirect_uris)) {
    return badRequestPage(c, 'The app asked to send you back to an address it never registered.');
  }
  const checked = checkAuthorizeParameters(deps.env, query);
  if (!checked.ok) {
    return c.redirect(
      redirectBackUrl(deps.env, redirectUri, {
        error: checked.error,
        error_description: checked.description,
        state: query.state,
      }),
    );
  }
  const now = deps.now();
  const [saved] = await deps.db
    .insert(mcpAuthRequests)
    .values({
      clientId,
      redirectUri,
      ...checked.parameters,
      createdAt: now,
      expiresAt: new Date(now.getTime() + AUTH_REQUEST_TTL_MS),
    })
    .returning({ id: mcpAuthRequests.id });
  if (saved === undefined) {
    throw new Error('[OAuth] authorization request insert returned no row');
  }
  // Signed out: sign in first (SnapTrade or the instant demo); both come back to the consent page.
  const signedIn = await loadSession(deps, c);
  return c.redirect(
    signedIn === null
      ? `/signin?mcp_request=${saved.id}`
      : `/oauth/authorize/resume?request=${saved.id}`,
  );
}

async function findOpenRequest(deps: Deps, requestId: string): Promise<AuthRequest | null> {
  if (!z.uuid().safeParse(requestId).success) {
    return null;
  }
  const [request] = await deps.db
    .select()
    .from(mcpAuthRequests)
    .where(and(eq(mcpAuthRequests.id, requestId), gt(mcpAuthRequests.expiresAt, deps.now())));
  return request ?? null;
}

async function showConsent(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const request = await findOpenRequest(deps, c.req.query('request') ?? '');
  if (request === null) {
    return expiredRequestPage(c);
  }
  const redirectUrl = new URL(request.redirectUri);
  allowFormRedirectTo(c, redirectUrl.origin);
  return renderPage(
    c,
    <ConsentPage
      signedIn={{ session: c.var.session, user: c.var.user }}
      requestId={request.id}
      ourHost={new URL(deps.env.APP_BASE_URL).host}
      clientHost={new URL(request.clientId).host}
      redirectHost={redirectUrl.host}
      isLoopback={isLoopbackRedirect(request.redirectUri)}
      canStayConnected={request.scope.split(' ').includes(SCOPE_OFFLINE_ACCESS)}
    />,
  );
}

// Uses the request up in the same statement that finds it, so one consent can't issue twice.
async function consumeRequest(deps: Deps, requestId: string): Promise<AuthRequest | null> {
  const [request] = await deps.db
    .delete(mcpAuthRequests)
    .where(and(eq(mcpAuthRequests.id, requestId), gt(mcpAuthRequests.expiresAt, deps.now())))
    .returning();
  return request ?? null;
}

// The single-use code: 32 random bytes, stored only as a hash, valid for 60 seconds.
async function issueAuthorizationCode(
  deps: Deps,
  request: { userId: string; authRequest: AuthRequest },
): Promise<string> {
  const { authRequest, userId } = request;
  const code = randomToken(32);
  const clientHost = new URL(authRequest.clientId).host;
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, userId);
    const now = deps.now();
    const grantId = await activeGrantFor(tx, {
      userId,
      clientId: authRequest.clientId,
      clientHost,
      scope: authRequest.scope,
      now,
    });
    await tx.insert(mcpAuthCodes).values({
      codeHash: sha256Hex(code),
      grantId,
      redirectUri: authRequest.redirectUri,
      codeChallenge: authRequest.codeChallenge,
      scope: authRequest.scope,
      resource: authRequest.resource,
      expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
    });
    await writeAudit(tx, {
      userId,
      actor: 'user',
      eventType: 'mcp.grant_approved',
      details: { clientHost, scope: authRequest.scope },
      createdAt: now,
    });
  });
  return code;
}

const DecisionFormSchema = z.object({
  request: z.uuid(),
  decision: z.enum(['approve', 'deny']),
});

async function decide(deps: Deps, c: Context<SignedInEnv>): Promise<Response> {
  const form = DecisionFormSchema.safeParse(await c.req.parseBody());
  const authRequest = form.success ? await consumeRequest(deps, form.data.request) : null;
  if (!form.success || authRequest === null) {
    return expiredRequestPage(c);
  }
  if (form.data.decision === 'deny') {
    return c.redirect(
      redirectBackUrl(deps.env, authRequest.redirectUri, {
        error: 'access_denied',
        error_description: 'The user denied access.',
        state: authRequest.state,
      }),
    );
  }
  const code = await issueAuthorizationCode(deps, { userId: c.var.user.id, authRequest });
  return c.redirect(
    redirectBackUrl(deps.env, authRequest.redirectUri, { code, state: authRequest.state }),
  );
}

export function registerAuthorizeRoutes(app: Hono, deps: Deps): void {
  app.get('/oauth/authorize', (c) => startAuthorization(deps, c));
  app.get('/oauth/authorize/resume', requireSession(deps), (c) => showConsent(deps, c));
  app.post('/oauth/authorize/decision', requireSession(deps), verifyCsrf, (c) => decide(deps, c));
}

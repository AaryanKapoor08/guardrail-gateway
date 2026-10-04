import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { safeEqual } from '../lib/crypto.js';
import { syncUserConnectionsAndAccounts } from '../snaptrade/sync.js';
import { ErrorPage } from '../web/pages/error.js';
import { renderPage } from '../web/render.js';
import { verifyCsrf } from './csrf.js';
import { safeReturnTo } from './return-to.js';
import { destroySession, requireSession, sessionCookieName, setSessionCookie } from './sessions.js';
import {
  completeSignIn,
  consumeLoginAttempt,
  LOGIN_ATTEMPT_TTL_MS,
  startLoginAttempt,
} from './sign-in.js';

const LOGIN_COOKIE = 'gg_login';

function signInAgainPage(c: Context, title: string, message: string) {
  return renderPage(
    c,
    <ErrorPage title={title} message={message} linkHref="/login" linkText="Sign in again" />,
    400,
  );
}

// `mcp_request` comes from /oauth/authorize: after sign-in, the user continues to the AI app's
// consent page instead of the dashboard.
function mcpAuthRequestIdFrom(c: Context): string | null {
  const parsed = z.uuid().safeParse(c.req.query('mcp_request'));
  return parsed.success ? parsed.data : null;
}

async function startLogin(deps: Deps, c: Context): Promise<Response> {
  try {
    const { cookieValue, authorizeUrl } = await startLoginAttempt(deps, {
      returnTo: safeReturnTo(c.req.query('return_to')),
      mcpAuthRequestId: mcpAuthRequestIdFrom(c),
    });
    setCookie(c, LOGIN_COOKIE, cookieValue, {
      httpOnly: true,
      secure: deps.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: LOGIN_ATTEMPT_TTL_MS / 1000,
    });
    return c.redirect(authorizeUrl);
  } catch (error) {
    // Handled: SnapTrade's metadata is unreachable. Nothing was started, so the user can retry.
    deps.logger.logError('[Login] could not start sign-in', error, { route: '/login' });
    return renderPage(
      c,
      <ErrorPage
        title="Sign-in is unavailable"
        message="We couldn't reach SnapTrade. Try again in a minute."
      />,
      503,
    );
  }
}

async function syncAfterSignIn(deps: Deps, userId: string): Promise<void> {
  try {
    await syncUserConnectionsAndAccounts(deps, userId);
  } catch (error) {
    // Handled: sign-in itself succeeded. The dashboard retries the sync and shows a banner.
    deps.logger.logError('[Login] account sync after sign-in failed', error, { userId });
  }
}

async function finishLogin(deps: Deps, c: Context): Promise<Response> {
  const cookieValue = getCookie(c, LOGIN_COOKIE);
  deleteCookie(c, LOGIN_COOKIE, { path: '/', secure: deps.env.NODE_ENV === 'production' });
  const attempt = cookieValue === undefined ? null : await consumeLoginAttempt(deps, cookieValue);
  if (attempt === null) {
    return signInAgainPage(
      c,
      'Sign-in expired',
      'This sign-in has expired or was already used. Try again.',
    );
  }
  if (c.req.query('error') !== undefined) {
    return renderPage(
      c,
      <ErrorPage
        title="You declined"
        message="You declined the SnapTrade permission request, so nothing was stored."
      />,
    );
  }
  const state = c.req.query('state');
  const code = c.req.query('code');
  if (state === undefined || !safeEqual(state, attempt.state) || code === undefined) {
    return signInAgainPage(
      c,
      'Sign-in could not be verified',
      'Something didn’t match. Try again.',
    );
  }
  try {
    const previousSessionId = getCookie(c, sessionCookieName(deps.env));
    const { userId, sessionId } = await completeSignIn(deps, { attempt, code, previousSessionId });
    setSessionCookie(c, deps.env, sessionId);
    await syncAfterSignIn(deps, userId);
    return c.redirect(
      attempt.mcpAuthRequestId === null
        ? safeReturnTo(attempt.returnTo)
        : `/oauth/authorize/resume?request=${attempt.mcpAuthRequestId}`,
    );
  } catch (error) {
    // Handled: the code exchange or id_token check failed. Nothing was saved (one transaction).
    deps.logger.logError('[Login] sign-in failed', error, { route: '/oauth/snaptrade/callback' });
    return signInAgainPage(
      c,
      'Sign-in failed',
      'We couldn’t complete sign-in with SnapTrade. Try again.',
    );
  }
}

export function registerLoginRoutes(app: Hono, deps: Deps): void {
  app.get('/login', (c) => startLogin(deps, c));
  app.get('/oauth/snaptrade/callback', (c) => finishLogin(deps, c));
  app.post('/logout', requireSession(deps), verifyCsrf, async (c) => {
    await destroySession(deps, c);
    return c.redirect('/');
  });
}

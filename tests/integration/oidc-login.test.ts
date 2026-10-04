import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { safeReturnTo } from '../../src/auth/return-to.js';
import type { DatabaseConnection } from '../../src/db/client.js';
import {
  auditEvents,
  loginAttempts,
  policies,
  sessions,
  snaptradeGrants,
  users,
} from '../../src/db/schema.js';
import { aadFor, decryptField } from '../../src/lib/crypto.js';
import { DEFAULT_POLICY } from '../../src/policy/schema.js';
import {
  buildTestApp,
  callbackUrl,
  findSetCookie,
  getPage,
  postForm,
  readSetCookies,
  SESSION_COOKIE,
  signInTestUser,
  startLogin,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import type { AuthorizeOptions } from '../helpers/fake-snaptrade.js';

let connection: DatabaseConnection;
let testApp: TestApp;

beforeAll(async () => {
  connection = await setupTestDb();
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(connection.db);
  testApp = await buildTestApp(connection);
});

async function countUsers(): Promise<number> {
  const [row] = await testApp.deps.db.select({ total: count() }).from(users);
  return row?.total ?? 0;
}

// Runs /login and the callback with the given consent options; returns the callback response.
async function completeLogin(options: AuthorizeOptions = {}, loginPath = '/login') {
  const { authorizeUrl, loginCookie } = await startLogin(testApp, loginPath);
  const code = testApp.fake.authorize(authorizeUrl, options);
  const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
  return testApp.app.request(callbackUrl({ code, state }), {
    headers: { cookie: `gg_login=${loginCookie}` },
  });
}

describe('GET /login', () => {
  it('redirects to SnapTrade with PKCE, state, nonce, and only the scopes we need', async () => {
    const { authorizeUrl } = await startLogin(testApp);

    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://dashboard.snaptrade.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/oauth/snaptrade/callback',
    );
    expect(url.searchParams.get('scope')).toBe('openid email read webhook');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('asks for the trade scope only when configured to', async () => {
    testApp = await buildTestApp(connection, {
      envOverrides: { SNAPTRADE_REQUEST_TRADE_SCOPE: 'true' },
    });

    const { authorizeUrl } = await startLogin(testApp);

    expect(new URL(authorizeUrl).searchParams.get('scope')).toBe('openid email read webhook trade');
  });

  it('stores the PKCE verifier encrypted and sets a short-lived login cookie', async () => {
    const response = await testApp.app.request('/login');

    const cookie = findSetCookie(response, 'gg_login') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=600');
    const [attempt] = await testApp.deps.db.select().from(loginAttempts);
    expect(attempt?.codeVerifierEnc).toMatch(/^v1:/);
  });
});

describe('GET /oauth/snaptrade/callback', () => {
  it('creates the user, encrypted grant, default policy, and a session on success', async () => {
    const response = await completeLogin({ sub: 'sub-abc', email: 'aaryan@example.com' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/dashboard');
    const [user] = await testApp.deps.db.select().from(users);
    expect(user).toMatchObject({ snaptradeSub: 'sub-abc', email: 'aaryan@example.com' });
    expect(user?.emailVerified).toBe(true);
    const userId = user?.id ?? '';
    const [grant] = await testApp.deps.db.select().from(snaptradeGrants);
    expect(grant?.accessTokenEnc).toMatch(/^v1:/);
    expect(grant?.refreshTokenEnc).toMatch(/^v1:/);
    const key = testApp.deps.env.TOKEN_ENCRYPTION_KEY;
    const refreshToken = decryptField(
      grant?.refreshTokenEnc ?? '',
      key,
      aadFor(userId, 'refresh_token'),
    );
    expect(testApp.fake.currentRefreshTokens()).toContain(refreshToken);
    const accessToken = decryptField(
      grant?.accessTokenEnc ?? '',
      key,
      aadFor(userId, 'access_token'),
    );
    expect(accessToken).toMatch(/^access_/);
    expect(grant?.accessExpiresAt.getTime()).toBe(testApp.clock.now().getTime() + 36_000_000);
    const [policy] = await testApp.deps.db.select().from(policies);
    expect(policy).toMatchObject({ userId, version: 1, rules: DEFAULT_POLICY });
    const [audit] = await testApp.deps.db.select().from(auditEvents);
    expect(audit).toMatchObject({ userId, actor: 'user', eventType: 'user.signed_in' });
    const [session] = await testApp.deps.db.select().from(sessions);
    expect(session?.userId).toBe(userId);
  });

  it('shows the signed-in email on the dashboard', async () => {
    const user = await signInTestUser(testApp, { email: 'aaryan@example.com' });

    const response = await getPage(testApp, '/dashboard', user.cookie);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('aaryan@example.com');
  });

  it('shows a friendly page and stores nothing when the user declines', async () => {
    const { loginCookie } = await startLogin(testApp);

    const response = await testApp.app.request(
      callbackUrl({ error: 'access_denied', state: 'whatever' }),
      { headers: { cookie: `gg_login=${loginCookie}` } },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('nothing was stored');
    expect(await countUsers()).toBe(0);
  });

  it('rejects a wrong state with 400 and uses up the attempt', async () => {
    const { authorizeUrl, loginCookie } = await startLogin(testApp);
    const code = testApp.fake.authorize(authorizeUrl);
    const goodState = new URL(authorizeUrl).searchParams.get('state') ?? '';
    const cookie = { headers: { cookie: `gg_login=${loginCookie}` } };

    const wrongState = await testApp.app.request(callbackUrl({ code, state: 'forged' }), cookie);
    const replay = await testApp.app.request(callbackUrl({ code, state: goodState }), cookie);

    expect(wrongState.status).toBe(400);
    expect(await wrongState.text()).toContain('could not be verified');
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain('Sign-in expired');
    expect(await countUsers()).toBe(0);
  });

  it('rejects a callback with no login cookie', async () => {
    const response = await testApp.app.request(callbackUrl({ code: 'x', state: 'y' }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Sign-in expired');
  });

  it('rejects a login attempt older than 10 minutes', async () => {
    const { authorizeUrl, loginCookie } = await startLogin(testApp);
    const code = testApp.fake.authorize(authorizeUrl);
    const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
    testApp.clock.advanceMs(10 * 60 * 1000 + 1);

    const response = await testApp.app.request(callbackUrl({ code, state }), {
      headers: { cookie: `gg_login=${loginCookie}` },
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Sign-in expired');
    expect(await countUsers()).toBe(0);
  });

  it.each<[string, AuthorizeOptions]>([
    ['a wrong nonce', { idTokenClaims: { nonce: 'someone-elses-nonce' } }],
    ['a wrong audience', { idTokenClaims: { aud: 'another-client' } }],
    ['a wrong issuer', { idTokenClaims: { iss: 'https://evil.example.com' } }],
    ['an unknown signing key', { signWithUnknownKey: true }],
    ['an expired id_token', { idTokenClaims: { exp: 1_000_000_000 } }],
  ])('rejects an id_token with %s and stores nothing', async (_name, options) => {
    const response = await completeLogin(options);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Sign-in failed');
    expect(await countUsers()).toBe(0);
  });

  it('rejects the sign-in when SnapTrade refuses the code', async () => {
    testApp.fake.failNextTokenRequest({ status: 400, body: { error: 'invalid_grant' } });

    const response = await completeLogin();

    expect(response.status).toBe(400);
    expect(await countUsers()).toBe(0);
  });

  it('sets a secure session cookie and issues a new session id at every sign-in', async () => {
    const first = await signInTestUser(testApp);
    const { authorizeUrl, loginCookie } = await startLogin(testApp);
    const code = testApp.fake.authorize(authorizeUrl);
    const state = new URL(authorizeUrl).searchParams.get('state') ?? '';

    const response = await testApp.app.request(callbackUrl({ code, state }), {
      headers: { cookie: `gg_login=${loginCookie}; ${first.cookie}` },
    });

    const cookie = findSetCookie(response, SESSION_COOKIE) ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=86400');
    const secondSessionId = readSetCookies(response)[SESSION_COOKIE];
    expect(secondSessionId).not.toBe(first.sessionId);
    const oldSession = await getPage(testApp, '/dashboard', first.cookie);
    expect(oldSession.status).toBe(302);
  });

  it('returns to the page the user started from, but never to another site', async () => {
    const local = await completeLogin({}, '/login?return_to=%2Fapprovals%2Fabc');
    const offsite = await completeLogin({}, '/login?return_to=%2F%2Fevil.com');

    expect(local.headers.get('location')).toBe('/approvals/abc');
    expect(offsite.headers.get('location')).toBe('/dashboard');
  });

  it('never writes codes or tokens to the logs', async () => {
    const { authorizeUrl, loginCookie } = await startLogin(testApp);
    const code = testApp.fake.authorize(authorizeUrl);
    const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
    await testApp.app.request(callbackUrl({ code, state }), {
      headers: { cookie: `gg_login=${loginCookie}` },
    });

    const allLogs = testApp.logs.join('\n');
    expect(allLogs).not.toContain(code);
    expect(allLogs).not.toContain(state);
    expect(allLogs).not.toMatch(/access_[0-9a-f]{32}|refresh_[0-9a-f]{32}/);
  });
});

describe('sessions and CSRF', () => {
  it('sends a signed-out visitor to sign-in, remembering the page', async () => {
    const response = await getPage(testApp, '/dashboard');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?return_to=%2Fdashboard');
  });

  it('refuses POST /logout without a CSRF token', async () => {
    const user = await signInTestUser(testApp);

    const response = await postForm(testApp, '/logout', { cookie: user.cookie });

    expect(response.status).toBe(403);
  });

  it('refuses a form POST from another site even with a valid token', async () => {
    const user = await signInTestUser(testApp);

    const response = await testApp.app.request('/logout', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example.com',
        cookie: user.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrf: user.csrfToken }).toString(),
    });

    expect(response.status).toBe(403);
  });

  it('signs out with a valid token and deletes the session', async () => {
    const user = await signInTestUser(testApp);

    const response = await postForm(testApp, '/logout', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const remaining = await testApp.deps.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.userId));
    expect(remaining).toHaveLength(0);
  });
});

describe('security headers', () => {
  it('forbids framing and referrers on HTML pages', async () => {
    const response = await getPage(testApp, '/');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('starts HTML pages with a doctype and the not-financial-advice footer', async () => {
    const response = await getPage(testApp, '/');

    const html = await response.text();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Not financial advice. Guardrail Gateway never recommends trades.');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['//evil.com', '/dashboard'],
    ['/\\evil.com', '/dashboard'],
    ['https://evil.com', '/dashboard'],
    ['evil.com', '/dashboard'],
    ['/approvals/123\n', '/dashboard'],
    ['', '/dashboard'],
    ['/approvals/123', '/approvals/123'],
    ['/dashboard?tab=1', '/dashboard?tab=1'],
  ])('maps %j to %j', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

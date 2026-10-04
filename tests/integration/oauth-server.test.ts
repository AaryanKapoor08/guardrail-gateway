import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { auditEvents, mcpGrants, mcpTokens } from '../../src/db/schema.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import { verifyAccessToken } from '../../src/oauth-server/verify.js';
import {
  buildTestApp,
  callbackUrl,
  getPage,
  postForm,
  readSetCookies,
  type SignedInTestUser,
  signInTestUser,
  startLogin,
  TEST_ORIGIN,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import {
  approveAndGetCode,
  authorizePath,
  CLAUDE_CLIENT_ID,
  CLAUDE_CODE_CLIENT_ID,
  CLAUDE_REDIRECT_URI,
  claudeMetadata,
  connectClaude,
  decide,
  exchangeCode,
  locationOf,
  MCP_RESOURCE,
  openConsent,
  postToken,
  STATE,
  serveClaudeMetadata,
} from '../helpers/oauth.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;

beforeAll(async () => {
  connection = await setupTestDb();
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(connection.db);
  testApp = await buildTestApp(connection);
  user = await signInTestUser(testApp);
  serveClaudeMetadata(testApp);
});

function verify(token: string) {
  return verifyAccessToken(testApp.deps)(token);
}

async function refreshWith(refreshToken: string): Promise<Response> {
  return postToken(testApp, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLAUDE_CLIENT_ID,
  });
}

async function expectRejectedToken(token: string): Promise<void> {
  await expect(verify(token)).rejects.toMatchObject({ code: 'invalid_token' });
}

describe('metadata', () => {
  it('publishes the protected resource metadata at both addresses', async () => {
    const expected = {
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['http://localhost:3000'],
      scopes_supported: ['mcp'],
      bearer_methods_supported: ['header'],
    };

    const root = await getPage(testApp, '/.well-known/oauth-protected-resource');
    const forMcp = await getPage(testApp, '/.well-known/oauth-protected-resource/mcp');

    expect(await root.json()).toEqual(expected);
    expect(await forMcp.json()).toEqual(expected);
    expect(forMcp.headers.get('cache-control')).toBe('max-age=300');
  });

  it('publishes the authorization server metadata that makes Claude use CIMD', async () => {
    const response = await getPage(testApp, '/.well-known/oauth-authorization-server');

    expect(await response.json()).toEqual({
      issuer: 'http://localhost:3000',
      authorization_endpoint: 'http://localhost:3000/oauth/authorize',
      token_endpoint: 'http://localhost:3000/oauth/token',
      revocation_endpoint: 'http://localhost:3000/oauth/revoke',
      scopes_supported: ['mcp', 'offline_access'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe('happy path', () => {
  it('signs a signed-out user in, asks for consent, and issues working tokens', async () => {
    const authorize = await getPage(testApp, authorizePath());
    const signInPath = `${locationOf(authorize).pathname}${locationOf(authorize).search}`;
    expect(signInPath).toMatch(/^\/signin\?mcp_request=[0-9a-f-]{36}$/);
    const signInPage = await (await getPage(testApp, signInPath)).text();
    expect(signInPage).toContain('Try the demo (no sign-up, ~1 minute)');
    const loginPath = signInPath.replace('/signin', '/login');
    expect(signInPage).toContain(`href="${loginPath}"`);

    const { authorizeUrl, loginCookie } = await startLogin(testApp, loginPath);
    const snaptradeCode = testApp.fake.authorize(authorizeUrl);
    const callback = await testApp.app.request(
      callbackUrl({
        code: snaptradeCode,
        state: new URL(authorizeUrl).searchParams.get('state') ?? '',
      }),
      { headers: { cookie: `gg_login=${loginCookie}` } },
    );
    const consentPath = `${locationOf(callback).pathname}${locationOf(callback).search}`;
    const cookie = `gg_session=${readSetCookies(callback).gg_session}`;
    const consent = await getPage(testApp, consentPath, cookie);
    const consentHtml = await consent.text();

    expect(consentPath).toMatch(/^\/oauth\/authorize\/resume\?request=/);
    expect(consent.status).toBe(200);
    expect(consentHtml).toContain('Connect claude.ai to Guardrail Gateway?');
    expect(consentHtml).toContain(
      'This app can read the accounts you allowed and propose orders. Every order needs your approval here.',
    );
    expect(consent.headers.get('content-security-policy')).toContain(
      "form-action 'self' https://claude.ai",
    );
  });

  it('redirects back with code, state, and iss, then exchanges the code for tokens', async () => {
    const requestId = await openConsent(testApp, user);

    const approval = await decide(testApp, user, { requestId, decision: 'approve' });
    const callback = locationOf(approval);
    const tokenResponse = await exchangeCode(testApp, callback.searchParams.get('code') ?? '');
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;

    expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDE_REDIRECT_URI);
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(TEST_ORIGIN);
    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.headers.get('cache-control')).toBe('no-store');
    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp offline_access',
    });
    const authInfo = await verify(String(tokens.access_token));
    expect(authInfo).toMatchObject({
      clientId: CLAUDE_CLIENT_ID,
      scopes: ['mcp', 'offline_access'],
      resource: new URL(MCP_RESOURCE),
      extra: { userId: user.userId, clientHost: 'claude.ai' },
    });
    expect(authInfo.expiresAt).toBe(Math.floor(testApp.clock.now().getTime() / 1000) + 3600);
  });

  it('stores only hashes of the tokens and audits the approval', async () => {
    const tokens = await connectClaude(testApp, user);

    const rows = await testApp.deps.db.select({ hash: mcpTokens.tokenHash }).from(mcpTokens);
    const [audit] = await testApp.deps.db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'mcp.grant_approved'));

    expect(rows.map((row) => row.hash).toSorted()).toEqual(
      [sha256Hex(tokens.access_token), sha256Hex(tokens.refresh_token ?? '')].toSorted(),
    );
    expect(audit?.details).toEqual({ clientHost: 'claude.ai', scope: 'mcp offline_access' });
  });

  it('sends the user back with access_denied when they deny', async () => {
    const requestId = await openConsent(testApp, user);

    const response = await decide(testApp, user, { requestId, decision: 'deny' });

    const callback = locationOf(response);
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(TEST_ORIGIN);
    expect(await testApp.deps.db.select().from(mcpGrants)).toEqual([]);
  });

  it('refuses a consent POST without the CSRF token', async () => {
    const requestId = await openConsent(testApp, user);

    const response = await postForm(testApp, '/oauth/authorize/decision', {
      cookie: user.cookie,
      form: { request: requestId, decision: 'approve' },
    });

    expect(response.status).toBe(403);
  });

  it('uses each consent request once and only for 10 minutes', async () => {
    const usedId = await openConsent(testApp, user);
    await decide(testApp, user, { requestId: usedId, decision: 'approve' });
    const staleId = await openConsent(testApp, user);
    testApp.clock.advanceMs(10 * 60 * 1000 + 1);

    const reused = await decide(testApp, user, { requestId: usedId, decision: 'approve' });
    const stale = await getPage(testApp, `/oauth/authorize/resume?request=${staleId}`, user.cookie);

    expect(reused.status).toBe(400);
    expect(stale.status).toBe(400);
    expect(await stale.text()).toContain('This connection request expired or was already used.');
  });

  it('reuses the active grant when the same app connects again', async () => {
    await connectClaude(testApp, user);
    await connectClaude(testApp, user);

    expect(await testApp.deps.db.select().from(mcpGrants)).toHaveLength(1);
  });
});

describe('client checks (CIMD)', () => {
  it('shows an error page, without redirecting, for a host that is not allowlisted', async () => {
    const response = await getPage(
      testApp,
      authorizePath({ client_id: 'https://evil.example/client' }),
      user.cookie,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('Apps from evil.example can&#39;t connect');
    expect(testApp.fake.requests.some((r) => r.url.host === 'evil.example')).toBe(false);
  });

  it('refuses a document whose client_id is not its own address', async () => {
    testApp.fake.serveExternal(CLAUDE_CLIENT_ID, {
      status: 200,
      body: claudeMetadata({ client_id: 'https://claude.ai/someone-else' }),
    });

    const response = await getPage(testApp, authorizePath(), user.cookie);

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('registration document is invalid');
  });

  it('refuses a document larger than 64 KB', async () => {
    testApp.fake.serveExternal(CLAUDE_CLIENT_ID, {
      status: 200,
      body: claudeMetadata({ padding: 'x'.repeat(70 * 1024) }),
    });

    const response = await getPage(testApp, authorizePath(), user.cookie);

    expect(response.status).toBe(400);
  });

  it('shows an error page for a redirect URI the document did not register', async () => {
    const response = await getPage(
      testApp,
      authorizePath({ redirect_uri: 'https://claude.ai/somewhere-else' }),
      user.cookie,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('accepts a loopback redirect on a different port (Claude Code)', async () => {
    const response = await getPage(
      testApp,
      authorizePath({
        client_id: CLAUDE_CODE_CLIENT_ID,
        redirect_uri: 'http://localhost:53682/callback',
      }),
      user.cookie,
    );
    const consent = await getPage(
      testApp,
      `${locationOf(response).pathname}${locationOf(response).search}`,
      user.cookie,
    );

    expect(response.status).toBe(302);
    expect(await consent.text()).toContain('This app runs on your own computer');
    expect(consent.headers.get('content-security-policy')).toContain('http://localhost:53682');
  });

  it('rejects a look-alike loopback host such as localhost.evil.com', async () => {
    const response = await getPage(
      testApp,
      authorizePath({
        client_id: CLAUDE_CODE_CLIENT_ID,
        redirect_uri: 'http://localhost.evil.com:53682/callback',
      }),
      user.cookie,
    );

    expect(response.status).toBe(400);
  });

  it('caches the document instead of fetching it on every authorization', async () => {
    await getPage(testApp, authorizePath(), user.cookie);
    await getPage(testApp, authorizePath(), user.cookie);

    expect(testApp.fake.requests.filter((r) => r.url.href === CLAUDE_CLIENT_ID)).toHaveLength(1);
  });
});

describe('authorization parameters', () => {
  it.each([
    ['missing PKCE', { code_challenge: undefined }, 'invalid_request'],
    ['the plain PKCE method', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['a wrong resource', { resource: 'https://other.example/mcp' }, 'invalid_target'],
    ['an unknown scope', { scope: 'mcp admin' }, 'invalid_scope'],
    ['a response type other than code', { response_type: 'token' }, 'unsupported_response_type'],
  ])('redirects back with an error for %s', async (_case, overrides, error) => {
    const response = await getPage(testApp, authorizePath(overrides), user.cookie);

    const callback = locationOf(response);
    expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDE_REDIRECT_URI);
    expect(callback.searchParams.get('error')).toBe(error);
    expect(callback.searchParams.get('state')).toBe(STATE);
    expect(callback.searchParams.get('iss')).toBe(TEST_ORIGIN);
  });

  it('redirects back with invalid_request when state is missing', async () => {
    const response = await getPage(testApp, authorizePath({ state: undefined }), user.cookie);

    expect(locationOf(response).searchParams.get('error')).toBe('invalid_request');
    expect(locationOf(response).searchParams.has('state')).toBe(false);
  });

  it('grants only "mcp" when no scope is sent, so no refresh token is issued', async () => {
    const code = await approveAndGetCode(testApp, user, { scope: undefined });

    const tokens = (await (await exchangeCode(testApp, code)).json()) as Record<string, unknown>;

    expect(tokens.scope).toBe('mcp');
    expect(tokens.refresh_token).toBeUndefined();
  });
});

describe('authorization codes', () => {
  it('refuses a code after 60 seconds', async () => {
    const code = await approveAndGetCode(testApp, user);
    testApp.clock.advanceMs(61_000);

    const response = await exchangeCode(testApp, code);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses a reused code and revokes the tokens issued from it', async () => {
    const code = await approveAndGetCode(testApp, user);
    const first = (await (await exchangeCode(testApp, code)).json()) as { access_token: string };

    const second = await exchangeCode(testApp, code);

    expect(second.status).toBe(400);
    expect(await second.json()).toMatchObject({ error: 'invalid_grant' });
    await expectRejectedToken(first.access_token);
  });

  it('refuses a wrong code_verifier', async () => {
    const code = await approveAndGetCode(testApp, user);

    const response = await exchangeCode(testApp, code, {
      code_verifier: 'another-verifier-0123456789-abcdefghijklmnop',
    });

    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses a different redirect_uri or client_id', async () => {
    const code = await approveAndGetCode(testApp, user);

    const wrongRedirect = await exchangeCode(testApp, code, {
      redirect_uri: 'https://claude.ai/other',
    });
    const wrongClient = await exchangeCode(testApp, code, { client_id: CLAUDE_CODE_CLIENT_ID });

    expect(await wrongRedirect.json()).toMatchObject({ error: 'invalid_grant' });
    expect(await wrongClient.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('answers from the database alone, with no outbound calls', async () => {
    const code = await approveAndGetCode(testApp, user);
    const requestsBefore = testApp.fake.requests.length;
    const startedMs = performance.now();

    const response = await exchangeCode(testApp, code);

    expect(response.status).toBe(200);
    expect(testApp.fake.requests.length).toBe(requestsBefore);
    // A loose bound for CI; locally it answers in a few milliseconds.
    expect(performance.now() - startedMs).toBeLessThan(1000);
  });

  it('accepts only form-encoded requests', async () => {
    const response = await testApp.app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code' }),
    });

    expect(response.status).toBe(415);
  });

  it('names unsupported grant types', async () => {
    const response = await postToken(testApp, { grant_type: 'client_credentials' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });
});

describe('refresh tokens', () => {
  it('rotates: a refresh returns a new working pair', async () => {
    const first = await connectClaude(testApp, user);

    const response = await refreshWith(first.refresh_token ?? '');
    const second = (await response.json()) as { access_token: string; refresh_token: string };

    expect(response.status).toBe(200);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    await expect(verify(second.access_token)).resolves.toMatchObject({
      clientId: CLAUDE_CLIENT_ID,
    });
  });

  it('revokes the whole grant when an old refresh token is used again', async () => {
    const first = await connectClaude(testApp, user);
    const second = (await (await refreshWith(first.refresh_token ?? '')).json()) as {
      access_token: string;
      refresh_token: string;
    };

    const replay = await refreshWith(first.refresh_token ?? '');

    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });
    await expectRejectedToken(second.access_token);
    expect(await (await refreshWith(second.refresh_token)).json()).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('refuses a refresh for a different client', async () => {
    const first = await connectClaude(testApp, user);

    const response = await postToken(testApp, {
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token ?? '',
      client_id: CLAUDE_CODE_CLIENT_ID,
    });

    expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('revocation', () => {
  it('lets the app revoke its own grant, and always answers 200', async () => {
    const tokens = await connectClaude(testApp, user);

    const revoke = await testApp.app.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.access_token }).toString(),
    });
    const unknown = await testApp.app.request('/oauth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'not-a-real-token' }).toString(),
    });

    expect(revoke.status).toBe(200);
    expect(unknown.status).toBe(200);
    await expectRejectedToken(tokens.access_token);
    expect(await (await refreshWith(tokens.refresh_token ?? '')).json()).toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('lists connected apps and lets the user disconnect one', async () => {
    const tokens = await connectClaude(testApp, user);
    const [grant] = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);

    const page = await (await getPage(testApp, '/apps', user.cookie)).text();
    const response = await postForm(testApp, `/apps/${grant?.id}/revoke`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(page).toContain('<td>claude.ai</td>');
    expect(response.status).toBe(302);
    await expectRejectedToken(tokens.access_token);
    expect(await (await getPage(testApp, '/apps', user.cookie)).text()).toContain(
      'No AI apps are connected.',
    );
  });

  it("answers 404 when disconnecting someone else's app", async () => {
    await connectClaude(testApp, user);
    const [grant] = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });

    const response = await postForm(testApp, `/apps/${grant?.id}/revoke`, {
      cookie: other.cookie,
      form: { csrf: other.csrfToken },
    });

    expect(response.status).toBe(404);
  });

  it('never reactivates a revoked grant: connecting again starts a new one', async () => {
    const old = await connectClaude(testApp, user);
    const [grant] = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);
    await postForm(testApp, `/apps/${grant?.id}/revoke`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    const fresh = await connectClaude(testApp, user);

    expect(await testApp.deps.db.select().from(mcpGrants)).toHaveLength(2);
    await expectRejectedToken(old.access_token);
    await expect(verify(fresh.access_token)).resolves.toBeTruthy();
  });
});

describe('verifyAccessToken', () => {
  it('rejects an expired access token', async () => {
    const tokens = await connectClaude(testApp, user);
    testApp.clock.advanceMs(60 * 60 * 1000);

    await expectRejectedToken(tokens.access_token);
  });

  it('rejects a token bound to a different resource', async () => {
    const tokens = await connectClaude(testApp, user);
    await testApp.deps.db
      .update(mcpTokens)
      .set({ resource: 'https://other.example/mcp' })
      .where(eq(mcpTokens.tokenHash, sha256Hex(tokens.access_token)));

    await expectRejectedToken(tokens.access_token);
  });

  it('rejects a refresh token used as an access token', async () => {
    const tokens = await connectClaude(testApp, user);

    await expectRejectedToken(tokens.refresh_token ?? '');
  });

  it('records when the app was last used, at most once a minute', async () => {
    const tokens = await connectClaude(testApp, user);
    testApp.clock.advanceMs(5 * 60 * 1000);

    await verify(tokens.access_token);

    const [grant] = await testApp.deps.db
      .select({ lastUsedAt: mcpGrants.lastUsedAt })
      .from(mcpGrants);
    expect(grant?.lastUsedAt).toEqual(testApp.clock.now());
  });
});

describe('rate limit', () => {
  it('refuses the 31st OAuth request from one address within a minute', async () => {
    const fromOneAddress = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } };

    const responses = await Promise.all(
      Array.from({ length: 31 }, () => testApp.app.request('/oauth/authorize', fromOneAddress)),
    );
    const fromAnotherAddress = await testApp.app.request('/oauth/authorize', {
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses.filter((status) => status === 400)).toHaveLength(30);
    expect(fromAnotherAddress.status).toBe(400);
  });
});

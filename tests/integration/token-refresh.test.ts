import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { auditEvents, mcpGrants, mcpTokens, snaptradeGrants, users } from '../../src/db/schema.js';
import { aadFor, decryptField } from '../../src/lib/crypto.js';
import { NeedsReauthError } from '../../src/lib/errors.js';
import { listAccounts } from '../../src/snaptrade/resources.js';
import { getAccessToken } from '../../src/snaptrade/tokens.js';
import {
  buildTestApp,
  getPage,
  postForm,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';

const TEN_HOURS_MS = 10 * 60 * 60 * 1000;

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
});

function countRefreshCalls(): number {
  return testApp.fake.requests.filter(
    (request) =>
      request.url.pathname === '/oauth/token/' &&
      new URLSearchParams(request.body).get('grant_type') === 'refresh_token',
  ).length;
}

async function storedGrant() {
  const [grant] = await testApp.deps.db
    .select()
    .from(snaptradeGrants)
    .where(eq(snaptradeGrants.userId, user.userId));
  return grant;
}

async function storedRefreshToken(): Promise<string> {
  const grant = await storedGrant();
  return decryptField(
    grant?.refreshTokenEnc ?? '',
    testApp.deps.env.TOKEN_ENCRYPTION_KEY,
    aadFor(user.userId, 'refresh_token'),
  );
}

async function needsReauth(): Promise<boolean | undefined> {
  const [row] = await testApp.deps.db
    .select({ needsReauth: users.needsReauth })
    .from(users)
    .where(eq(users.id, user.userId));
  return row?.needsReauth;
}

describe('access token refresh', () => {
  it('refreshes exactly once when 10 requests find the token expired at the same time', async () => {
    testApp.clock.advanceMs(TEN_HOURS_MS);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => listAccounts(testApp.deps, user.userId)),
    );

    expect(results.every((accounts) => accounts.length === 2)).toBe(true);
    expect(countRefreshCalls()).toBe(1);
    expect(testApp.fake.currentRefreshTokens()).toEqual([await storedRefreshToken()]);
    const grant = await storedGrant();
    expect(grant?.accessExpiresAt.getTime()).toBe(testApp.clock.now().getTime() + 36_000_000);
  });

  it('refreshes when fewer than 5 minutes are left, not before', async () => {
    testApp.clock.advanceMs(TEN_HOURS_MS - 6 * 60 * 1000);
    await getAccessToken(testApp.deps, user.userId);
    expect(countRefreshCalls()).toBe(0);

    testApp.clock.advanceMs(2 * 60 * 1000);
    await getAccessToken(testApp.deps, user.userId);
    expect(countRefreshCalls()).toBe(1);
  });

  it('refreshes once and retries once when SnapTrade answers 401', async () => {
    testApp.fake.invalidateAccessTokens();

    const accounts = await listAccounts(testApp.deps, user.userId);

    expect(accounts).toHaveLength(2);
    expect(countRefreshCalls()).toBe(1);
  });

  it('asks the user to reconnect when SnapTrade answers 401 twice', async () => {
    testApp.fake.failApi(/^\/accounts$/, { status: 401 }, 2);

    await expect(listAccounts(testApp.deps, user.userId)).rejects.toThrow(NeedsReauthError);

    expect(countRefreshCalls()).toBe(1);
    expect(await needsReauth()).toBe(true);
    expect(await storedGrant()).toBeUndefined();
  });

  it('deletes the grant and asks to reconnect when the refresh token is rejected', async () => {
    testApp.clock.advanceMs(TEN_HOURS_MS);
    testApp.fake.failNextTokenRequest({ status: 400, body: { error: 'invalid_grant' } });

    await expect(getAccessToken(testApp.deps, user.userId)).rejects.toThrow(NeedsReauthError);

    expect(await storedGrant()).toBeUndefined();
    expect(await needsReauth()).toBe(true);
    const [audit] = await testApp.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'snaptrade.reauth_required'));
    expect(audit).toMatchObject({ actor: 'system', userId: user.userId });
  });

  it('retries a refresh once after a network error, with the same refresh token', async () => {
    testApp.clock.advanceMs(TEN_HOURS_MS);
    const oldRefreshToken = await storedRefreshToken();
    testApp.fake.failNextTokenRequest({ status: 0 });

    await getAccessToken(testApp.deps, user.userId);

    const refreshBodies = testApp.fake.requests
      .filter((request) => request.body.includes('grant_type=refresh_token'))
      .map((request) => new URLSearchParams(request.body).get('refresh_token'));
    expect(refreshBodies).toEqual([oldRefreshToken, oldRefreshToken]);
    expect(await storedRefreshToken()).not.toBe(oldRefreshToken);
  });

  it('keeps the grant when SnapTrade fails with a server error', async () => {
    testApp.clock.advanceMs(TEN_HOURS_MS);
    const oldRefreshToken = await storedRefreshToken();
    testApp.fake.failNextTokenRequest({ status: 500, body: { error: 'server_error' } });

    await expect(getAccessToken(testApp.deps, user.userId)).rejects.toThrow(
      '[Tokens] SnapTrade refresh failed',
    );

    expect(await storedRefreshToken()).toBe(oldRefreshToken);
    expect(await needsReauth()).toBe(false);
  });

  it('shows the reconnect banner, and signing in again clears it', async () => {
    testApp.fake.failApi(/^\/accounts$/, { status: 401 }, 2);
    await listAccounts(testApp.deps, user.userId).catch(() => undefined);

    const banner = await (await getPage(testApp, '/dashboard', user.cookie)).text();
    const again = await signInTestUser(testApp);
    const afterSignIn = await (await getPage(testApp, '/dashboard', again.cookie)).text();

    expect(banner).toContain('Reconnect SnapTrade');
    expect(await needsReauth()).toBe(false);
    expect(afterSignIn).not.toContain('Reconnect SnapTrade');
  });
});

describe('POST /disconnect', () => {
  async function insertMcpGrant(): Promise<string> {
    const [grant] = await testApp.deps.db
      .insert(mcpGrants)
      .values({
        userId: user.userId,
        clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
        clientHost: 'claude.ai',
        scope: 'mcp',
      })
      .returning({ id: mcpGrants.id });
    const grantId = grant?.id ?? '';
    await testApp.deps.db.insert(mcpTokens).values({
      tokenHash: 'hash-of-an-access-token',
      grantId,
      kind: 'access',
      scope: 'mcp',
      resource: 'http://localhost:3000/mcp',
      expiresAt: new Date(testApp.clock.now().getTime() + 3_600_000),
    });
    return grantId;
  }

  it('revokes at SnapTrade, deletes the grant, cuts off AI apps, and signs out', async () => {
    const refreshToken = await storedRefreshToken();
    await insertMcpGrant();

    const response = await postForm(testApp, '/disconnect', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('no longer has access');
    const revocation = testApp.fake.requests.find((r) => r.url.pathname === '/oauth/revoke_token/');
    const form = new URLSearchParams(revocation?.body ?? '');
    expect(form.get('token')).toBe(refreshToken);
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(await storedGrant()).toBeUndefined();
    const [grant] = await testApp.deps.db.select().from(mcpGrants);
    expect(grant?.revokedAt).not.toBeNull();
    const [token] = await testApp.deps.db.select().from(mcpTokens);
    expect(token?.revokedAt).not.toBeNull();
    expect((await getPage(testApp, '/dashboard', user.cookie)).status).toBe(302);
  });

  it('tells the user to remove the app at SnapTrade when revocation fails', async () => {
    testApp.fake.failNextRevocation({ status: 503 });

    const response = await postForm(testApp, '/disconnect', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(await response.text()).toContain('Also remove Guardrail Gateway in your SnapTrade');
    expect(await storedGrant()).toBeUndefined();
  });

  it('requires a CSRF token', async () => {
    const response = await postForm(testApp, '/disconnect', { cookie: user.cookie });

    expect(response.status).toBe(403);
    expect(await storedGrant()).toBeDefined();
  });
});

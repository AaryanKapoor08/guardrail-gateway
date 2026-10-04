import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { accounts, auditEvents, snaptradeGrants } from '../../src/db/schema.js';
import {
  buildTestApp,
  getPage,
  postForm,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import { buildConnection, TFSA_ACCOUNT_ID } from '../helpers/snaptrade-data.js';

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

async function tfsaRef(userId: string): Promise<string> {
  const [row] = await testApp.deps.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, TFSA_ACCOUNT_ID)));
  return row?.id ?? '';
}

async function isAllowed(ref: string): Promise<boolean | undefined> {
  const [row] = await testApp.deps.db
    .select({ allowed: accounts.allowed })
    .from(accounts)
    .where(eq(accounts.id, ref));
  return row?.allowed;
}

describe('dashboard accounts', () => {
  it('lists the synced accounts, none allowed, with masked numbers', async () => {
    const response = await getPage(testApp, '/dashboard', user.cookie);

    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Sandbox TFSA');
    expect(html).toContain('Sandbox Margin');
    expect(html).toContain('••••8443');
    expect(html).not.toContain('Q6542138443');
    expect(html).not.toContain('>Allowed <');
    expect(html).toContain('http://localhost:3000/mcp');
  });

  it('allows an account, records it, and keeps it allowed on reload', async () => {
    const ref = await tfsaRef(user.userId);

    const response = await postForm(testApp, `/accounts/${ref}/allow`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, allowed: 'true' },
    });

    expect(response.status).toBe(302);
    expect(await isAllowed(ref)).toBe(true);
    const [audit] = await testApp.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'account.allowed'));
    expect(audit).toMatchObject({ actor: 'user', details: { accountRef: ref } });
    const reloaded = await (await getPage(testApp, '/dashboard', user.cookie)).text();
    expect(reloaded).toContain('Allowed ');
  });

  it('disallows an allowed account', async () => {
    const ref = await tfsaRef(user.userId);
    await postForm(testApp, `/accounts/${ref}/allow`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, allowed: 'true' },
    });

    await postForm(testApp, `/accounts/${ref}/allow`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, allowed: 'false' },
    });

    expect(await isAllowed(ref)).toBe(false);
  });

  it("answers 404 for another user's account and changes nothing", async () => {
    const other = await signInTestUser(testApp, { sub: 'someone-else' });
    const othersRef = await tfsaRef(other.userId);

    const response = await postForm(testApp, `/accounts/${othersRef}/allow`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, allowed: 'true' },
    });

    expect(response.status).toBe(404);
    expect(await isAllowed(othersRef)).toBe(false);
  });

  it('refuses the toggle without a CSRF token', async () => {
    const ref = await tfsaRef(user.userId);

    const response = await postForm(testApp, `/accounts/${ref}/allow`, {
      cookie: user.cookie,
      form: { allowed: 'true' },
    });

    expect(response.status).toBe(403);
    expect(await isAllowed(ref)).toBe(false);
  });

  it('refreshes from SnapTrade on demand', async () => {
    const callsBefore = testApp.fake.countRequests('/accounts');

    const response = await postForm(testApp, '/accounts/refresh', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(response.status).toBe(302);
    expect(testApp.fake.countRequests('/accounts')).toBe(callsBefore + 1);
  });

  it('shows a banner when a connection is broken', async () => {
    testApp.fake.brokerage.connections = [buildConnection({ disabled: true })];
    testApp.clock.advanceMs(5 * 60 * 1000);

    const html = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    expect(html).toContain('A brokerage connection is broken');
  });

  it('asks the user to reconnect when the SnapTrade grant is gone', async () => {
    await testApp.deps.db.delete(snaptradeGrants);
    testApp.clock.advanceMs(5 * 60 * 1000);

    const html = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    expect(html).toContain('Reconnect SnapTrade');
    expect(html).toContain('Sandbox TFSA');
  });

  it('still shows the accounts when SnapTrade is down', async () => {
    testApp.fake.failApi(/^\/accounts$/, { status: 503 }, 3);
    testApp.clock.advanceMs(5 * 60 * 1000);

    const html = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    expect(html).toContain('reach SnapTrade just now');
    expect(html).toContain('Sandbox TFSA');
  });
});

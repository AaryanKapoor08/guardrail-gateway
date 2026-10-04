import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../../src/audit/write.js';
import type { DatabaseConnection } from '../../src/db/client.js';
import {
  auditEvents,
  executions,
  mcpAuthCodes,
  mcpGrants,
  mcpTokens,
  policies,
  users,
  webhookEvents,
} from '../../src/db/schema.js';
import { approveIntent } from '../../src/intents/decisions.js';
import {
  buildTestApp,
  getPage,
  postForm,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import { allowAccount, expectIntent, intentStatus, proposeTestOrder } from '../helpers/intents.js';
import { connectClaude } from '../helpers/oauth.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;
let accountRef: string;

const ANY_ID = '00000000-0000-4000-8000-000000000000';

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
  accountRef = await allowAccount(testApp, user.userId);
});

const DEFAULT_FORM = {
  allowedSides: 'buy',
  maxOrderValue: '100',
  maxDailyValue: '250',
  maxOrdersPerDay: '5',
  symbolAllowlist: '',
  symbolDenylist: '',
  policyCurrency: 'CAD',
  approvalWindowMinutes: '10',
};

function savePolicyForm(changes: Partial<typeof DEFAULT_FORM>): Promise<Response> {
  return postForm(testApp, '/policy', {
    cookie: user.cookie,
    form: { csrf: user.csrfToken, ...DEFAULT_FORM, ...changes },
  });
}

async function proposeAndGetFailedRules(symbol = 'XEQT.TO'): Promise<string[]> {
  const intent = expectIntent(
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef, symbol }),
  );
  return intent.checkResults.filter((check) => !check.passed).map((check) => check.rule);
}

describe('policy editor', () => {
  it('saves a lower limit, bumps the version, audits it, and the next proposal is rejected', async () => {
    const response = await savePolicyForm({ maxOrderValue: '20' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/policy?saved=1');
    const [policy] = await testApp.deps.db
      .select({ version: policies.version })
      .from(policies)
      .where(eq(policies.userId, user.userId));
    expect(policy?.version).toBe(2);
    const [audit] = await testApp.deps.db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'policy.updated'));
    expect(audit?.details).toMatchObject({
      version: 2,
      before: { maxOrderValue: '100' },
      after: { maxOrderValue: '20' },
    });
    expect(await proposeAndGetFailedRules()).toEqual(['max_order_value']);
  });

  it('shows the problems and saves nothing for invalid values', async () => {
    const response = await savePolicyForm({ maxOrderValue: '20000', maxOrdersPerDay: 'many' });

    const html = await response.text();
    expect(response.status).toBe(400);
    expect(html).toContain('Nothing was saved');
    expect(html).toContain('Per-order limit: must be at most 10000');
    expect(html).toContain('Orders per day:');
    const [policy] = await testApp.deps.db.select({ version: policies.version }).from(policies);
    expect(policy?.version).toBe(1);
  });

  it('blocks a symbol on the denylist', async () => {
    await savePolicyForm({ symbolDenylist: 'xeqt.to' });

    expect(await proposeAndGetFailedRules('XEQT.TO')).toEqual(['symbol_allowed']);
  });

  it('allows only the symbols on a non-empty allowlist', async () => {
    await savePolicyForm({ symbolAllowlist: 'SHOP.TO' });

    expect(await proposeAndGetFailedRules('XEQT.TO')).toEqual(['symbol_allowed']);
    expect(await proposeAndGetFailedRules('SHOP.TO')).toEqual([]);
  });

  it('refuses to change the currency while an order is open', async () => {
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef });

    const response = await savePolicyForm({ policyCurrency: 'USD' });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('it can only change when no orders are open');
    const [policy] = await testApp.deps.db.select({ rules: policies.rules }).from(policies);
    expect(policy?.rules).toMatchObject({ policyCurrency: 'CAD' });
  });

  it('shows the fixed rules read-only', async () => {
    const html = await (await getPage(testApp, '/policy', user.cookie)).text();

    expect(html).toContain('Every order needs your approval on this website.');
    expect(html).toContain('value="100"');
  });
});

describe('kill switch and mode', () => {
  it('turns the kill switch on and off, showing the state on every page', async () => {
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );

    const on = await postForm(testApp, '/kill-switch', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, state: 'on' },
    });
    const policyPage = await (await getPage(testApp, '/policy', user.cookie)).text();
    await postForm(testApp, '/kill-switch', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, state: 'off' },
    });
    const afterOff = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    expect(on.status).toBe(302);
    expect(await intentStatus(testApp, intent.id)).toBe('CANCELLED');
    expect(policyPage).toContain('Kill switch is ON');
    expect(afterOff).not.toContain('Kill switch is ON');
    expect(afterOff).toContain('Kill switch: off');
  });

  it('keeps live mode disabled and lists the failing gates', async () => {
    const dashboard = await (await getPage(testApp, '/dashboard', user.cookie)).text();
    const response = await postForm(testApp, '/mode', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, mode: 'live' },
    });

    expect(dashboard).toMatch(/<button type="submit" disabled="">\s*Switch to live mode/);
    expect(dashboard).toContain('Live trading is turned off on this server.');
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('Live trading is turned off on this server.');
    const [row] = await testApp.deps.db.select({ mode: users.mode }).from(users);
    expect(row?.mode).toBe('paper');
  });
});

describe('audit log', () => {
  it('lists events newest first with links to orders', async () => {
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );

    const html = await (await getPage(testApp, '/audit', user.cookie)).text();

    expect(html.indexOf('intent.pending_approval')).toBeLessThan(html.indexOf('user.signed_in'));
    expect(html).toContain(`href="/approvals/${intent.id}"`);
    expect(html).toContain('ai (claude.ai)');
  });

  it('escapes details, so stored text can never become HTML', async () => {
    await writeAudit(testApp.deps.db, {
      userId: user.userId,
      actor: 'system',
      eventType: 'test.note',
      details: { note: '<script>alert(1)</script>' },
      createdAt: testApp.clock.now(),
    });

    const html = await (await getPage(testApp, '/audit', user.cookie)).text();

    expect(html).toContain('note: &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

// Every table with a user_id column, found from the database itself, so a table added later
// is checked too.
async function rowsLeftFor(userId: string): Promise<Record<string, number>> {
  const tables = await testApp.deps.db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const result = await testApp.deps.db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table_name)} where user_id = ${userId}`,
    );
    counts[table_name] = result.rows[0]?.count ?? -1;
  }
  return counts;
}

async function buildRichHistory(): Promise<{ intentIds: string[]; grantIds: string[] }> {
  const filled = expectIntent(
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
  );
  await approveIntent(testApp.deps, { userId: user.userId, intentId: filled.id });
  const pending = expectIntent(
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef, symbol: 'SHOP.TO' }),
  );
  await connectClaude(testApp, user);
  await testApp.deps.db.insert(webhookEvents).values({
    webhookId: '11111111-1111-4111-8111-111111111111',
    eventType: 'ACCOUNT_HOLDINGS_UPDATED',
    userSub: 'snaptrade-user-1',
    eventTimestamp: testApp.clock.now(),
  });
  const grants = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);
  return { intentIds: [filled.id, pending.id], grantIds: grants.map((grant) => grant.id) };
}

describe('account deletion', () => {
  it('deletes every row of the user, including the audit log, and nobody else’s', async () => {
    const { intentIds, grantIds } = await buildRichHistory();
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });
    const otherRowsBefore = await rowsLeftFor(other.userId);

    const response = await postForm(testApp, '/account/delete', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, confirm: 'DELETE' },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Your account is deleted');
    const left = await rowsLeftFor(user.userId);
    expect(Object.values(left).every((count) => count === 0)).toBe(true);
    expect(Object.keys(left)).toContain('audit_events');
    const db = testApp.deps.db;
    expect(await db.select().from(users).where(eq(users.id, user.userId))).toEqual([]);
    expect(
      await db.select().from(executions).where(inArray(executions.intentId, intentIds)),
    ).toEqual([]);
    expect(await db.select().from(mcpTokens).where(inArray(mcpTokens.grantId, grantIds))).toEqual(
      [],
    );
    expect(
      await db.select().from(mcpAuthCodes).where(inArray(mcpAuthCodes.grantId, grantIds)),
    ).toEqual([]);
    expect(await db.select().from(webhookEvents)).toEqual([]);
    expect(await rowsLeftFor(other.userId)).toEqual(otherRowsBefore);
    expect(testApp.fake.countRequests('/oauth/revoke_token/', 'POST')).toBe(1);
  });

  it('ends the session, so the old cookie no longer works', async () => {
    await postForm(testApp, '/account/delete', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, confirm: 'DELETE' },
    });

    const response = await getPage(testApp, '/dashboard', user.cookie);

    expect(response.status).toBe(302);
  });

  it('still deletes locally when SnapTrade revocation fails, and says so', async () => {
    testApp.fake.failNextRevocation({ status: 500 });

    const response = await postForm(testApp, '/account/delete', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, confirm: 'DELETE' },
    });

    expect(await response.text()).toContain('also remove Guardrail Gateway');
    expect(await testApp.deps.db.select().from(users).where(eq(users.id, user.userId))).toEqual([]);
  });

  it('deletes nothing without the typed confirmation', async () => {
    const response = await postForm(testApp, '/account/delete', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, confirm: 'delete' },
    });

    expect(response.status).toBe(400);
    expect(await testApp.deps.db.select({ id: users.id }).from(users)).toHaveLength(1);
  });
});

describe('access rules', () => {
  it.each([
    '/policy',
    '/kill-switch',
    '/mode',
    '/account/delete',
    '/accounts/refresh',
    '/disconnect',
    `/intents/${ANY_ID}/cancel`,
    '/accounts/acc_x/allow',
    `/apps/${ANY_ID}/revoke`,
    `/approvals/${ANY_ID}/approve`,
    `/approvals/${ANY_ID}/deny`,
    '/oauth/authorize/decision',
    '/logout',
  ])('POST %s without a CSRF token is refused with 403', async (path) => {
    const response = await postForm(testApp, path, { cookie: user.cookie, form: {} });

    expect(response.status).toBe(403);
  });

  it.each([
    '/dashboard',
    '/intents',
    '/policy',
    '/audit',
    '/apps',
    '/account/delete',
    `/approvals/${ANY_ID}`,
  ])('GET %s needs a session', async (path) => {
    const response = await getPage(testApp, path);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/login?return_to=${encodeURIComponent(path)}`);
  });

  it.each(['/', '/privacy'])('GET %s works signed out', async (path) => {
    const response = await getPage(testApp, path);

    expect(response.status).toBe(200);
  });

  it('starts sign-in at /login without a session', async () => {
    const response = await getPage(testApp, '/login');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('dashboard.snaptrade.com/oauth/authorize');
  });

  it('explains on the privacy page what is stored and how to delete it', async () => {
    const html = await (await getPage(testApp, '/privacy')).text();

    expect(html).toContain('We never see or store your brokerage username or password.');
    expect(html).toContain('Webhook notifications from SnapTrade: 30 days.');
    expect(html).toContain('href="/account/delete"');
  });
});

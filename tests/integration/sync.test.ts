import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { accounts, auditEvents, connections } from '../../src/db/schema.js';
import { syncIfStale, syncUserConnectionsAndAccounts } from '../../src/snaptrade/sync.js';
import { buildTestApp, signInTestUser, type TestApp } from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import {
  buildAccount,
  buildConnection,
  MARGIN_ACCOUNT_ID,
  SANDBOX_CONNECTION_ID,
  TFSA_ACCOUNT_ID,
} from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let userId: string;

beforeAll(async () => {
  connection = await setupTestDb();
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(connection.db);
  testApp = await buildTestApp(connection);
  ({ userId } = await signInTestUser(testApp));
});

function accountRows() {
  return testApp.deps.db.select().from(accounts).where(eq(accounts.userId, userId));
}

async function accountRow(snaptradeAccountId: string) {
  const [row] = await testApp.deps.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, snaptradeAccountId)));
  return row;
}

describe('syncUserConnectionsAndAccounts', () => {
  it('stores new accounts as not allowed, with only the last 4 digits of the number', async () => {
    await syncUserConnectionsAndAccounts(testApp.deps, userId);

    const rows = await accountRows();
    expect(rows).toHaveLength(2);
    const tfsa = await accountRow(TFSA_ACCOUNT_ID);
    expect(tfsa).toMatchObject({
      allowed: false,
      present: true,
      numberLast4: '8443',
      name: 'Sandbox TFSA',
      rawType: 'TFSA',
      accountCategory: 'INVESTMENT',
      institutionName: 'SnapTrade Sandbox',
      isPaper: false,
      connectionId: SANDBOX_CONNECTION_ID,
    });
    expect(tfsa?.id).toMatch(/^acc_[A-Za-z0-9_-]{8}$/);
    expect(JSON.stringify(rows)).not.toContain('Q6542138443');
  });

  it('marks an account that disappeared from SnapTrade as no longer present', async () => {
    testApp.fake.brokerage.accounts = testApp.fake.brokerage.accounts.filter(
      (account) => account.id !== MARGIN_ACCOUNT_ID,
    );

    const summary = await syncUserConnectionsAndAccounts(testApp.deps, userId);

    expect(summary).toEqual({ connections: 1, accounts: 1, missingAccounts: 1 });
    expect((await accountRow(MARGIN_ACCOUNT_ID))?.present).toBe(false);
    expect((await accountRow(TFSA_ACCOUNT_ID))?.present).toBe(true);
  });

  it('stores the disabled flag and type of a connection', async () => {
    testApp.fake.brokerage.connections = [
      buildConnection({ disabled: true, disabled_date: '2026-10-05T13:00:00Z', type: 'trade' }),
    ];

    await syncUserConnectionsAndAccounts(testApp.deps, userId);

    const [row] = await testApp.deps.db.select().from(connections);
    expect(row).toMatchObject({
      disabled: true,
      type: 'trade',
      brokerageName: 'SnapTrade Sandbox',
    });
    expect(row?.disabledAt?.toISOString()).toBe('2026-10-05T13:00:00.000Z');
  });

  it('keeps the account ref and the allowed choice across syncs', async () => {
    const before = await accountRow(TFSA_ACCOUNT_ID);
    await testApp.deps.db
      .update(accounts)
      .set({ allowed: true })
      .where(eq(accounts.id, before?.id ?? ''));
    testApp.fake.brokerage.accounts = [buildAccount({ name: 'Renamed TFSA' })];

    await syncUserConnectionsAndAccounts(testApp.deps, userId);

    const after = await accountRow(TFSA_ACCOUNT_ID);
    expect(after).toMatchObject({ id: before?.id, allowed: true, name: 'Renamed TFSA' });
  });

  it('accepts the fields SnapTrade documents as nullable', async () => {
    testApp.fake.brokerage.accounts = [
      buildAccount({ name: null, raw_type: null, account_category: null, number: '' }),
    ];

    await syncUserConnectionsAndAccounts(testApp.deps, userId);

    expect(await accountRow(TFSA_ACCOUNT_ID)).toMatchObject({
      name: 'Unnamed account',
      rawType: null,
      accountCategory: null,
      numberLast4: null,
    });
  });

  it('skips an account whose connection SnapTrade did not list', async () => {
    testApp.fake.brokerage.accounts.push(
      buildAccount({
        id: '5f0c1e9a-1111-4b8e-9c3e-0a1b2c3d4e5f',
        brokerage_authorization: '00000000-0000-4000-8000-000000000000',
      }),
    );

    const summary = await syncUserConnectionsAndAccounts(testApp.deps, userId);

    expect(summary.accounts).toBe(2);
  });

  it('writes an audit event with the counts', async () => {
    await syncUserConnectionsAndAccounts(testApp.deps, userId);

    const events = await testApp.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'accounts.synced'));
    expect(events.at(-1)).toMatchObject({
      actor: 'system',
      details: { connections: 1, accounts: 2, missingAccounts: 0 },
    });
  });
});

describe('syncIfStale', () => {
  it('calls SnapTrade at most once per 5 minutes', async () => {
    const callsAfterSignIn = testApp.fake.countRequests('/accounts');

    await syncIfStale(testApp.deps, userId);
    testApp.clock.advanceMs(4 * 60 * 1000);
    await syncIfStale(testApp.deps, userId);
    expect(testApp.fake.countRequests('/accounts')).toBe(callsAfterSignIn);

    testApp.clock.advanceMs(60 * 1000);
    await syncIfStale(testApp.deps, userId);
    expect(testApp.fake.countRequests('/accounts')).toBe(callsAfterSignIn + 1);
  });
});

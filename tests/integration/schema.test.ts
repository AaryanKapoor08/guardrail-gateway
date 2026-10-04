import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../../src/audit/write.js';
import type { Database, DatabaseConnection } from '../../src/db/client.js';
import {
  accounts,
  connections,
  executions,
  mcpAuthCodes,
  mcpAuthRequests,
  mcpGrants,
  mcpTokens,
  orderIntents,
  paperCash,
  paperPositions,
  policies,
  sessions,
  snaptradeGrants,
  users,
} from '../../src/db/schema.js';
import { ALL_TABLE_NAMES, setupTestDb, truncateAll } from '../helpers/db.js';

const NOW = new Date('2026-10-03T14:00:00Z');
const LATER = new Date('2026-10-03T14:10:00Z');

// The tables listed in PRODUCT_VISION §14.1.
const DATA_MODEL_TABLES = [
  'accounts',
  'audit_events',
  'connections',
  'executions',
  'login_attempts',
  'mcp_auth_codes',
  'mcp_auth_requests',
  'mcp_grants',
  'mcp_tokens',
  'order_intents',
  'paper_cash',
  'paper_positions',
  'policies',
  'sessions',
  'snaptrade_grants',
  'users',
  'webhook_events',
];

let connection: DatabaseConnection;
let db: Database;

beforeAll(async () => {
  connection = await setupTestDb();
  db = connection.db;
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function insertUser(snaptradeSub: string): Promise<string> {
  const [user] = await db.insert(users).values({ snaptradeSub }).returning({ id: users.id });
  if (user === undefined) {
    throw new Error('test setup: user insert returned nothing');
  }
  return user.id;
}

// One row in every user-owned table, to prove that deleting the user removes everything.
async function insertFullUserData(userId: string): Promise<void> {
  await db
    .insert(sessions)
    .values({ idHash: `s-${userId}`, userId, csrfToken: 'x', expiresAt: LATER });
  await db.insert(policies).values({ userId, version: 1, rules: {} });
  await db.insert(snaptradeGrants).values({
    userId,
    accessTokenEnc: 'v1:a:b:c',
    refreshTokenEnc: 'v1:a:b:c',
    accessExpiresAt: LATER,
    scope: 'read',
  });
  await db
    .insert(connections)
    .values({ id: `c-${userId}`, userId, brokerageName: 'Sandbox', type: 'read', syncedAt: NOW });
  await db.insert(accounts).values({
    id: `acc-${userId}`,
    userId,
    snaptradeAccountId: crypto.randomUUID(),
    connectionId: `c-${userId}`,
    institutionName: 'Sandbox',
    name: 'Paper account',
    numberLast4: '1234',
    rawType: 'TFSA',
    isPaper: true,
    syncedAt: NOW,
  });
  await db.insert(mcpAuthRequests).values({
    clientId: 'https://claude.ai/client.json',
    redirectUri: 'https://claude.ai/callback',
    state: 'state',
    codeChallenge: 'challenge',
    scope: 'trade',
    resource: 'http://localhost:3000/mcp',
    userId,
    expiresAt: LATER,
  });
  const [grant] = await db
    .insert(mcpGrants)
    .values({
      userId,
      clientId: 'https://claude.ai/client.json',
      clientHost: 'claude.ai',
      scope: 'trade',
    })
    .returning({ id: mcpGrants.id });
  const grantId = grant?.id ?? '';
  await db.insert(mcpAuthCodes).values({
    codeHash: `code-${userId}`,
    grantId,
    redirectUri: 'https://claude.ai/callback',
    codeChallenge: 'challenge',
    scope: 'trade',
    resource: 'http://localhost:3000/mcp',
    expiresAt: LATER,
  });
  await db.insert(mcpTokens).values({
    tokenHash: `token-${userId}`,
    grantId,
    kind: 'access',
    scope: 'trade',
    resource: 'http://localhost:3000/mcp',
    expiresAt: LATER,
  });
  const [intent] = await db
    .insert(orderIntents)
    .values({
      userId,
      accountId: `acc-${userId}`,
      grantId,
      fingerprint: 'fingerprint',
      symbol: 'VFV',
      universalSymbolId: crypto.randomUUID(),
      securityType: 'etf',
      currency: 'CAD',
      side: 'buy',
      quantity: '2',
      orderType: 'market',
      mode: 'paper',
      priceSource: 'quote',
      status: 'FILLED',
      checkResults: [],
      policyVersion: 1,
      expiresAt: LATER,
    })
    .returning({ id: orderIntents.id });
  const intentId = intent?.id ?? '';
  await db.insert(executions).values({ intentId, executor: 'paper' });
  await db.insert(paperPositions).values({
    userId,
    accountId: `acc-${userId}`,
    symbol: 'VFV',
    quantity: '2',
    avgCost: '150.25',
    currency: 'CAD',
  });
  await db
    .insert(paperCash)
    .values({ userId, accountId: `acc-${userId}`, currency: 'CAD', cashChange: '-300.50' });
  await writeAudit(db, {
    userId,
    intentId,
    actor: 'user',
    eventType: 'intent.approved',
    details: { symbol: 'VFV' },
    createdAt: NOW,
  });
}

async function countRowsInAllTables(): Promise<number> {
  const counts = ALL_TABLE_NAMES.map((name) => `(select count(*) from "${name}")`).join(' + ');
  const result = await db.execute<{ total: string }>(sql.raw(`select ${counts} as total`));
  return Number(result.rows[0]?.total ?? -1);
}

describe('database schema', () => {
  it('creates every table from the data model', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(DATA_MODEL_TABLES);
  });

  it('rejects a value outside a fixed set', async () => {
    const insertBadMode = db
      .insert(users)
      .values({ snaptradeSub: 'user-a', mode: 'yolo' as 'paper' });

    await expect(insertBadMode).rejects.toThrow();
  });

  it('defaults new users to paper mode, not demo, with the kill switch off', async () => {
    const userId = await insertUser('user-a');

    const [user] = await db
      .select({ mode: users.mode, isDemo: users.isDemo, killSwitch: users.killSwitch })
      .from(users)
      .where(eq(users.id, userId));

    expect(user).toEqual({ mode: 'paper', isDemo: false, killSwitch: false });
  });

  it('removes all of a user’s data when the user is deleted', async () => {
    const userId = await insertUser('user-a');
    await insertFullUserData(userId);
    expect(await countRowsInAllTables()).toBeGreaterThan(10);

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.deleting_user', ${userId}, true)`);
      await tx.delete(users).where(eq(users.id, userId));
    });

    expect(await countRowsInAllTables()).toBe(0);
  });
});

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { accounts, connections, webhookEvents } from '../../src/db/schema.js';
import { runSweepOnce } from '../../src/jobs/sweeper.js';
import { cachedPositions } from '../../src/snaptrade/cached.js';
import { signatureFor } from '../../src/webhooks/verify.js';
import {
  buildTestApp,
  getPage,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import { allowAccount, expectIntent, proposeTestOrder } from '../helpers/intents.js';
import {
  buildAccount,
  MARGIN_ACCOUNT_ID,
  SANDBOX_CONNECTION_ID,
  TFSA_ACCOUNT_ID,
} from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;

const CONSUMER_KEY = 'test-consumer-key-value';
const RRSP_ACCOUNT_ID = '3c9a1f52-7b1e-4d2a-9f3c-5e6d7a8b9c0d';

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

type Webhook = Record<string, unknown>;

function buildWebhook(overrides: Webhook = {}): Webhook {
  return {
    schemaVersion: 'oauth_v1',
    webhookId: randomUUID(),
    oauthClientId: 'test-client-id',
    eventTimestamp: testApp.clock.now().toISOString(),
    userId: 'snaptrade-user-1',
    eventType: 'CONNECTION_BROKEN',
    connectionId: SANDBOX_CONNECTION_ID,
    brokerageId: 'brokerage-1',
    accountId: null,
    details: {},
    ...overrides,
  };
}

function postWebhook(rawBody: string, signature?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) {
    headers.signature = signature;
  }
  return Promise.resolve(
    testApp.app.request('/webhooks/snaptrade', { method: 'POST', headers, body: rawBody }),
  );
}

// Sent pretty-printed with keys in a different order than the canonical form, as a real
// sender's JSON might be: only the canonical form is signed.
async function sendSigned(payload: Webhook): Promise<Response> {
  const response = await postWebhook(
    JSON.stringify(payload, null, 2),
    signatureFor(payload, CONSUMER_KEY),
  );
  await testApp.deps.background.settle();
  return response;
}

async function storedEvents() {
  return testApp.deps.db.select().from(webhookEvents);
}

async function connectionDisabled(): Promise<boolean | undefined> {
  const [row] = await testApp.deps.db
    .select({ disabled: connections.disabled })
    .from(connections)
    .where(eq(connections.id, SANDBOX_CONNECTION_ID));
  return row?.disabled;
}

describe('receiving', () => {
  it('accepts a signed event, stores it, and processes it as a re-sync', async () => {
    const [sandbox] = testApp.fake.brokerage.connections;
    if (sandbox !== undefined) {
      sandbox.disabled = true;
    }

    const response = await sendSigned(buildWebhook());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'received' });
    const [event] = await storedEvents();
    expect(event).toMatchObject({ eventType: 'CONNECTION_BROKEN', stale: false, lastError: null });
    expect(event?.processedAt).toEqual(testApp.clock.now());
    expect(await connectionDisabled()).toBe(true);
  });

  it('refuses a missing or wrong signature with 401 and stores nothing', async () => {
    const payload = buildWebhook();

    const unsigned = await postWebhook(JSON.stringify(payload));
    const wrongKey = await postWebhook(JSON.stringify(payload), signatureFor(payload, 'other-key'));
    const tampered = await postWebhook(
      JSON.stringify({ ...payload, eventType: 'CONNECTION_FIXED' }),
      signatureFor(payload, CONSUMER_KEY),
    );

    expect([unsigned.status, wrongKey.status, tampered.status]).toEqual([401, 401, 401]);
    expect(await storedEvents()).toEqual([]);
  });

  it('ignores a duplicate delivery of the same webhookId', async () => {
    const payload = buildWebhook();
    await sendSigned(payload);

    const again = await sendSigned(payload);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'duplicate' });
    expect(await storedEvents()).toHaveLength(1);
  });

  it('answers 200 and stores nothing for another app on the same SnapTrade account', async () => {
    const response = await sendSigned(buildWebhook({ oauthClientId: 'someone-elses-app' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ignored' });
    expect(await storedEvents()).toEqual([]);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await postWebhook('not json', 'c2lnbmF0dXJl');

    expect(response.status).toBe(400);
  });

  it('answers 400 for a signed body that does not match the oauth_v1 schema', async () => {
    const response = await sendSigned(buildWebhook({ schemaVersion: 'v2' }));

    expect(response.status).toBe(400);
    expect(await storedEvents()).toEqual([]);
  });

  it('answers 413 for a body over 64 KB', async () => {
    const response = await postWebhook(
      JSON.stringify(buildWebhook({ details: { padding: 'x'.repeat(70 * 1024) } })),
    );

    expect(response.status).toBe(413);
  });
});

describe('stale events', () => {
  it('stores an old event flagged stale and does not re-sync again within 5 minutes', async () => {
    const syncsBefore = testApp.fake.countRequests('/authorizations');
    const tenMinutesAgo = new Date(testApp.clock.now().getTime() - 10 * 60 * 1000);

    const response = await sendSigned(
      buildWebhook({ eventTimestamp: tenMinutesAgo.toISOString() }),
    );

    expect(response.status).toBe(200);
    const [event] = await storedEvents();
    expect(event?.stale).toBe(true);
    expect(event?.processedAt).not.toBeNull();
    expect(testApp.fake.countRequests('/authorizations')).toBe(syncsBefore);
  });

  it('re-syncs at once for a fresh event', async () => {
    const syncsBefore = testApp.fake.countRequests('/authorizations');

    await sendSigned(buildWebhook());

    expect(testApp.fake.countRequests('/authorizations')).toBe(syncsBefore + 1);
  });
});

describe('processing', () => {
  it('blocks proposals on a broken connection and unblocks them when it is fixed', async () => {
    const accountRef = await allowAccount(testApp, user.userId);
    const [sandbox] = testApp.fake.brokerage.connections;
    if (sandbox === undefined) {
      throw new Error('test setup: no fake connection');
    }
    sandbox.disabled = true;
    await sendSigned(buildWebhook({ eventType: 'CONNECTION_BROKEN' }));
    const blocked = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );
    sandbox.disabled = false;

    await sendSigned(buildWebhook({ eventType: 'CONNECTION_FIXED' }));
    const allowed = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );

    expect(blocked.checkResults.filter((c) => !c.passed).map((c) => c.rule)).toEqual([
      'connection_healthy',
    ]);
    expect(allowed.status).toBe('PENDING_APPROVAL');
  });

  it('adds a new account as not allowed and shows a notice', async () => {
    testApp.clock.advanceMs(60_000);
    testApp.fake.brokerage.accounts.push(
      buildAccount({ id: RRSP_ACCOUNT_ID, name: 'Sandbox RRSP', number: 'R0000001111' }),
    );

    await sendSigned(
      buildWebhook({ eventType: 'NEW_ACCOUNT_AVAILABLE', accountId: RRSP_ACCOUNT_ID }),
    );
    const html = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    const [rrsp] = await testApp.deps.db
      .select({ allowed: accounts.allowed })
      .from(accounts)
      .where(eq(accounts.snaptradeAccountId, RRSP_ACCOUNT_ID));
    expect(rrsp?.allowed).toBe(false);
    expect(html).toContain('New account found, not allowed yet: Sandbox RRSP.');
  });

  it('marks a removed account as no longer present', async () => {
    testApp.fake.brokerage.accounts = testApp.fake.brokerage.accounts.filter(
      (account) => account.id !== MARGIN_ACCOUNT_ID,
    );

    await sendSigned(buildWebhook({ eventType: 'ACCOUNT_REMOVED', accountId: MARGIN_ACCOUNT_ID }));

    const [margin] = await testApp.deps.db
      .select({ present: accounts.present })
      .from(accounts)
      .where(eq(accounts.snaptradeAccountId, MARGIN_ACCOUNT_ID));
    expect(margin?.present).toBe(false);
  });

  it('drops cached holdings when SnapTrade says they changed', async () => {
    await cachedPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);

    await sendSigned(
      buildWebhook({ eventType: 'ACCOUNT_HOLDINGS_UPDATED', accountId: TFSA_ACCOUNT_ID }),
    );
    await cachedPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);

    expect(testApp.fake.countRequests(`/accounts/${TFSA_ACCOUNT_ID}/positions/all`)).toBe(2);
  });

  it('skips events for a user we do not know', async () => {
    await sendSigned(buildWebhook({ userId: 'someone-we-never-saw' }));

    const [event] = await storedEvents();
    expect(event?.lastError).toBe('skipped: no active grant');
    expect(event?.processedAt).not.toBeNull();
  });

  it('stores and ignores event types we do not use', async () => {
    await sendSigned(buildWebhook({ eventType: 'TRADES_PLACED' }));

    const [event] = await storedEvents();
    expect(event?.lastError).toBe('ignored: event type not used');
  });

  it('counts a failed attempt and lets the sweeper retry it', async () => {
    testApp.fake.failApi(/^\/authorizations$/, { status: 400 }, 1);

    await sendSigned(buildWebhook());
    const [failed] = await storedEvents();
    const summary = await runSweepOnce(testApp.deps);
    const [retried] = await storedEvents();

    expect(failed).toMatchObject({ attempts: 1, processedAt: null });
    expect(failed?.lastError).toContain('failed with status 400');
    expect(summary.processedWebhooks).toBe(1);
    expect(retried?.processedAt).not.toBeNull();
  });

  it('purges webhook events after 30 days', async () => {
    await sendSigned(buildWebhook());
    testApp.clock.advanceMs(31 * 24 * 60 * 60 * 1000);

    await runSweepOnce(testApp.deps);

    expect(await storedEvents()).toEqual([]);
  });
});

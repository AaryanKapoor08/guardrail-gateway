import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { orderIntents, paperCash } from '../../src/db/schema.js';
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
import {
  allowAccount,
  expectIntent,
  intentStatus,
  listExecutions,
  paperQuantity,
  proposeTestOrder,
  updatePolicy,
} from '../helpers/intents.js';
import { XEQT_ID } from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;
let accountRef: string;

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

async function proposePending(
  order: { symbol?: string; side?: 'buy' | 'sell'; quantity?: string } & {
    order_type?: 'market' | 'limit';
    limit_price?: string;
  } = {},
): Promise<string> {
  const intent = expectIntent(
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef, ...order }),
  );
  expect(intent.status).toBe('PENDING_APPROVAL');
  return intent.id;
}

function approve(intentId: string) {
  return approveIntent(testApp.deps, { userId: user.userId, intentId });
}

describe('approval page', () => {
  it('shows every element of the order confirmation', async () => {
    const intentId = await proposePending();

    const response = await getPage(testApp, `/approvals/${intentId}`, user.cookie);

    const html = await response.text();
    expect(response.status).toBe(200);
    for (const text of [
      'PAPER: simulated, no real order',
      'This order was proposed by an AI assistant. Check every detail. Approving is your decision.',
      'claude.ai, Oct 5, 2026, 10:00 AM ET',
      'SnapTrade Sandbox: Sandbox TFSA (TFSA), ••••8443',
      'XEQT.TO, iShares Core Equity ETF Portfolio',
      'TSX, ETF, CAD',
      '<td>Buy</td>',
      '<td>1</td>',
      '<td>Market</td>',
      'Day (ends at today&#39;s market close)',
      '$32.10 CAD',
      'Application-generated estimate: Latest available quote from your broker, may be delayed',
      'None (simulated)',
      'Estimated results. The amounts shown are estimates only and are not guaranteed.',
      'Pass: ',
      'This approval expires at <strong>Oct 5, 2026, 10:10 AM ET</strong>',
      `action="/approvals/${intentId}/approve"`,
      `action="/approvals/${intentId}/deny"`,
      `name="csrf" value="${user.csrfToken}"`,
      'Not financial advice. Guardrail Gateway never recommends trades.',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Q6542138443');
  });

  it('warns when another pending order has identical details', async () => {
    const intentId = await proposePending();
    await proposePending();

    const html = await (await getPage(testApp, `/approvals/${intentId}`, user.cookie)).text();

    expect(html).toContain('You have another pending order with identical details.');
  });

  it('sends a signed-out visitor to sign in and back to the same page', async () => {
    const intentId = await proposePending();

    const response = await getPage(testApp, `/approvals/${intentId}`);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `/login?return_to=${encodeURIComponent(`/approvals/${intentId}`)}`,
    );
  });

  it("answers 404 for another user's intent and for unknown ids", async () => {
    const intentId = await proposePending();
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });

    const othersView = await getPage(testApp, `/approvals/${intentId}`, other.cookie);
    const othersApprove = await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: other.cookie,
      form: { csrf: other.csrfToken },
    });
    const unknown = await getPage(
      testApp,
      '/approvals/00000000-0000-4000-8000-000000000000',
      user.cookie,
    );
    const notAnId = await getPage(testApp, '/approvals/not-an-id', user.cookie);

    expect(othersView.status).toBe(404);
    expect(othersApprove.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(notAnId.status).toBe(404);
    expect(await intentStatus(testApp, intentId)).toBe('PENDING_APPROVAL');
  });

  it('refuses an approve POST without the CSRF token', async () => {
    const intentId = await proposePending();

    const response = await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: {},
    });

    expect(response.status).toBe(403);
    expect(await intentStatus(testApp, intentId)).toBe('PENDING_APPROVAL');
  });

  it('never changes the order when the page is opened, however often', async () => {
    const intentId = await proposePending();

    await getPage(testApp, `/approvals/${intentId}`, user.cookie);
    await getPage(testApp, `/approvals/${intentId}`, user.cookie);

    expect(await intentStatus(testApp, intentId)).toBe('PENDING_APPROVAL');
    expect(await listExecutions(testApp, [intentId])).toEqual([]);
  });

  it('approves with a POST, then shows the simulated fill without buttons', async () => {
    const intentId = await proposePending();

    const response = await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });
    const html = await (await getPage(testApp, `/approvals/${intentId}`, user.cookie)).text();

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/approvals/${intentId}`);
    expect(html).toContain('<strong>Filled.</strong> 1 at $32.10 CAD (simulated).');
    expect(html).not.toContain(`action="/approvals/${intentId}/approve"`);
  });

  it('denies with a POST', async () => {
    const intentId = await proposePending();

    await postForm(testApp, `/approvals/${intentId}/deny`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(await intentStatus(testApp, intentId)).toBe('DENIED');
  });

  it('says an expired order must be proposed again', async () => {
    const intentId = await proposePending();
    testApp.clock.advanceMs(11 * 60 * 1000);

    const html = await (await getPage(testApp, `/approvals/${intentId}`, user.cookie)).text();

    expect(html).toContain('<strong>Expired.</strong> Ask the AI to propose again.');
    expect(html).not.toContain(`action="/approvals/${intentId}/approve"`);
  });

  it('keeps the order pending and explains when the broker is down at approval time', async () => {
    const intentId = await proposePending();
    testApp.clock.advanceMs(20_000);
    testApp.fake.failApi(/\/quotes$/, { status: 500 }, 3);

    const response = await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    const html = await response.text();
    expect(response.status).toBe(503);
    expect(html).toContain('Couldn&#39;t get a fresh price from your broker, so nothing was');
    expect(await intentStatus(testApp, intentId)).toBe('PENDING_APPROVAL');
    expect(await listExecutions(testApp, [intentId])).toEqual([]);
  });
});

describe('dashboard and history', () => {
  it('lists pending approvals and paper positions on the dashboard', async () => {
    const pendingId = await proposePending();
    const filledId = await proposePending({ symbol: 'SHOP.TO' });
    await approve(filledId);

    const html = await (await getPage(testApp, '/dashboard', user.cookie)).text();

    expect(html).toContain(`href="/approvals/${pendingId}"`);
    expect(html).not.toContain(`href="/approvals/${filledId}"`);
    expect(html).toContain('Paper positions (simulated)');
    expect(html).toContain('SHOP.TO');
  });

  it('shows recent orders and lets the user cancel a pending one', async () => {
    const intentId = await proposePending();

    const page = await (await getPage(testApp, '/intents', user.cookie)).text();
    const response = await postForm(testApp, `/intents/${intentId}/cancel`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(page).toContain('Waiting for your approval');
    expect(page).toContain(`action="/intents/${intentId}/cancel"`);
    expect(response.status).toBe(302);
    expect(await intentStatus(testApp, intentId)).toBe('CANCELLED');
  });
});

describe('races', () => {
  it('executes an intent once when it is approved twice at the same moment', async () => {
    const intentId = await proposePending();

    const results = await Promise.all([approve(intentId), approve(intentId)]);

    expect(results.map((result) => result.intent.status)).toEqual(['FILLED', 'FILLED']);
    expect(await listExecutions(testApp, [intentId])).toHaveLength(1);
    expect(await paperQuantity(testApp, { userId: user.userId, symbol: 'XEQT.TO' })).toBe('1');
  });

  it('fills only one of two intents that together exceed the daily limit', async () => {
    // Both fit when proposed; then the daily limit is lowered so only one can still fit.
    await updatePolicy(testApp, user.userId, { maxOrderValue: '200', maxDailyValue: '400' });
    const firstId = await proposePending({ quantity: '5' });
    const secondId = await proposePending({ quantity: '6' });
    await updatePolicy(testApp, user.userId, { maxOrderValue: '200', maxDailyValue: '250' });

    await Promise.all([approve(firstId), approve(secondId)]);

    const statuses = [await intentStatus(testApp, firstId), await intentStatus(testApp, secondId)];
    expect(statuses.toSorted()).toEqual(['FILLED', 'POLICY_REJECTED']);
    expect(await listExecutions(testApp, [firstId, secondId])).toHaveLength(1);
  });
});

describe('paper executor', () => {
  it('fills a market buy at the fresh price and records the cash spent', async () => {
    const intentId = await proposePending({ quantity: '2' });

    const result = await approve(intentId);

    expect(result.intent.status).toBe('FILLED');
    expect(result.intent.execution).toEqual({ filledQuantity: '2', avgFillPrice: '32.1' });
    const [cash] = await testApp.deps.db
      .select({ cashChange: paperCash.cashChange })
      .from(paperCash)
      .where(eq(paperCash.userId, user.userId));
    expect(cash?.cashChange).toBe('-64.2');
  });

  it('closes a limit buy that is not marketable at approval time', async () => {
    // The ask is $32.10, so a buy limited to $30 can't fill now.
    const intentId = await proposePending({ order_type: 'limit', limit_price: '30' });

    const result = await approve(intentId);

    expect(result.intent.status).toBe('CLOSED');
    expect(result.intent.execution).toEqual({ filledQuantity: '0', avgFillPrice: null });
    expect(await paperQuantity(testApp, { userId: user.userId, symbol: 'XEQT.TO' })).toBeNull();
  });

  it('fills a marketable limit buy at the fresh market price, not the limit', async () => {
    const intentId = await proposePending({ order_type: 'limit', limit_price: '35' });

    const result = await approve(intentId);

    expect(result.intent.status).toBe('FILLED');
    expect(result.intent.execution?.avgFillPrice).toBe('32.1');
  });

  it('reduces the paper position on a sell and keeps the average cost', async () => {
    await updatePolicy(testApp, user.userId, { allowedSides: ['buy', 'sell'] });
    await approve(await proposePending({ quantity: '2' }));

    const sellId = await proposePending({ side: 'sell', quantity: '1' });
    const result = await approve(sellId);

    expect(result.intent.status).toBe('FILLED');
    expect(await paperQuantity(testApp, { userId: user.userId, symbol: 'XEQT.TO' })).toBe('1');
    // Sold at the bid ($32.05).
    expect(result.intent.execution?.avgFillPrice).toBe('32.05');
  });

  it('blocks selling more than the real and paper holdings together', async () => {
    await updatePolicy(testApp, user.userId, { allowedSides: ['buy', 'sell'] });
    await approve(await proposePending({ quantity: '2' }));

    const oversell = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        side: 'sell',
        quantity: '3',
      }),
    );

    expect(oversell.status).toBe('POLICY_REJECTED');
    expect(oversell.checkResults.find((check) => check.rule === 'no_short_selling')).toEqual({
      rule: 'no_short_selling',
      passed: false,
      reason:
        "You hold 2, with 0 already in other open sell orders, so you can sell at most 2. Short selling isn't allowed.",
    });
  });

  it('counts real broker holdings for sells in paper mode', async () => {
    // The fake broker holds 2 VFV.TO in the TFSA; selling 1 needs a $200 limit.
    await updatePolicy(testApp, user.userId, {
      allowedSides: ['buy', 'sell'],
      maxOrderValue: '200',
    });

    const sellId = await proposePending({ symbol: 'VFV.TO', side: 'sell', quantity: '1' });
    const result = await approve(sellId);

    expect(result.intent.status).toBe('FILLED');
    expect(await paperQuantity(testApp, { userId: user.userId, symbol: 'VFV.TO' })).toBe('-1');
  });
});

describe('stored decision', () => {
  it('stores the fresh approval-time price and check results on the intent', async () => {
    const intentId = await proposePending();
    testApp.fake.brokerage.quotes[XEQT_ID] = {
      last: 33,
      bid: 32.9,
      ask: 33,
    };
    testApp.clock.advanceMs(20_000);

    await approve(intentId);

    const [row] = await testApp.deps.db
      .select({ estPrice: orderIntents.estPrice, decidedAt: orderIntents.decidedAt })
      .from(orderIntents)
      .where(eq(orderIntents.id, intentId));
    expect(row).toEqual({ estPrice: '33', decidedAt: testApp.clock.now() });
  });
});

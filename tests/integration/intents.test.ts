import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sendApprovalEmail } from '../../src/approvals/email.js';
import type { DatabaseConnection } from '../../src/db/client.js';
import { auditEvents, orderIntents, sessions, users } from '../../src/db/schema.js';
import type { Deps } from '../../src/deps.js';
import { setKillSwitch, setMode } from '../../src/intents/controls.js';
import { approveIntent, cancelIntent } from '../../src/intents/decisions.js';
import { getIntent, proposeOrder } from '../../src/intents/service.js';
import { runSweepOnce } from '../../src/jobs/sweeper.js';
import { ConflictError, NotFoundError } from '../../src/lib/errors.js';
import {
  buildTestApp,
  postForm,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import {
  AI_PROPOSER,
  allowAccount,
  countIntents,
  expectIntent,
  findAccountRef,
  intentAuditTrail,
  intentStatus,
  listExecutions,
  proposeTestOrder,
} from '../helpers/intents.js';
import { MARGIN_ACCOUNT_ID } from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;
let accountRef: string;

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ELEVEN_MINUTES_MS = 11 * 60 * 1000;
const IDEMPOTENCY_KEY = '0b5f4c3e-6a1d-4f5e-9c8b-7a6d5e4f3c2b';
// SnapTrade answers every quote request (and both read retries) with a server error.
const QUOTES_DOWN = [/\/quotes$/, { status: 500 }, 3] as const;

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

async function proposePending(): Promise<string> {
  const intent = expectIntent(
    await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
  );
  expect(intent.status).toBe('PENDING_APPROVAL');
  return intent.id;
}

describe('proposing an order', () => {
  it('creates a pending intent with an approval link when every rule passes', async () => {
    const result = await proposeTestOrder(testApp, user.userId, { account_ref: accountRef });

    const intent = expectIntent(result);
    expect(intent).toMatchObject({
      status: 'PENDING_APPROVAL',
      symbol: 'XEQT.TO',
      securityName: 'iShares Core Equity ETF Portfolio',
      mode: 'paper',
      estPrice: '32.1',
      estValue: '32.10',
      priceSource: 'quote',
      proposedBy: 'claude.ai',
      policyVersion: 1,
    });
    expect(intent.checkResults).toHaveLength(16);
    expect(intent.checkResults.every((check) => check.passed)).toBe(true);
    expect(intent.expiresAt.getTime() - testApp.clock.now().getTime()).toBe(TEN_MINUTES_MS);
    expect(result.kind === 'intent' ? result.approvalUrl : null).toBe(
      `http://localhost:3000/approvals/${intent.id}`,
    );
  });

  it('rejects an order that breaks two rules and reports both reasons', async () => {
    // 4 × $152.40 = $609.60: over the $100 per-order limit and the $250 daily limit.
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        symbol: 'VFV.TO',
        quantity: '4',
      }),
    );

    expect(intent.status).toBe('POLICY_REJECTED');
    const failed = intent.checkResults.filter((check) => !check.passed);
    expect(failed.map((check) => check.rule)).toEqual(['max_order_value', 'max_daily_value']);
    expect(failed[0]?.reason).toBe(
      'Order value $609.60 CAD exceeds your per-order limit of $100.00 CAD.',
    );
  });

  it('rejects an order on an account the user has not allowed', async () => {
    const marginRef = await findAccountRef(testApp, user.userId, MARGIN_ACCOUNT_ID);

    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: marginRef }),
    );

    expect(intent.status).toBe('POLICY_REJECTED');
    expect(intent.checkResults.filter((check) => !check.passed).map((c) => c.rule)).toEqual([
      'account_allowed',
    ]);
  });

  it("treats someone else's account as not found", async () => {
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });
    const otherRef = await allowAccount(testApp, other.userId);

    await expect(
      proposeTestOrder(testApp, user.userId, { account_ref: otherRef }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns INVALID_INPUT for an unknown symbol, creates no intent, and audits it', async () => {
    const result = await proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      symbol: 'NOPE',
    });

    expect(result).toEqual({
      kind: 'invalid_input',
      reason: 'Unknown symbol for this account: NOPE.',
      candidates: [],
    });
    expect(await countIntents(testApp)).toBe(0);
    const [audit] = await testApp.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'intent.input_rejected'));
    expect(audit).toMatchObject({ actor: 'ai', actorDetail: 'claude.ai', intentId: null });
  });

  it('returns INVALID_INPUT with the candidates for an ambiguous symbol', async () => {
    const result = await proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      symbol: 'abc',
    });

    expect(result).toMatchObject({ kind: 'invalid_input', candidates: ['ABC.TO', 'ABC'] });
    expect(await countIntents(testApp)).toBe(0);
  });

  it('returns INVALID_INPUT for a malformed quantity', async () => {
    const result = await proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      quantity: '-1',
    });

    expect(result).toEqual({
      kind: 'invalid_input',
      reason: 'quantity: must be a positive number like 2 or 0.5',
      candidates: [],
    });
  });

  it('finds the security by ticker when the broker has no symbol search (Sandbox)', async () => {
    testApp.fake.failApi(/\/symbols$/, { status: 501, body: { detail: 'Not implemented' } });

    const result = await proposeTestOrder(testApp, user.userId, { account_ref: accountRef });

    expect(expectIntent(result)).toMatchObject({
      status: 'PENDING_APPROVAL',
      symbol: 'XEQT.TO',
      estPrice: '32.1',
    });
    const searches = testApp.fake.requests.filter((request) =>
      request.url.pathname.endsWith('/symbols'),
    );
    expect(searches).toHaveLength(1);
  });

  it('creates nothing when the broker cannot be reached for a price', async () => {
    testApp.fake.failApi(...QUOTES_DOWN);

    const result = await proposeTestOrder(testApp, user.userId, { account_ref: accountRef });

    expect(result).toEqual({
      kind: 'unavailable',
      reason:
        "Couldn't get fresh data from your broker. Try again in a minute (or reconnect SnapTrade).",
    });
    expect(await countIntents(testApp)).toBe(0);
  });
});

describe('idempotency', () => {
  it('returns the same intent for the same key and the same order', async () => {
    const first = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        quantity: '1',
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    );

    // The same order written differently (a number instead of a string) is the same order.
    const second = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        quantity: 1,
        idempotency_key: IDEMPOTENCY_KEY,
      }),
    );

    expect(second.id).toBe(first.id);
    expect(await countIntents(testApp)).toBe(1);
  });

  it('refuses the same key for a different quantity', async () => {
    await proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      idempotency_key: IDEMPOTENCY_KEY,
    });

    const retry = proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      quantity: '2',
      idempotency_key: IDEMPOTENCY_KEY,
    });

    await expect(retry).rejects.toBeInstanceOf(ConflictError);
    await expect(retry).rejects.toThrow(
      'This idempotency key was already used for a different order.',
    );
    expect(await countIntents(testApp)).toBe(1);
  });

  it('creates one intent when two retries with one key arrive at the same moment', async () => {
    const order = { account_ref: accountRef, idempotency_key: IDEMPOTENCY_KEY };

    const [first, second] = await Promise.all([
      proposeTestOrder(testApp, user.userId, order),
      proposeTestOrder(testApp, user.userId, order),
    ]);

    expect(expectIntent(first).id).toBe(expectIntent(second).id);
    expect(await countIntents(testApp)).toBe(1);
  });
});

describe('expiry', () => {
  it('expires a pending intent after its window, so it can no longer be approved', async () => {
    const intentId = await proposePending();
    testApp.clock.advanceMs(ELEVEN_MINUTES_MS);

    const result = await approveIntent(testApp.deps, { userId: user.userId, intentId });

    expect(result.kind).toBe('intent');
    expect(result.intent.status).toBe('EXPIRED');
    expect(await listExecutions(testApp, [intentId])).toEqual([]);
    expect(await intentAuditTrail(testApp, intentId)).toEqual([
      'intent.proposed',
      'intent.pending_approval',
      'intent.expired',
    ]);
  });

  it('still shows a pending intent one second before it expires', async () => {
    const intentId = await proposePending();
    testApp.clock.advanceMs(TEN_MINUTES_MS - 1000);

    const intent = await getIntent(testApp.deps, user.userId, intentId);

    expect(intent.status).toBe('PENDING_APPROVAL');
  });

  it('lets the sweeper expire intents and purge expired sessions without any page load', async () => {
    const intentId = await proposePending();
    testApp.clock.advanceMs(25 * 60 * 60 * 1000);

    const summary = await runSweepOnce(testApp.deps);

    expect(summary.expiredIntents).toBe(1);
    expect(summary.purgedRows).toBeGreaterThanOrEqual(1);
    expect(await intentStatus(testApp, intentId)).toBe('EXPIRED');
    expect(await testApp.deps.db.select().from(sessions)).toEqual([]);
  });

  it('does nothing on a second sweep', async () => {
    await proposePending();
    testApp.clock.advanceMs(ELEVEN_MINUTES_MS);
    await runSweepOnce(testApp.deps);

    const summary = await runSweepOnce(testApp.deps);

    expect(summary).toEqual({
      expiredIntents: 0,
      processedWebhooks: 0,
      deletedDemoUsers: 0,
      purgedRows: 0,
    });
  });
});

describe('kill switch', () => {
  it('cancels pending intents, blocks new ones, and makes a stale approval page harmless', async () => {
    const pendingId = await proposePending();

    const { cancelled } = await setKillSwitch(testApp.deps, { userId: user.userId, on: true });
    const blocked = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );
    const staleApproval = await approveIntent(testApp.deps, {
      userId: user.userId,
      intentId: pendingId,
    });

    expect(cancelled).toBe(1);
    expect(await intentStatus(testApp, pendingId)).toBe('CANCELLED');
    expect(blocked.status).toBe('POLICY_REJECTED');
    expect(blocked.checkResults.filter((c) => !c.passed).map((c) => c.rule)).toEqual([
      'kill_switch_off',
    ]);
    expect(staleApproval.intent.status).toBe('CANCELLED');
    expect(await listExecutions(testApp, [pendingId])).toEqual([]);
  });

  it('lets orders through again once it is turned off', async () => {
    await setKillSwitch(testApp.deps, { userId: user.userId, on: true });
    await setKillSwitch(testApp.deps, { userId: user.userId, on: false });

    expect(await proposePending()).toBeTruthy();
  });
});

describe('mode', () => {
  it('fails the approval re-check when the mode changed after the proposal', async () => {
    const intentId = await proposePending();
    // setMode refuses live on this server, so switch the stored mode directly.
    await testApp.deps.db.update(users).set({ mode: 'live' }).where(eq(users.id, user.userId));

    const result = await approveIntent(testApp.deps, { userId: user.userId, intentId });

    expect(result.intent.status).toBe('POLICY_REJECTED');
    const failed = result.intent.checkResults.filter((check) => !check.passed);
    expect(failed.map((check) => check.rule)).toContain('mode_allowed');
    expect(failed.find((check) => check.rule === 'mode_allowed')?.reason).toBe(
      'Mode changed since this order was proposed. Ask the AI to propose again.',
    );
    expect(await listExecutions(testApp, [intentId])).toEqual([]);
  });

  it('refuses to switch to live mode while live trading is off, and says why', async () => {
    const result = await setMode(testApp.deps, { userId: user.userId, mode: 'live' });

    expect(result).toEqual({
      ok: false,
      problems: [
        'Live trading is turned off on this server.',
        "Your SnapTrade sign-in doesn't include trading permission (SnapTrade hasn't enabled it for this app yet).",
      ],
    });
    const [row] = await testApp.deps.db
      .select({ mode: users.mode })
      .from(users)
      .where(eq(users.id, user.userId));
    expect(row?.mode).toBe('paper');
  });
});

describe('cancelling', () => {
  it('lets the AI cancel a pending intent, and a second cancel returns it unchanged', async () => {
    const intentId = await proposePending();
    const request = {
      userId: user.userId,
      intentId,
      actor: 'ai',
      actorDetail: 'claude.ai',
    } as const;

    const first = await cancelIntent(testApp.deps, request);
    const second = await cancelIntent(testApp.deps, request);

    expect(first.intent.status).toBe('CANCELLED');
    expect(second.kind).toBe('intent');
    expect(await intentAuditTrail(testApp, intentId)).toEqual([
      'intent.proposed',
      'intent.pending_approval',
      'intent.cancelled',
    ]);
  });

  it('refuses to cancel an order that already filled', async () => {
    const intentId = await proposePending();
    await approveIntent(testApp.deps, { userId: user.userId, intentId });

    const result = await cancelIntent(testApp.deps, { userId: user.userId, intentId, actor: 'ai' });

    expect(result).toMatchObject({
      kind: 'cannot_cancel',
      reason:
        "Can't cancel an order that is FILLED. Only orders waiting for approval can be cancelled.",
    });
  });

  it('cancels pending intents when the user disconnects SnapTrade', async () => {
    const intentId = await proposePending();

    const response = await postForm(testApp, '/disconnect', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    expect(response.status).toBe(200);
    expect(await intentStatus(testApp, intentId)).toBe('CANCELLED');
    const [audit] = await testApp.deps.db
      .select({ actor: auditEvents.actor, details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'intent.cancelled'));
    expect(audit).toEqual({
      actor: 'system',
      details: {
        from: 'PENDING_APPROVAL',
        to: 'CANCELLED',
        reason: 'SnapTrade was disconnected.',
      },
    });
  });
});

describe('audit trail', () => {
  it('writes one audit row for every state change of a filled order', async () => {
    const intentId = await proposePending();

    await approveIntent(testApp.deps, { userId: user.userId, intentId });

    expect(await intentAuditTrail(testApp, intentId)).toEqual([
      'intent.proposed',
      'intent.pending_approval',
      'intent.approved',
      'intent.executing',
      'intent.filled',
    ]);
  });

  it('writes one audit row for every state change of an order rejected at approval', async () => {
    const intentId = await proposePending();
    await testApp.deps.db.update(users).set({ mode: 'live' }).where(eq(users.id, user.userId));

    await approveIntent(testApp.deps, { userId: user.userId, intentId });

    expect(await intentAuditTrail(testApp, intentId)).toEqual([
      'intent.proposed',
      'intent.pending_approval',
      'intent.approved',
      'intent.policy_rejected',
    ]);
  });

  it('keeps the database status and the last audit event in agreement', async () => {
    const intentId = await proposePending();
    await approveIntent(testApp.deps, { userId: user.userId, intentId });

    const [intent] = await testApp.deps.db
      .select({ status: orderIntents.status })
      .from(orderIntents)
      .where(eq(orderIntents.id, intentId));
    const trail = await intentAuditTrail(testApp, intentId);

    expect(trail.at(-1)).toBe(`intent.${intent?.status.toLowerCase()}`);
  });
});

describe('approval email', () => {
  function depsWithEmail(sent: Request[]): Deps {
    return {
      ...testApp.deps,
      env: { ...testApp.deps.env, RESEND_API_KEY: 'test-resend-key', EMAIL_FROM: 'gg@example.com' },
      fetch: async (input, init) => {
        sent.push(new Request(input, init));
        return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
      },
    };
  }

  it('sends a plain summary with the link and no account number', async () => {
    const intentId = await proposePending();
    const intent = await getIntent(testApp.deps, user.userId, intentId);
    const sent: Request[] = [];

    await sendApprovalEmail(
      depsWithEmail(sent),
      { email: 'test.user@example.com', emailVerified: true },
      intent,
    );

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe('https://api.resend.com/emails');
    expect(request?.headers.get('authorization')).toBe('Bearer test-resend-key');
    const body = (await request?.json()) as { subject: string; text: string; to: string };
    expect(body.subject).toBe('Approval needed: BUY 1 XEQT.TO (paper)');
    expect(body.to).toBe('test.user@example.com');
    expect(body.text).toContain(`http://localhost:3000/approvals/${intentId}`);
    expect(body.text).not.toContain('8443');
  });

  it('skips the email for an unverified address and only logs the reason', async () => {
    const intentId = await proposePending();
    const intent = await getIntent(testApp.deps, user.userId, intentId);
    const sent: Request[] = [];

    await sendApprovalEmail(
      depsWithEmail(sent),
      { email: 'test.user@example.com', emailVerified: false },
      intent,
    );

    expect(sent).toEqual([]);
    expect(testApp.logs.some((line) => line.includes('"email.skipped"'))).toBe(true);
  });

  it('never fails when Resend is unreachable', async () => {
    const intentId = await proposePending();
    const intent = await getIntent(testApp.deps, user.userId, intentId);
    const deps: Deps = {
      ...depsWithEmail([]),
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    };

    await expect(
      sendApprovalEmail(deps, { email: 'test.user@example.com', emailVerified: true }, intent),
    ).resolves.toBeUndefined();
  });
});

describe('who proposed it', () => {
  it('records the AI client host on the intent and in the audit log', async () => {
    const intentId = await proposePending();

    const [audit] = await testApp.deps.db
      .select({ actor: auditEvents.actor, actorDetail: auditEvents.actorDetail })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'intent.proposed'));

    expect(audit).toEqual({ actor: AI_PROPOSER.actor, actorDetail: 'claude.ai' });
    expect((await getIntent(testApp.deps, user.userId, intentId)).proposedBy).toBe('claude.ai');
  });
});

describe('the claim check', () => {
  const WRONG_PRICE_REASONING = {
    why: 'The user wants a one-fund portfolio.',
    expected_price: '50',
    company_name: 'iShares Core Equity ETF Portfolio',
    user_request: 'buy one share of XEQT',
    sources: ['https://www.blackrock.com/ca/xeqt'],
  };

  it('stores a differing price claim when the AI expected the wrong price', async () => {
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        reasoning: WRONG_PRICE_REASONING,
      }),
    );

    expect(intent.aiReasoning).toEqual(WRONG_PRICE_REASONING);
    expect(intent.claimResults).toEqual([
      {
        claim: 'price',
        status: 'differs',
        aiSaid: '50',
        brokerSays: '32.1',
        message:
          "The AI expected about $50.00 CAD a share, but your broker's latest price is $32.10 CAD (36% lower).",
      },
      expect.objectContaining({ claim: 'company', status: 'matches' }),
    ]);
  });

  it('never changes the policy decision', async () => {
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, {
        account_ref: accountRef,
        reasoning: WRONG_PRICE_REASONING,
      }),
    );

    expect(intent.status).toBe('PENDING_APPROVAL');
    expect(intent.checkResults.every((check) => check.passed)).toBe(true);
  });

  it('records only the claim statuses in the audit log, never the AI free text', async () => {
    await proposeTestOrder(testApp, user.userId, {
      account_ref: accountRef,
      reasoning: WRONG_PRICE_REASONING,
    });

    const [audit] = await testApp.deps.db
      .select({ details: auditEvents.details })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'intent.proposed'));

    expect(audit?.details).toMatchObject({
      claimStatuses: [
        { claim: 'price', status: 'differs' },
        { claim: 'company', status: 'matches' },
      ],
    });
    expect(JSON.stringify(audit?.details)).not.toContain('one-fund portfolio');
  });

  it('tells the human the AI gave no reasons when it sent none', async () => {
    const intent = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );

    expect(intent.aiReasoning).toBeNull();
    expect(intent.claimResults).toEqual([
      { claim: 'reasoning', status: 'missing', message: 'The AI gave no reasons for this order.' },
    ]);
  });

  it("skips the claim check for the user's own test orders", async () => {
    const intent = expectIntent(
      await proposeOrder(testApp.deps, {
        userId: user.userId,
        proposer: { actor: 'user', actorDetail: 'manual test', grantId: null },
        input: {
          account_ref: accountRef,
          symbol: 'XEQT.TO',
          side: 'buy',
          quantity: '1',
          order_type: 'market',
        },
      }),
    );

    expect(intent.claimResults).toBeNull();
  });
});

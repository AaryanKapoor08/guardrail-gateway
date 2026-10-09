import type { Client } from '@modelcontextprotocol/client';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { mcpGrants, orderIntents, snaptradeGrants } from '../../src/db/schema.js';
import { HUMAN_APPROVAL_SENTENCE } from '../../src/mcp/tool-kit.js';
import {
  buildTestApp,
  postForm,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { DEFAULT_TEST_START } from '../helpers/clock.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import { allowAccount, countIntents, findAccountRef, intentStatus } from '../helpers/intents.js';
import {
  callTool,
  connectMcpClient,
  connectModernMcpClient,
  intentIdOf,
  TEST_HOST,
  textOf,
} from '../helpers/mcp.js';
import { connectClaude, type IssuedTokens } from '../helpers/oauth.js';
import { MARGIN_ACCOUNT_ID, TFSA_ACCOUNT_ID } from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;
let accountRef: string;
let tokens: IssuedTokens;
let client: Client;

const TOOL_NAMES = [
  'list_accounts',
  'get_positions',
  'get_balances',
  'get_policy',
  'propose_order',
  'get_order_status',
  'list_recent_intents',
  'cancel_order_intent',
];

beforeAll(async () => {
  // The SDK's bearer gate re-checks token expiry against the real Date.now(), which our injected
  // clock can't reach. Pin Date to the test clock's start so the two agree whatever today is.
  vi.useFakeTimers({ toFake: ['Date'], now: DEFAULT_TEST_START });
  connection = await setupTestDb();
});

afterAll(async () => {
  vi.useRealTimers();
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(connection.db);
  testApp = await buildTestApp(connection);
  user = await signInTestUser(testApp);
  accountRef = await allowAccount(testApp, user.userId);
  tokens = await connectClaude(testApp, user);
  client = await connectMcpClient(testApp, tokens.access_token);
});

afterEach(async () => {
  await client.close();
});

function postMcp(headers: Record<string, string>): Promise<Response> {
  return Promise.resolve(
    testApp.app.request('/mcp', {
      method: 'POST',
      headers: { host: TEST_HOST, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
}

function proposeXeqt(extra: Record<string, unknown> = {}) {
  return callTool(client, 'propose_order', {
    account_ref: accountRef,
    symbol: 'XEQT.TO',
    side: 'buy',
    quantity: 1,
    order_type: 'market',
    ...extra,
  });
}

describe('the bearer gate', () => {
  it('answers 401 with the resource metadata link when no token is sent', async () => {
    const response = await postMcp({});

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it('answers 401 once the user disconnects the app', async () => {
    const [grant] = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);
    await postForm(testApp, `/apps/${grant?.id}/revoke`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    const response = await postMcp({ authorization: `Bearer ${tokens.access_token}` });

    expect(response.status).toBe(401);
  });

  it('refuses a request for another host name (DNS rebinding protection)', async () => {
    const response = await postMcp({
      authorization: `Bearer ${tokens.access_token}`,
      host: 'evil.example',
    });

    expect(response.status).toBe(403);
  });
});

describe('tools/list', () => {
  it('lists exactly the 8 tools, in order, with annotations and the approval sentence', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(tools.every((tool) => tool.description?.endsWith(HUMAN_APPROVAL_SENTENCE))).toBe(true);
    expect(tools.every((tool) => tool.annotations?.openWorldHint === false)).toBe(true);
    expect(tools.every((tool) => tool.annotations?.destructiveHint === false)).toBe(true);
    expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly).toEqual([
      'list_accounts',
      'get_positions',
      'get_balances',
      'get_policy',
      'get_order_status',
      'list_recent_intents',
    ]);
    const notIdempotent = tools.filter((tool) => !tool.annotations?.idempotentHint);
    expect(notIdempotent.map((tool) => tool.name)).toEqual(['propose_order']);
  });

  it('has no tool that approves, changes policy, or controls the kill switch or mode', async () => {
    const { tools } = await client.listTools();

    const names = tools.map((tool) => tool.name).join(' ');
    expect(names).not.toMatch(/approve|deny|policy_update|set_|kill|mode|allow|disconnect/);
  });
});

describe('read-only tools', () => {
  it('lists only allowed accounts, with the last 4 digits and no SnapTrade ids', async () => {
    const result = await callTool(client, 'list_accounts');

    expect(result.structuredContent).toEqual({
      accounts: [
        {
          account_ref: accountRef,
          institution: 'SnapTrade Sandbox',
          name: 'Sandbox TFSA',
          raw_type: 'TFSA',
          category: 'INVESTMENT',
          number_last4: '8443',
          is_paper: false,
          connection_status: 'healthy',
        },
      ],
    });
    const everything = JSON.stringify(result);
    expect(everything).not.toContain(TFSA_ACCOUNT_ID);
    expect(everything).not.toContain('Q6542138443');
  });

  it('shows broker positions and, in paper mode, simulated ones labelled "paper"', async () => {
    const proposed = await proposeXeqt();
    const intentId = intentIdOf(proposed);
    await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });

    const result = await callTool(client, 'get_positions', { account_ref: accountRef });

    expect(result.structuredContent).toEqual({
      account_ref: accountRef,
      positions: [
        {
          symbol: 'VFV.TO',
          quantity: '2',
          price: '152.00',
          value: '304.00',
          currency: 'CAD',
          source: 'broker',
        },
        {
          symbol: 'XEQT.TO',
          quantity: '1',
          price: '32.1',
          value: '32.10',
          currency: 'CAD',
          source: 'paper',
        },
      ],
      other_holdings_count: 0,
    });
  });

  it('shows cash per currency', async () => {
    const result = await callTool(client, 'get_balances', { account_ref: accountRef });

    expect(result.structuredContent).toEqual({
      account_ref: accountRef,
      balances: [{ currency: 'CAD', cash: '500.25', buying_power: '500.25' }],
    });
  });

  it("treats an account the user hasn't allowed as not found", async () => {
    const marginRef = await findAccountRef(testApp, user.userId, MARGIN_ACCOUNT_ID);

    const result = await callTool(client, 'get_positions', { account_ref: marginRef });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "We couldn't find that account among the ones the user allowed.",
    );
  });

  it('explains the policy and what is left of today', async () => {
    await proposeXeqt();

    const result = await callTool(client, 'get_policy');

    expect(result.structuredContent).toMatchObject({
      mode: 'paper',
      kill_switch: false,
      today: { remaining_value: '217.90', remaining_orders: 4, currency: 'CAD' },
    });
    expect(textOf(result)).toContain('Per-order limit: $100.00 CAD.');
  });

  it('asks the user to reconnect, as a normal result, when the SnapTrade sign-in is gone', async () => {
    await testApp.deps.db.delete(snaptradeGrants).where(eq(snaptradeGrants.userId, user.userId));

    const result = await callTool(client, 'get_balances', { account_ref: accountRef });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      balances: [],
      reconnect_message:
        'Your SnapTrade connection needs to be renewed. Sign in at http://localhost:3000.',
    });
  });
});

describe('proposing through MCP', () => {
  it('returns a pending intent with an approval link; after approval the status is FILLED', async () => {
    const proposed = await proposeXeqt({ idempotency_key: '7d0c8a2e-3b1f-4c5d-9e6f-1a2b3c4d5e6f' });
    const intentId = intentIdOf(proposed);

    await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });
    const status = await callTool(client, 'get_order_status', { intent_id: intentId });

    expect(proposed.structuredContent).toMatchObject({
      status: 'PENDING_APPROVAL',
      approval_url: `http://localhost:3000/approvals/${intentId}`,
      estimate: { price: '32.1', value: '32.10', currency: 'CAD', price_source: 'quote' },
    });
    expect(textOf(proposed)).toContain('is waiting for the user');
    expect(status.structuredContent).toMatchObject({
      status: 'FILLED',
      approval_url: null,
      fill: { filled_quantity: '1', avg_fill_price: '32.1' },
    });
  });

  it('records the AI app as the proposer', async () => {
    const proposed = await proposeXeqt();

    const [row] = await testApp.deps.db
      .select({ proposedBy: orderIntents.proposedBy, grantId: orderIntents.grantId })
      .from(orderIntents)
      .where(eq(orderIntents.id, intentIdOf(proposed)));
    const [grant] = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);

    expect(row).toEqual({ proposedBy: 'claude.ai', grantId: grant?.id });
  });

  it('returns a policy rejection as a normal result with the reason', async () => {
    const marginRef = await findAccountRef(testApp, user.userId, MARGIN_ACCOUNT_ID);

    const result = await proposeXeqt({ account_ref: marginRef });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: 'POLICY_REJECTED' });
    expect(textOf(result)).toContain('was rejected by the user');
  });

  it("treats another user's account_ref as not found", async () => {
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });
    const otherRef = await allowAccount(testApp, other.userId);

    const result = await proposeXeqt({ account_ref: otherRef });

    expect(result.isError).toBe(true);
    expect(await countIntents(testApp)).toBe(0);
  });

  it('rejects input with an extra user_id field and creates nothing', async () => {
    const other = await signInTestUser(testApp, {
      sub: 'snaptrade-user-2',
      email: 'b@example.com',
    });

    const result = await proposeXeqt({ user_id: other.userId });

    expect(result.isError).toBe(true);
    expect(await countIntents(testApp)).toBe(0);
  });

  it('returns INVALID_INPUT with candidates for an ambiguous symbol', async () => {
    const result = await proposeXeqt({ symbol: 'ABC' });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: 'INVALID_INPUT',
      reason: expect.stringContaining('Ambiguous symbol ABC'),
      candidates: ['ABC.TO', 'ABC'],
    });
  });

  it('refuses the 11th proposal in a minute', async () => {
    const results = await Promise.all(Array.from({ length: 11 }, () => proposeXeqt()));

    const refused = results.filter((result) => result.isError);
    expect(refused).toHaveLength(1);
    expect(refused.map(textOf)).toEqual([
      'Too many orders proposed in the last minute (the limit is 10). Wait a minute and try again.',
    ]);
    expect(await countIntents(testApp)).toBe(10);
  });

  it('allows proposals again a minute later', async () => {
    await Promise.all(Array.from({ length: 10 }, () => proposeXeqt()));
    testApp.clock.advanceMs(60_001);

    const result = await proposeXeqt();

    expect(result.isError).toBeFalsy();
  });
});

describe('the 2026-07-28 protocol revision', () => {
  it('serves a modern stateless client the same tools and results', async () => {
    const modern = await connectModernMcpClient(testApp, tokens.access_token);

    const { tools } = await modern.listTools();
    const proposed = await callTool(modern, 'propose_order', {
      account_ref: accountRef,
      symbol: 'XEQT.TO',
      side: 'buy',
      quantity: '1',
      order_type: 'market',
    });
    await modern.close();

    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(proposed.structuredContent).toMatchObject({ status: 'PENDING_APPROVAL' });
  });
});

describe('order tools', () => {
  it('lists recent intents, newest first, up to the limit', async () => {
    await proposeXeqt();
    await proposeXeqt({ symbol: 'SHOP.TO' });

    const result = await callTool(client, 'list_recent_intents', { limit: 1 });

    expect(result.structuredContent).toMatchObject({
      intents: [{ symbol: 'SHOP.TO', side: 'buy', quantity: '1', status: 'PENDING_APPROVAL' }],
    });
  });

  it('cancels a pending intent, and cancelling again returns it unchanged', async () => {
    const proposed = await proposeXeqt();
    const intentId = intentIdOf(proposed);

    const first = await callTool(client, 'cancel_order_intent', { intent_id: intentId });
    const second = await callTool(client, 'cancel_order_intent', { intent_id: intentId });

    expect(first.structuredContent).toMatchObject({ status: 'CANCELLED', cancelled: true });
    expect(second.structuredContent).toMatchObject({ status: 'CANCELLED', cancelled: true });
    expect(await intentStatus(testApp, intentId)).toBe('CANCELLED');
  });

  it('answers "not found" for an intent of another user', async () => {
    const result = await callTool(client, 'get_order_status', {
      intent_id: '00000000-0000-4000-8000-000000000000',
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("We couldn't find that order.");
  });
});

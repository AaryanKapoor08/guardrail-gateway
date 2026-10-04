import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import { accounts, auditEvents, mcpGrants, mcpTokens, users } from '../../src/db/schema.js';
import {
  DEMO_INDIVIDUAL_ID,
  DEMO_TFSA_ID,
  handleDemoRequest,
} from '../../src/demo/demo-brokerage.js';
import { MAX_ACTIVE_DEMO_USERS } from '../../src/demo/demo-users.js';
import { getIntent } from '../../src/intents/service.js';
import { runSweepOnce } from '../../src/jobs/sweeper.js';
import { snaptradeFetch } from '../../src/snaptrade/api.js';
import {
  getBalances,
  getPositions,
  getQuotes,
  searchSymbols,
} from '../../src/snaptrade/resources.js';
import {
  buildTestApp,
  getPage,
  postForm,
  type SignedInTestUser,
  signedInFromResponse,
  TEST_ORIGIN,
  type TestApp,
} from '../helpers/app.js';
import { countUserRows, setupTestDb, truncateAll } from '../helpers/db.js';
import { intentStatus } from '../helpers/intents.js';
import { authorizePath, connectClaude, locationOf, serveClaudeMetadata } from '../helpers/oauth.js';

let connection: DatabaseConnection;
let testApp: TestApp;

beforeAll(async () => {
  connection = await setupTestDb();
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(connection.db);
  testApp = await buildTestApp(connection);
});

function postDemoStart(form: Record<string, string> = {}, ip = '203.0.113.5'): Promise<Response> {
  return Promise.resolve(
    testApp.app.request('/demo/start', {
      method: 'POST',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
        'x-forwarded-for': ip,
      },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

async function startDemoUser(): Promise<SignedInTestUser> {
  return signedInFromResponse(testApp, await postDemoStart());
}

async function runStep(user: SignedInTestUser, step: string): Promise<string> {
  const response = await postForm(testApp, `/try/${step}`, {
    cookie: user.cookie,
    form: { csrf: user.csrfToken },
  });
  return locationOf(response).searchParams.get('result') ?? '';
}

async function tryPageFor(intentId: string, user: SignedInTestUser): Promise<string> {
  return (await getPage(testApp, `/try?result=${intentId}`, user.cookie)).text();
}

describe('starting a demo', () => {
  it('creates an isolated demo user with fake accounts, the TFSA allowed, and opens /try', async () => {
    const response = await postDemoStart();
    const user = await signedInFromResponse(testApp, response);

    const rows = await testApp.deps.db
      .select({ id: accounts.snaptradeAccountId, allowed: accounts.allowed, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.userId, user.userId));
    const page = await (await getPage(testApp, '/try', user.cookie)).text();

    expect(response.headers.get('location')).toBe('/try');
    expect(rows.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { id: DEMO_INDIVIDUAL_ID, allowed: false, name: 'Demo Individual' },
      { id: DEMO_TFSA_ID, allowed: true, name: 'Demo TFSA' },
    ]);
    expect(page).toContain('DEMO DATA, not a real brokerage.');
    expect(page).toContain('Ask for something too big');
  });

  it('shows the two equal ways in on the home page', async () => {
    const html = await (await getPage(testApp, '/')).text();

    expect(html).toContain('Try the demo (no sign-up, ~1 minute)');
    expect(html).toContain('Sign in with SnapTrade');
  });

  it('refuses the 6th demo from one address within an hour', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => postDemoStart({}, '198.51.100.1')),
    );
    const fromAnotherAddress = await postDemoStart({}, '198.51.100.2');

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 302)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(fromAnotherAddress.status).toBe(302);
  });

  it('refuses new demos while 300 are active', async () => {
    await testApp.deps.db.insert(users).values(
      Array.from({ length: MAX_ACTIVE_DEMO_USERS }, () => ({
        snaptradeSub: `demo:${randomUUID()}`,
        isDemo: true,
      })),
    );

    const response = await postDemoStart();

    expect(response.status).toBe(429);
    expect(await response.text()).toContain('The demo is busy, try again soon');
  });

  it('refuses a demo start posted from another site', async () => {
    const response = await testApp.app.request('/demo/start', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: '',
    });

    expect(response.status).toBe(403);
  });
});

describe('the guided steps', () => {
  it('rejects the too-big order with both limit reasons', async () => {
    const user = await startDemoUser();

    const intentId = await runStep(user, 'too-big');
    const html = await tryPageFor(intentId, user);

    expect(await intentStatus(testApp, intentId)).toBe('POLICY_REJECTED');
    expect(html).toContain(
      'Order value $1,524.00 CAD exceeds your per-order limit of $100.00 CAD.',
    );
    expect(html).toContain('daily limit');
  });

  it('rejects crypto for its asset type only', async () => {
    const user = await startDemoUser();

    const intentId = await runStep(user, 'not-allowed');

    const intent = await getIntent(testApp.deps, user.userId, intentId);
    expect(intent.checkResults.filter((check) => !check.passed).map((check) => check.rule)).toEqual(
      ['asset_type_allowed'],
    );
  });

  it('takes the allowed order through approval to a paper fill, all without SnapTrade', async () => {
    const user = await startDemoUser();

    const intentId = await runStep(user, 'allowed');
    const pending = await intentStatus(testApp, intentId);
    await postForm(testApp, `/approvals/${intentId}/approve`, {
      cookie: user.cookie,
      form: { csrf: user.csrfToken },
    });
    const tryPage = await (await getPage(testApp, '/try', user.cookie)).text();
    const auditPage = await (await getPage(testApp, '/audit', user.cookie)).text();

    expect(pending).toBe('PENDING_APPROVAL');
    expect(await intentStatus(testApp, intentId)).toBe('FILLED');
    expect(tryPage).toContain('0.5 VFV.TO at $152.40 CAD');
    expect(tryPage).toContain('✔ Approve the allowed order and see it filled');
    expect(auditPage).toContain('user (guided demo)');
    expect(testApp.fake.requests).toEqual([]);
  });

  it('refuses live mode for demo users', async () => {
    const user = await startDemoUser();

    const response = await postForm(testApp, '/mode', {
      cookie: user.cookie,
      form: { csrf: user.csrfToken, mode: 'live' },
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toContain('Live mode isn&#39;t available in the demo.');
  });
});

describe('demo data', () => {
  it('parses with the same Zod schemas as real SnapTrade responses', async () => {
    const user = await startDemoUser();

    const positions = await getPositions(testApp.deps, user.userId, DEMO_TFSA_ID);
    const balances = await getBalances(testApp.deps, user.userId, DEMO_TFSA_ID);
    const matches = await searchSymbols(testApp.deps, user.userId, {
      snaptradeAccountId: DEMO_TFSA_ID,
      substring: 'VFV',
    });
    const quotes = await getQuotes(testApp.deps, user.userId, {
      snaptradeAccountId: DEMO_TFSA_ID,
      universalSymbolIds: matches.map((match) => match.universalSymbolId),
    });

    expect(positions.holdings.map((holding) => `${holding.units} ${holding.symbol}`)).toEqual([
      '2 VFV.TO',
      '3 XEQT.TO',
    ]);
    expect(balances).toEqual([{ currency: 'CAD', cash: '1000', buyingPower: '1000' }]);
    expect(matches.map((match) => match.symbol)).toEqual(['VFV.TO']);
    expect(quotes[0]?.lastTradePrice).toBe('152.4');
    expect(testApp.fake.requests).toEqual([]);
  });

  it('never routes a trade for a demo user', async () => {
    const user = await startDemoUser();

    await expect(
      snaptradeFetch(testApp.deps, user.userId, {
        method: 'POST',
        path: '/trade/place',
        body: {},
        retry: 'none',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      handleDemoRequest({
        userId: user.userId,
        method: 'GET',
        path: '/trade/x',
        query: {},
        body: null,
      }).status,
    ).toBe(404);
  });
});

describe('demo cleanup', () => {
  it('deletes a 24-hour-old demo user completely, including connected AI apps', async () => {
    const user = await startDemoUser();
    await connectClaude(testApp, user);
    const grants = await testApp.deps.db.select({ id: mcpGrants.id }).from(mcpGrants);
    await runStep(user, 'allowed');
    testApp.clock.advanceMs(24 * 60 * 60 * 1000 + 1000);

    const summary = await runSweepOnce(testApp.deps);

    expect(summary.deletedDemoUsers).toBe(1);
    const left = await countUserRows(testApp.deps.db, user.userId);
    expect(Object.values(left).every((count) => count === 0)).toBe(true);
    expect(
      await testApp.deps.db
        .select()
        .from(mcpTokens)
        .where(
          inArray(
            mcpTokens.grantId,
            grants.map((grant) => grant.id),
          ),
        ),
    ).toEqual([]);
  });

  it('keeps a demo user younger than 24 hours', async () => {
    await startDemoUser();
    testApp.clock.advanceMs(23 * 60 * 60 * 1000);

    const summary = await runSweepOnce(testApp.deps);

    expect(summary.deletedDemoUsers).toBe(0);
  });
});

describe('connecting Claude to a demo', () => {
  it('offers the demo on the connector sign-in page and lands on consent afterwards', async () => {
    serveClaudeMetadata(testApp);
    const authorize = await getPage(testApp, authorizePath());
    const signIn = locationOf(authorize);
    const mcpRequestId = signIn.searchParams.get('mcp_request') ?? '';

    const response = await postDemoStart({ mcp_request: mcpRequestId });
    const user = await signedInFromResponse(testApp, response);
    const consent = await getPage(testApp, response.headers.get('location') ?? '', user.cookie);

    expect(signIn.pathname).toBe('/signin');
    expect(response.headers.get('location')).toBe(
      `/oauth/authorize/resume?request=${mcpRequestId}`,
    );
    expect(await consent.text()).toContain('Connect claude.ai to Guardrail Gateway?');
  });
});

describe('Try it without an AI', () => {
  it('proposes through the same path, recorded as the user, and needs CSRF', async () => {
    const user = await startDemoUser();
    const [tfsa] = await testApp.deps.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, user.userId), eq(accounts.snaptradeAccountId, DEMO_TFSA_ID)));
    const form = {
      account_ref: tfsa?.id ?? '',
      symbol: 'xeqt.to',
      side: 'buy',
      quantity: '1',
      order_type: 'market',
      limit_price: '',
    };

    const withoutCsrf = await postForm(testApp, '/intents/manual', { cookie: user.cookie, form });
    const response = await postForm(testApp, '/intents/manual', {
      cookie: user.cookie,
      form: { ...form, csrf: user.csrfToken },
    });
    const [audit] = await testApp.deps.db
      .select({ actor: auditEvents.actor, actorDetail: auditEvents.actorDetail })
      .from(auditEvents)
      .where(eq(auditEvents.eventType, 'intent.proposed'));

    expect(withoutCsrf.status).toBe(403);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toMatch(/^\/approvals\/[0-9a-f-]{36}$/);
    expect(audit).toEqual({ actor: 'user', actorDetail: 'manual test' });
  });

  it('explains an invalid proposal in plain words', async () => {
    const user = await startDemoUser();
    const [tfsa] = await testApp.deps.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, user.userId), eq(accounts.snaptradeAccountId, DEMO_TFSA_ID)));

    const response = await postForm(testApp, '/intents/manual', {
      cookie: user.cookie,
      form: {
        csrf: user.csrfToken,
        account_ref: tfsa?.id ?? '',
        symbol: 'NOPE',
        side: 'buy',
        quantity: '1',
        order_type: 'market',
      },
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Unknown symbol for this account: NOPE.');
  });
});

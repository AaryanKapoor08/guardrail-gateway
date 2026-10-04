import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '../../src/db/client.js';
import {
  cachedPositions,
  cachedQuote,
  cachedSymbolSearch,
  POSITIONS_TTL_MS,
  QUOTE_TTL_MS,
} from '../../src/snaptrade/cached.js';
import {
  getBalances,
  getPositions,
  getQuotes,
  searchSymbols,
} from '../../src/snaptrade/resources.js';
import {
  buildTestApp,
  type SignedInTestUser,
  signInTestUser,
  type TestApp,
} from '../helpers/app.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';
import { buildPosition, TFSA_ACCOUNT_ID, VFV_ID, XEQT_ID } from '../helpers/snaptrade-data.js';

let connection: DatabaseConnection;
let testApp: TestApp;
let user: SignedInTestUser;

const POSITIONS_PATH = `/accounts/${TFSA_ACCOUNT_ID}/positions/all`;
const QUOTES_PATH = `/accounts/${TFSA_ACCOUNT_ID}/quotes`;

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

describe('positions', () => {
  it('keeps stocks and ETFs and only counts everything else', async () => {
    testApp.fake.brokerage.positions[TFSA_ACCOUNT_ID] = [
      buildPosition(),
      buildPosition({
        instrument: {
          kind: 'crypto',
          symbol: 'BTC',
          raw_symbol: 'BTC',
          description: 'Bitcoin',
          currency: 'CAD',
        },
      }),
      buildPosition({ units: null }),
    ];

    const positions = await getPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);

    expect(positions.holdings).toEqual([
      {
        symbol: 'VFV.TO',
        rawSymbol: 'VFV',
        kind: 'etf',
        units: '2',
        price: '152.00',
        currency: 'CAD',
      },
    ]);
    expect(positions.otherCount).toBe(2);
  });

  it('serves repeat reads from the 60-second cache, then fetches again', async () => {
    await cachedPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);
    await cachedPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);
    expect(testApp.fake.countRequests(POSITIONS_PATH)).toBe(1);

    testApp.clock.advanceMs(POSITIONS_TTL_MS + 1);
    await cachedPositions(testApp.deps, user.userId, TFSA_ACCOUNT_ID);

    expect(testApp.fake.countRequests(POSITIONS_PATH)).toBe(2);
  });
});

describe('balances', () => {
  it('returns cash per currency as decimal strings', async () => {
    const balances = await getBalances(testApp.deps, user.userId, TFSA_ACCOUNT_ID);

    expect(balances).toEqual([{ currency: 'CAD', cash: '500.25', buyingPower: '500.25' }]);
  });
});

describe('symbol search', () => {
  it('sends the substring and returns the broker’s matching securities', async () => {
    const matches = await searchSymbols(testApp.deps, user.userId, {
      snaptradeAccountId: TFSA_ACCOUNT_ID,
      substring: 'VFV',
    });

    expect(matches).toEqual([
      {
        universalSymbolId: VFV_ID,
        symbol: 'VFV.TO',
        rawSymbol: 'VFV',
        description: 'Vanguard S&P 500 Index ETF',
        currency: 'CAD',
        exchange: 'TSX',
        typeCode: 'et',
      },
    ]);
    const [request] = testApp.fake.requests.filter((r) => r.url.pathname.endsWith('/symbols'));
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ substring: 'VFV' });
  });

  it('caches a search for 24 hours', async () => {
    const request = { snaptradeAccountId: TFSA_ACCOUNT_ID, ticker: 'VFV' };
    await cachedSymbolSearch(testApp.deps, user.userId, request);
    testApp.clock.advanceMs(23 * 60 * 60 * 1000);
    await cachedSymbolSearch(testApp.deps, user.userId, request);

    expect(testApp.fake.countRequests(`/accounts/${TFSA_ACCOUNT_ID}/symbols`)).toBe(1);
  });
});

describe('quotes', () => {
  it('asks by universal symbol id and returns prices as decimal strings', async () => {
    const quotes = await getQuotes(testApp.deps, user.userId, {
      snaptradeAccountId: TFSA_ACCOUNT_ID,
      universalSymbolIds: [VFV_ID, XEQT_ID],
    });

    expect(quotes).toEqual([
      { universalSymbolId: VFV_ID, lastTradePrice: '152.38', bidPrice: '152.3', askPrice: '152.4' },
      { universalSymbolId: XEQT_ID, lastTradePrice: '32.1', bidPrice: '32.05', askPrice: '32.1' },
    ]);
    const [request] = testApp.fake.requests.filter((r) => r.url.pathname === QUOTES_PATH);
    expect(request?.url.searchParams.get('symbols')).toBe(`${VFV_ID},${XEQT_ID}`);
    expect(request?.url.searchParams.get('use_ticker')).toBe('false');
  });

  it('keeps a quote for only 15 seconds', async () => {
    const request = { snaptradeAccountId: TFSA_ACCOUNT_ID, universalSymbolId: VFV_ID };
    await cachedQuote(testApp.deps, user.userId, request);
    await cachedQuote(testApp.deps, user.userId, request);
    testApp.clock.advanceMs(QUOTE_TTL_MS + 1);
    await cachedQuote(testApp.deps, user.userId, request);

    expect(testApp.fake.countRequests(QUOTES_PATH)).toBe(2);
  });

  it('rejects a response that does not have the documented shape', async () => {
    testApp.fake.onApi('GET', /\/quotes$/, () => ({ status: 200, body: [{ price: 'high' }] }));

    await expect(
      getQuotes(testApp.deps, user.userId, {
        snaptradeAccountId: TFSA_ACCOUNT_ID,
        universalSymbolIds: [VFV_ID],
      }),
    ).rejects.toThrow(
      '[SnapTrade] GET /accounts/{id}/quotes response did not have the expected shape',
    );
  });
});

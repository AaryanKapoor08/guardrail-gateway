// The built-in demo brokerage (V§4.7): fixed, clearly fake data in SnapTrade's own response
// shapes, so a demo user goes through exactly the same parsing and code as a real one, without
// any SnapTrade call. Pure: no I/O, the same answer every time.

export type DemoRequest = {
  // The demo user's id: connection ids are global in our database, so each demo user gets
  // its own.
  readonly userId: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type DemoResponse = { readonly status: number; readonly body: unknown };

export const DEMO_TFSA_ID = 'd0000000-0000-4000-8000-000000000001';
export const DEMO_INDIVIDUAL_ID = 'd0000000-0000-4000-8000-000000000002';

export function demoConnectionId(userId: string): string {
  return `demo-${userId}`;
}

type DemoSecurity = {
  readonly id: string;
  readonly symbol: string;
  readonly rawSymbol: string;
  readonly description: string;
  readonly currency: 'CAD' | 'USD';
  readonly exchange: string | null;
  readonly typeCode: 'et' | 'cs' | 'crypto';
  readonly price: number;
};

// Fixed prices, so every demo gives the same numbers (e.g. 10 × VFV.TO = $1,524.00 CAD).
const SECURITIES: readonly DemoSecurity[] = [
  {
    id: 'd1000000-0000-4000-8000-000000000001',
    symbol: 'VFV.TO',
    rawSymbol: 'VFV',
    description: 'Vanguard S&P 500 Index ETF (demo)',
    currency: 'CAD',
    exchange: 'TSX',
    typeCode: 'et',
    price: 152.4,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000002',
    symbol: 'XEQT.TO',
    rawSymbol: 'XEQT',
    description: 'iShares Core Equity ETF Portfolio (demo)',
    currency: 'CAD',
    exchange: 'TSX',
    typeCode: 'et',
    price: 32.1,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000003',
    symbol: 'SHOP.TO',
    rawSymbol: 'SHOP',
    description: 'Shopify Inc. (demo)',
    currency: 'CAD',
    exchange: 'TSX',
    typeCode: 'cs',
    price: 98.5,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000004',
    symbol: 'AAPL',
    rawSymbol: 'AAPL',
    description: 'Apple Inc. (demo)',
    currency: 'USD',
    exchange: 'NASDAQ',
    typeCode: 'cs',
    price: 230,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000005',
    symbol: 'VOO',
    rawSymbol: 'VOO',
    description: 'Vanguard S&P 500 ETF (demo)',
    currency: 'USD',
    exchange: 'NYSE',
    typeCode: 'et',
    price: 520,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000006',
    symbol: 'BTC',
    rawSymbol: 'BTC',
    description: 'Bitcoin (demo)',
    currency: 'CAD',
    exchange: null,
    typeCode: 'crypto',
    price: 90000,
  },
];

const TYPE_DESCRIPTIONS = { et: 'ETF', cs: 'Common Stock', crypto: 'Crypto' } as const;

// Holdings of the Demo TFSA: 2 × VFV.TO and 3 × XEQT.TO.
const TFSA_HOLDINGS = [
  { symbol: 'VFV.TO', units: '2' },
  { symbol: 'XEQT.TO', units: '3' },
] as const;

function connections(userId: string) {
  return [
    {
      id: demoConnectionId(userId),
      brokerage: { name: 'Demo Brokerage', slug: 'DEMO' },
      name: 'Demo connection',
      type: 'read',
      disabled: false,
      disabled_date: null,
    },
  ];
}

function accounts(userId: string) {
  const common = {
    brokerage_authorization: demoConnectionId(userId),
    institution_name: 'Demo Brokerage',
    account_category: 'INVESTMENT',
    // Simulated accounts, never real money.
    is_paper: true,
    status: 'open',
  };
  return [
    { ...common, id: DEMO_TFSA_ID, name: 'Demo TFSA', number: 'DEMO0001234', raw_type: 'TFSA' },
    {
      ...common,
      id: DEMO_INDIVIDUAL_ID,
      name: 'Demo Individual',
      number: 'DEMO0005678',
      raw_type: 'Individual',
    },
  ];
}

function universalSymbol(security: DemoSecurity) {
  return {
    id: security.id,
    symbol: security.symbol,
    raw_symbol: security.rawSymbol,
    description: security.description,
    currency: { id: security.currency, code: security.currency, name: security.currency },
    exchange: security.exchange === null ? null : { code: security.exchange },
    type: { code: security.typeCode, description: TYPE_DESCRIPTIONS[security.typeCode] },
  };
}

function positions(accountId: string) {
  if (accountId !== DEMO_TFSA_ID) {
    return { results: [] };
  }
  const results = TFSA_HOLDINGS.flatMap((holding) => {
    const security = SECURITIES.find((candidate) => candidate.symbol === holding.symbol);
    return security === undefined
      ? []
      : [
          {
            instrument: {
              kind: 'etf',
              symbol: security.symbol,
              raw_symbol: security.rawSymbol,
              description: security.description,
              currency: security.currency,
            },
            units: holding.units,
            price: security.price.toFixed(2),
            currency: security.currency,
          },
        ];
  });
  return { results };
}

function balances(accountId: string) {
  return accountId === DEMO_TFSA_ID
    ? [{ currency: { code: 'CAD' }, cash: 1000, buying_power: 1000 }]
    : [{ currency: { code: 'USD' }, cash: 2500, buying_power: 2500 }];
}

function searchSymbols(body: unknown) {
  const substring =
    typeof body === 'object' && body !== null && 'substring' in body
      ? String(body.substring).toUpperCase()
      : '';
  return SECURITIES.filter(
    (security) => security.symbol.includes(substring) || security.rawSymbol.includes(substring),
  ).map(universalSymbol);
}

function quotes(query: Readonly<Record<string, string>>) {
  const ids = (query.symbols ?? '').split(',');
  return SECURITIES.filter((security) => ids.includes(security.id)).map((security) => ({
    symbol: universalSymbol(security),
    last_trade_price: security.price,
    bid_price: security.price,
    ask_price: security.price,
  }));
}

const ACCOUNT_PATH = /^\/accounts\/([^/]+)\/(positions\/all|balances|symbols|quotes)$/;
const NOT_FOUND: DemoResponse = { status: 404, body: { detail: 'Not found in the demo' } };

function accountRequest(request: DemoRequest, accountId: string, resource: string): DemoResponse {
  if (accountId !== DEMO_TFSA_ID && accountId !== DEMO_INDIVIDUAL_ID) {
    return NOT_FOUND;
  }
  if (request.method === 'GET' && resource === 'positions/all') {
    return { status: 200, body: positions(accountId) };
  }
  if (request.method === 'GET' && resource === 'balances') {
    return { status: 200, body: balances(accountId) };
  }
  if (request.method === 'POST' && resource === 'symbols') {
    return { status: 200, body: searchSymbols(request.body) };
  }
  if (request.method === 'GET' && resource === 'quotes') {
    return { status: 200, body: quotes(request.query) };
  }
  return NOT_FOUND;
}

// Anything else, including every /trade/* path, is "not found": a demo user can never trade.
export function handleDemoRequest(request: DemoRequest): DemoResponse {
  if (request.method === 'GET' && request.path === '/authorizations') {
    return { status: 200, body: connections(request.userId) };
  }
  if (request.method === 'GET' && request.path === '/accounts') {
    return { status: 200, body: accounts(request.userId) };
  }
  const match = ACCOUNT_PATH.exec(request.path);
  if (match?.[1] === undefined || match[2] === undefined) {
    return NOT_FOUND;
  }
  return accountRequest(request, decodeURIComponent(match[1]), match[2]);
}

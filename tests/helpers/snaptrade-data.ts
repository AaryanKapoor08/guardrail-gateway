// Builders for SnapTrade-shaped JSON (field names from SnapTrade's API reference), used by the
// fake SnapTrade. Only fields our schemas read matter; a few extra ones keep the shape realistic.

export const SANDBOX_CONNECTION_ID = '87b24961-b51e-4db8-9226-f198f6518a89';
export const TFSA_ACCOUNT_ID = '917c8734-8470-4a3e-a18f-57c3f2ee6631';
export const MARGIN_ACCOUNT_ID = '2bcd7cc3-e922-4976-bce1-9858296801c3';

export type FakeConnection = {
  id: string;
  brokerage: { name: string; slug: string };
  name: string;
  type: string;
  disabled: boolean;
  disabled_date: string | null;
};

export type FakeAccount = {
  id: string;
  brokerage_authorization: string;
  name: string | null;
  number: string;
  institution_name: string;
  raw_type: string | null;
  account_category: string | null;
  is_paper: boolean;
  status: string | null;
  balance: { total: { amount: number; currency: string } };
};

export function buildConnection(overrides: Partial<FakeConnection> = {}): FakeConnection {
  return {
    id: SANDBOX_CONNECTION_ID,
    brokerage: { name: 'SnapTrade Sandbox', slug: 'SANDBOX' },
    name: 'Connection-1',
    type: 'read',
    disabled: false,
    disabled_date: null,
    ...overrides,
  };
}

export function buildAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    id: TFSA_ACCOUNT_ID,
    brokerage_authorization: SANDBOX_CONNECTION_ID,
    name: 'Sandbox TFSA',
    number: 'Q6542138443',
    institution_name: 'SnapTrade Sandbox',
    raw_type: 'TFSA',
    account_category: 'INVESTMENT',
    is_paper: false,
    status: 'open',
    balance: { total: { amount: 1000, currency: 'CAD' } },
    ...overrides,
  };
}

export type FakeBrokerage = {
  connections: FakeConnection[];
  accounts: FakeAccount[];
  // SnapTrade account id -> holdings / balances. Missing = empty.
  positions: Record<string, FakePosition[]>;
  balances: Record<
    string,
    { currency: string; cash: number | null; buying_power: number | null }[]
  >;
  symbols: FakeSymbol[];
  // universal symbol id -> quote. Missing = SnapTrade returns no quote for it.
  quotes: Record<string, FakeQuote>;
};

// One read-only Sandbox connection with a TFSA and a margin account.
export function buildDefaultBrokerage(): FakeBrokerage {
  return {
    connections: [buildConnection()],
    accounts: [
      buildAccount(),
      buildAccount({
        id: MARGIN_ACCOUNT_ID,
        name: 'Sandbox Margin',
        number: 'M0000009876',
        raw_type: 'Margin',
      }),
    ],
    positions: { [TFSA_ACCOUNT_ID]: [buildPosition()] },
    balances: { [TFSA_ACCOUNT_ID]: [{ currency: 'CAD', cash: 500.25, buying_power: 500.25 }] },
    symbols: buildDefaultSymbols(),
    quotes: buildDefaultQuotes(),
  };
}

// ---- Securities, holdings, balances, quotes (P8) ----

export const VFV_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f01';
export const XEQT_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f02';
export const SHOP_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f03';
export const AAPL_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f04';
export const BTC_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f05';
export const ABC_TO_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f06';
export const ABC_US_ID = '5c1a7e6d-0d31-4f0e-9b7d-4c3a2b1a0f07';

export type FakeSymbol = {
  id: string;
  symbol: string;
  raw_symbol: string;
  description: string | null;
  currency: { id: string; code: string; name: string };
  exchange: { id: string; code: string; name: string } | null;
  type: { id: string; code: string; description: string };
};

const CAD = { id: 'e0000000-0000-4000-8000-000000000001', code: 'CAD', name: 'Canadian Dollar' };
const USD = { id: 'e0000000-0000-4000-8000-000000000002', code: 'USD', name: 'US Dollar' };
const TSX = {
  id: 'e0000000-0000-4000-8000-000000000003',
  code: 'TSX',
  name: 'Toronto Stock Exchange',
};
const NASDAQ = { id: 'e0000000-0000-4000-8000-000000000004', code: 'NASDAQ', name: 'Nasdaq' };
const ETF = { id: 'e0000000-0000-4000-8000-000000000005', code: 'et', description: 'ETF' };
const STOCK = {
  id: 'e0000000-0000-4000-8000-000000000006',
  code: 'cs',
  description: 'Common Stock',
};
const CRYPTO = {
  id: 'e0000000-0000-4000-8000-000000000007',
  code: 'crypto',
  description: 'Crypto',
};

export function buildSymbol(overrides: Partial<FakeSymbol> = {}): FakeSymbol {
  return {
    id: VFV_ID,
    symbol: 'VFV.TO',
    raw_symbol: 'VFV',
    description: 'Vanguard S&P 500 Index ETF',
    currency: CAD,
    exchange: TSX,
    type: ETF,
    ...overrides,
  };
}

export function buildDefaultSymbols(): FakeSymbol[] {
  return [
    buildSymbol(),
    buildSymbol({
      id: XEQT_ID,
      symbol: 'XEQT.TO',
      raw_symbol: 'XEQT',
      description: 'iShares Core Equity ETF Portfolio',
    }),
    buildSymbol({
      id: SHOP_ID,
      symbol: 'SHOP.TO',
      raw_symbol: 'SHOP',
      description: 'Shopify Inc.',
      type: STOCK,
    }),
    buildSymbol({
      id: AAPL_ID,
      symbol: 'AAPL',
      raw_symbol: 'AAPL',
      description: 'Apple Inc.',
      currency: USD,
      exchange: NASDAQ,
      type: STOCK,
    }),
    buildSymbol({
      id: BTC_ID,
      symbol: 'BTC',
      raw_symbol: 'BTC',
      description: 'Bitcoin',
      exchange: null,
      type: CRYPTO,
    }),
    // Two listings that both match the ticker "ABC" exactly: one by symbol, one by raw symbol.
    buildSymbol({
      id: ABC_TO_ID,
      symbol: 'ABC.TO',
      raw_symbol: 'ABC',
      description: 'ABC Corp (Toronto)',
      type: STOCK,
    }),
    buildSymbol({
      id: ABC_US_ID,
      symbol: 'ABC',
      raw_symbol: 'ABC',
      description: 'ABC Corp (US)',
      currency: USD,
      exchange: NASDAQ,
      type: STOCK,
    }),
  ];
}

export type FakeQuote = { last: number | null; bid: number | null; ask: number | null };

export function buildDefaultQuotes(): Record<string, FakeQuote> {
  return {
    [VFV_ID]: { last: 152.38, bid: 152.3, ask: 152.4 },
    [XEQT_ID]: { last: 32.1, bid: 32.05, ask: 32.1 },
    [SHOP_ID]: { last: 98.5, bid: 98.4, ask: 98.5 },
    [AAPL_ID]: { last: 230, bid: 229.9, ask: 230.1 },
    [BTC_ID]: { last: 90000, bid: 89990, ask: 90010 },
    [ABC_TO_ID]: { last: 10, bid: 10, ask: 10 },
    [ABC_US_ID]: { last: 8, bid: 8, ask: 8 },
  };
}

export type FakePosition = {
  instrument: {
    kind: string;
    symbol: string;
    raw_symbol: string;
    description: string | null;
    currency: string;
  };
  units: string | null;
  price: string | null;
  currency: string | null;
  cash_equivalent: boolean;
};

export function buildPosition(overrides: Partial<FakePosition> = {}): FakePosition {
  return {
    instrument: {
      kind: 'etf',
      symbol: 'VFV.TO',
      raw_symbol: 'VFV',
      description: 'Vanguard S&P 500 Index ETF',
      currency: 'CAD',
    },
    units: '2',
    price: '152.00',
    currency: 'CAD',
    cash_equivalent: false,
    ...overrides,
  };
}

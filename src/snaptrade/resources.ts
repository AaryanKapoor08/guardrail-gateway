import { z } from 'zod';
import type { Deps } from '../deps.js';
import { decimalFromNumber } from '../lib/money.js';
import { snaptradeFetch } from './api.js';

// Typed SnapTrade calls. Each response is checked with a Zod schema that lists only the fields
// we use; fields SnapTrade documents as nullable are accepted as null (V§5.2).

function parseResponse<T>(schema: z.ZodType<T>, data: unknown, route: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Only the route goes in the message: the body may contain account numbers.
    throw new Error(`[SnapTrade] ${route} response did not have the expected shape`);
  }
  return result.data;
}

const ConnectionSchema = z.object({
  id: z.string().min(1),
  brokerage: z.object({ name: z.string().nullish() }).nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  disabled: z.boolean(),
  disabled_date: z.string().nullish(),
});

export type SnapTradeConnection = {
  readonly id: string;
  readonly brokerageName: string;
  readonly type: 'read' | 'trade';
  readonly disabled: boolean;
  readonly disabledAt: Date | null;
};

export async function listConnections(deps: Deps, userId: string): Promise<SnapTradeConnection[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: '/authorizations',
    retry: 'read',
  });
  const connections = parseResponse(z.array(ConnectionSchema), data, 'GET /authorizations');
  return connections.map((connection) => ({
    id: connection.id,
    brokerageName: connection.brokerage?.name ?? connection.name ?? 'Unknown brokerage',
    // Documented values are `read` and `trade`; anything else is treated as read-only, the
    // safer reading for the live-trading gate.
    type: connection.type === 'trade' ? 'trade' : 'read',
    disabled: connection.disabled,
    disabledAt: connection.disabled_date == null ? null : new Date(connection.disabled_date),
  }));
}

const AccountSchema = z.object({
  id: z.guid(),
  brokerage_authorization: z.string().min(1),
  name: z.string().nullish(),
  number: z.string().nullish(),
  institution_name: z.string().nullish(),
  raw_type: z.string().nullish(),
  account_category: z.string().nullish(),
  is_paper: z.boolean().nullish(),
});

export type SnapTradeAccount = {
  readonly snaptradeAccountId: string;
  readonly connectionId: string;
  readonly name: string | null;
  readonly institutionName: string | null;
  // Only the last 4 characters ever leave this module; the full number is never stored.
  readonly numberLast4: string | null;
  readonly rawType: string | null;
  readonly accountCategory: string | null;
  readonly isPaper: boolean;
};

function lastFour(number: string | null | undefined): string | null {
  const trimmed = number?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(-4);
}

export async function listAccounts(deps: Deps, userId: string): Promise<SnapTradeAccount[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: '/accounts',
    retry: 'read',
  });
  const accounts = parseResponse(z.array(AccountSchema), data, 'GET /accounts');
  return accounts.map((account) => ({
    snaptradeAccountId: account.id,
    connectionId: account.brokerage_authorization,
    name: account.name ?? null,
    institutionName: account.institution_name ?? null,
    numberLast4: lastFour(account.number),
    rawType: account.raw_type ?? null,
    accountCategory: account.account_category ?? null,
    // Unknown counts as a real-money account, so the paper-accounts-only gate stays closed.
    isPaper: account.is_paper === true,
  }));
}

// ---- Account data used by proposals and approvals (P8). Shapes from SnapTrade's API reference;
// verify against real Sandbox responses in P5 (D19).

function accountPath(snaptradeAccountId: string, rest: string): string {
  return `/accounts/${encodeURIComponent(snaptradeAccountId)}/${rest}`;
}

const PositionSchema = z.object({
  instrument: z.object({
    kind: z.string(),
    symbol: z.string().nullish(),
    raw_symbol: z.string().nullish(),
  }),
  // Decimal strings in the docs ("10.5"), nullable.
  units: z.string().nullish(),
  price: z.string().nullish(),
  currency: z.string().nullish(),
});

const PositionsResponseSchema = z.object({ results: z.array(PositionSchema) });

export type Holding = {
  readonly symbol: string;
  readonly rawSymbol: string | null;
  readonly kind: 'stock' | 'etf';
  readonly units: string;
  readonly price: string | null;
  readonly currency: string | null;
};

export type Positions = {
  readonly holdings: Holding[];
  // Options, crypto, funds and so on are only counted, never shown or traded (V§5.2).
  readonly otherCount: number;
};

const DECIMAL = /^-?\d+(\.\d+)?$/;

function toHolding(position: z.infer<typeof PositionSchema>): Holding | null {
  const { instrument, units, price } = position;
  const kind = instrument.kind;
  if (
    (kind !== 'stock' && kind !== 'etf') ||
    !instrument.symbol ||
    !units ||
    !DECIMAL.test(units)
  ) {
    return null;
  }
  return {
    symbol: instrument.symbol,
    rawSymbol: instrument.raw_symbol ?? null,
    kind,
    units,
    price: price && DECIMAL.test(price) ? price : null,
    currency: position.currency ?? null,
  };
}

export async function getPositions(
  deps: Deps,
  userId: string,
  snaptradeAccountId: string,
): Promise<Positions> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: accountPath(snaptradeAccountId, 'positions/all'),
    retry: 'read',
  });
  const { results } = parseResponse(
    PositionsResponseSchema,
    data,
    'GET /accounts/{id}/positions/all',
  );
  const holdings = results.map(toHolding).filter((holding) => holding !== null);
  return { holdings, otherCount: results.length - holdings.length };
}

const BalanceSchema = z.object({
  currency: z.object({ code: z.string() }).nullish(),
  cash: z.number().nullish(),
  buying_power: z.number().nullish(),
});

export type Balance = {
  readonly currency: string;
  readonly cash: string | null;
  readonly buyingPower: string | null;
};

function optionalDecimal(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : decimalFromNumber(value);
}

export async function getBalances(
  deps: Deps,
  userId: string,
  snaptradeAccountId: string,
): Promise<Balance[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: accountPath(snaptradeAccountId, 'balances'),
    retry: 'read',
  });
  const balances = parseResponse(z.array(BalanceSchema), data, 'GET /accounts/{id}/balances');
  return balances.flatMap((balance) =>
    balance.currency == null
      ? []
      : [
          {
            currency: balance.currency.code,
            cash: optionalDecimal(balance.cash),
            buyingPower: optionalDecimal(balance.buying_power),
          },
        ],
  );
}

const UniversalSymbolSchema = z.object({
  id: z.guid(),
  symbol: z.string().min(1),
  raw_symbol: z.string().nullish(),
  description: z.string().nullish(),
  currency: z.object({ code: z.string() }),
  exchange: z.object({ code: z.string().nullish() }).nullish(),
  type: z.object({ code: z.string() }),
});

export type SymbolMatch = {
  readonly universalSymbolId: string;
  readonly symbol: string;
  readonly rawSymbol: string | null;
  readonly description: string | null;
  readonly currency: string;
  readonly exchange: string | null;
  readonly typeCode: string;
};

// Up to 20 symbols that this account's broker supports (V§5.2).
export async function searchSymbols(
  deps: Deps,
  userId: string,
  request: { snaptradeAccountId: string; substring: string },
): Promise<SymbolMatch[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'POST',
    path: accountPath(request.snaptradeAccountId, 'symbols'),
    body: { substring: request.substring },
    // A search changes nothing at SnapTrade, so retrying it is safe.
    retry: 'read',
  });
  const symbols = parseResponse(
    z.array(UniversalSymbolSchema),
    data,
    'POST /accounts/{id}/symbols',
  );
  return symbols.map((symbol) => ({
    universalSymbolId: symbol.id,
    symbol: symbol.symbol,
    rawSymbol: symbol.raw_symbol ?? null,
    description: symbol.description ?? null,
    currency: symbol.currency.code,
    exchange: symbol.exchange?.code ?? null,
    typeCode: symbol.type.code,
  }));
}

const QuoteSchema = z.object({
  symbol: z.object({ id: z.guid() }),
  last_trade_price: z.number().nullish(),
  bid_price: z.number().nullish(),
  ask_price: z.number().nullish(),
});

export type Quote = {
  readonly universalSymbolId: string;
  readonly lastTradePrice: string | null;
  readonly bidPrice: string | null;
  readonly askPrice: string | null;
};

// Prices from SnapTrade may be delayed and must never be polled (V§5.2): we call this only when
// an order is proposed or approved.
export async function getQuotes(
  deps: Deps,
  userId: string,
  request: { snaptradeAccountId: string; universalSymbolIds: string[] },
): Promise<Quote[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: accountPath(request.snaptradeAccountId, 'quotes'),
    query: { symbols: request.universalSymbolIds.join(','), use_ticker: 'false' },
    retry: 'read',
  });
  const quotes = parseResponse(z.array(QuoteSchema), data, 'GET /accounts/{id}/quotes');
  return quotes.map((quote) => ({
    universalSymbolId: quote.symbol.id,
    lastTradePrice: optionalDecimal(quote.last_trade_price),
    bidPrice: optionalDecimal(quote.bid_price),
    askPrice: optionalDecimal(quote.ask_price),
  }));
}

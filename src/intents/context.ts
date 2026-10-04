import { and, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { DatabaseExecutor, Transaction } from '../db/client.js';
import type { LockedUser } from '../db/locks.js';
import {
  accounts,
  connections,
  orderIntents,
  paperPositions,
  snaptradeGrants,
} from '../db/schema.js';
import type { Deps } from '../deps.js';
import { add, isPositive } from '../lib/money.js';
import type { OrderType, PolicyContext, Side } from '../policy/types.js';
import { SnapTradeApiError } from '../snaptrade/api.js';
import { cachedPositions, cachedQuote } from '../snaptrade/cached.js';
import type { Holding, Quote } from '../snaptrade/resources.js';
import { syncIfStale } from '../snaptrade/sync.js';
import {
  COUNTED_STATES,
  INTENT_STATES,
  OPEN_SELL_STATES,
  TERMINAL_STATES,
} from './state-machine.js';
import type { ResolvedSecurity } from './symbols.js';

// Builds the PolicyContext in two halves (V§10.1): network reads happen first, outside any lock
// (`prefetch`); database counts happen inside the per-user lock (`countToday` and friends), so
// two decisions for one user always see each other's results.

// The live executor is not built yet (P13 skipped: SnapTrade hasn't enabled `trade`), so live
// mode is treated as switched off on the server whatever the env says.
// TODO(P13): remove once SnapTradeExecutor exists.
const LIVE_EXECUTOR_BUILT = false;

// The server-wide live switch: the env flag, and only once a live executor exists.
export function isLiveTradingOnServer(env: Env): boolean {
  return env.LIVE_TRADING_ENABLED && LIVE_EXECUTOR_BUILT;
}

const OPEN_STATES = INTENT_STATES.filter((state) => !TERMINAL_STATES.has(state));

export type Prefetched = {
  // The price the policy estimates with: the limit price for limit orders, else the market price.
  readonly price: PolicyContext['price'];
  // The fresh market price (quote, or the position price as a fallback). Paper fills use it, so
  // a limit order only fills if the market has actually reached the limit (V§10.2).
  readonly marketPrice: string | null;
  // From the broker; paper-ledger holdings are added inside the lock.
  readonly realHeldQuantity: string;
};

type PrefetchRequest = {
  readonly userId: string;
  readonly snaptradeAccountId: string;
  readonly side: Side;
  readonly orderType: OrderType;
  readonly limitPrice: string | null;
  readonly security: ResolvedSecurity;
};

function holdsSecurity(holding: Holding, security: ResolvedSecurity): boolean {
  const names = [security.symbol, security.rawSymbol].filter((name) => name !== null);
  return names.some(
    (name) =>
      holding.symbol.toUpperCase() === name.toUpperCase() ||
      holding.rawSymbol?.toUpperCase() === name.toUpperCase(),
  );
}

function heldQuantity(holdings: Holding[], security: ResolvedSecurity): string {
  return holdings
    .filter((holding) => holdsSecurity(holding, security))
    .reduce((total, holding) => add(total, holding.units), '0');
}

// Ask for buys and bid for sells (what the order would likely pay or get), else last trade.
function priceFromQuote(quote: Quote | null, side: Side): string | null {
  if (quote === null) {
    return null;
  }
  const preferred = side === 'buy' ? quote.askPrice : quote.bidPrice;
  const candidates = [preferred, quote.lastTradePrice];
  return candidates.find((price) => price !== null && isPositive(price)) ?? null;
}

// V§21 Q3: if OAuth tokens can't read quotes (403), we fall back to the position price instead
// of failing. Any other failure (5xx, network) fails the prefetch: never decide on stale data.
async function quoteOrNull(deps: Deps, request: PrefetchRequest): Promise<Quote | null> {
  try {
    return await cachedQuote(deps, request.userId, {
      snaptradeAccountId: request.snaptradeAccountId,
      universalSymbolId: request.security.universalSymbolId,
    });
  } catch (error) {
    if (error instanceof SnapTradeApiError && error.status === 403) {
      return null;
    }
    throw error;
  }
}

function positionPrice(holdings: Holding[], security: ResolvedSecurity): string | null {
  const holding = holdings.find(
    (candidate) => holdsSecurity(candidate, security) && candidate.price !== null,
  );
  return holding?.price ?? null;
}

async function marketPrice(
  deps: Deps,
  request: PrefetchRequest,
  loadHoldings: () => Promise<Holding[]>,
): Promise<PolicyContext['price']> {
  const quotePrice = priceFromQuote(await quoteOrNull(deps, request), request.side);
  if (quotePrice !== null) {
    return { value: quotePrice, source: 'quote', asOf: deps.now() };
  }
  const fallback = positionPrice(await loadHoldings(), request.security);
  return fallback === null ? null : { value: fallback, source: 'position', asOf: deps.now() };
}

export async function prefetch(deps: Deps, request: PrefetchRequest): Promise<Prefetched> {
  // Connection state older than 5 minutes is refreshed before deciding (V§12.3).
  await syncIfStale(deps, request.userId);
  // The positions cache shares one in-flight load, so asking twice costs one SnapTrade call.
  const loadHoldings = async () =>
    (await cachedPositions(deps, request.userId, request.snaptradeAccountId)).holdings;
  const [market, holdings] = await Promise.all([
    marketPrice(deps, request, loadHoldings),
    request.side === 'sell' ? loadHoldings() : Promise.resolve([]),
  ]);
  const price: PolicyContext['price'] =
    request.orderType === 'limit' && request.limitPrice !== null
      ? { value: request.limitPrice, source: 'limit', asOf: null }
      : market;
  return {
    price,
    marketPrice: market?.value ?? null,
    realHeldQuantity: heldQuantity(holdings, request.security),
  };
}

export type DecisionAccount = {
  readonly ref: string;
  readonly snaptradeAccountId: string;
  readonly allowed: boolean;
  readonly present: boolean;
  readonly isPaper: boolean;
  readonly connectionDisabled: boolean | null;
  readonly connectionType: 'read' | 'trade' | null;
};

export async function loadDecisionAccount(
  db: DatabaseExecutor,
  userId: string,
  accountRef: string,
): Promise<DecisionAccount | null> {
  const [account] = await db
    .select({
      ref: accounts.id,
      snaptradeAccountId: accounts.snaptradeAccountId,
      allowed: accounts.allowed,
      present: accounts.present,
      isPaper: accounts.isPaper,
      connectionDisabled: connections.disabled,
      connectionType: connections.type,
    })
    .from(accounts)
    .leftJoin(connections, eq(connections.id, accounts.connectionId))
    .where(and(eq(accounts.id, accountRef), eq(accounts.userId, userId)));
  return account ?? null;
}

export type DbCounts = {
  readonly todayCountedValue: string;
  readonly todayCountedOrders: number;
  readonly openSellQuantity: string;
  readonly paperHeldQuantity: string;
  readonly hasOpenIntents: boolean;
};

type CountRequest = {
  readonly userId: string;
  readonly now: Date;
  readonly policyCurrency: string;
  readonly accountRef: string;
  readonly symbol: string;
  readonly excludeIntentId?: string | undefined;
};

function excluding(excludeIntentId: string | undefined): SQL | undefined {
  return excludeIntentId === undefined ? undefined : ne(orderIntents.id, excludeIntentId);
}

export type TodayTotals = { readonly value: string; readonly orders: number };

// "Today" is the calendar day in Toronto, compared against the injected clock, never SQL now()
// (V§8.3). Pending intents count, so they reserve budget. Also used by get_policy to report
// what is left of today's limits.
export async function countToday(
  db: DatabaseExecutor,
  request: Pick<CountRequest, 'userId' | 'now' | 'policyCurrency' | 'excludeIntentId'>,
): Promise<TodayTotals> {
  const nowIso = request.now.toISOString();
  const [row] = await db
    .select({
      value: sql<string>`coalesce(sum(${orderIntents.estValue}) filter (where ${orderIntents.currency} = ${request.policyCurrency}), 0)::text`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orderIntents)
    .where(
      and(
        eq(orderIntents.userId, request.userId),
        inArray(orderIntents.status, [...COUNTED_STATES]),
        sql`(${orderIntents.createdAt} at time zone 'America/Toronto')::date = (${nowIso}::timestamptz at time zone 'America/Toronto')::date`,
        excluding(request.excludeIntentId),
      ),
    );
  return { value: row?.value ?? '0', orders: row?.orders ?? 0 };
}

async function countOpenSells(tx: Transaction, request: CountRequest): Promise<string> {
  const [row] = await tx
    .select({ quantity: sql<string>`coalesce(sum(${orderIntents.quantity}), 0)::text` })
    .from(orderIntents)
    .where(
      and(
        eq(orderIntents.userId, request.userId),
        eq(orderIntents.accountId, request.accountRef),
        eq(orderIntents.symbol, request.symbol),
        eq(orderIntents.side, 'sell'),
        inArray(orderIntents.status, [...OPEN_SELL_STATES]),
        excluding(request.excludeIntentId),
      ),
    );
  return row?.quantity ?? '0';
}

async function paperHeld(tx: Transaction, request: CountRequest): Promise<string> {
  const [row] = await tx
    .select({ quantity: paperPositions.quantity })
    .from(paperPositions)
    .where(
      and(
        eq(paperPositions.userId, request.userId),
        eq(paperPositions.accountId, request.accountRef),
        eq(paperPositions.symbol, request.symbol),
      ),
    );
  return row?.quantity ?? '0';
}

export async function hasOpenIntents(db: DatabaseExecutor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: orderIntents.id })
    .from(orderIntents)
    .where(and(eq(orderIntents.userId, userId), inArray(orderIntents.status, OPEN_STATES)))
    .limit(1);
  return row !== undefined;
}

// Must run inside the transaction that holds the user's row lock.
export async function dbCounts(tx: Transaction, request: CountRequest): Promise<DbCounts> {
  const today = await countToday(tx, request);
  return {
    todayCountedValue: today.value,
    todayCountedOrders: today.orders,
    openSellQuantity: await countOpenSells(tx, request),
    paperHeldQuantity: await paperHeld(tx, request),
    hasOpenIntents: await hasOpenIntents(tx, request.userId),
  };
}

export async function grantHasTradeScope(db: DatabaseExecutor, userId: string): Promise<boolean> {
  const [grant] = await db
    .select({ scope: snaptradeGrants.scope })
    .from(snaptradeGrants)
    .where(eq(snaptradeGrants.userId, userId));
  return grant?.scope.split(' ').includes('trade') ?? false;
}

export function buildPolicyContext(input: {
  env: Env;
  user: LockedUser;
  account: DecisionAccount | null;
  hasTradeScope: boolean;
  security: ResolvedSecurity;
  prefetched: Prefetched;
  counts: DbCounts;
}): PolicyContext {
  const { account, counts, user } = input;
  // In paper mode, simulated fills count as holdings too (V§8.2 rule 6).
  const paperHeldQuantity = user.mode === 'paper' ? counts.paperHeldQuantity : '0';
  return {
    killSwitch: user.killSwitch,
    userMode: user.mode,
    isDemoUser: user.isDemo,
    account:
      account === null
        ? null
        : { allowed: account.allowed, present: account.present, isPaper: account.isPaper },
    connection:
      account?.connectionDisabled == null || account.connectionType === null
        ? null
        : { disabled: account.connectionDisabled, type: account.connectionType },
    grantHasTradeScope: input.hasTradeScope,
    liveEnabled: isLiveTradingOnServer(input.env),
    livePaperOnly: input.env.LIVE_TRADING_PAPER_ACCOUNTS_ONLY,
    security: {
      symbol: input.security.symbol,
      typeCode: input.security.typeCode,
      currency: input.security.currency,
    },
    price: input.prefetched.price,
    heldQuantity: add(input.prefetched.realHeldQuantity, paperHeldQuantity),
    openSellQuantity: counts.openSellQuantity,
    todayCountedValue: counts.todayCountedValue,
    todayCountedOrders: counts.todayCountedOrders,
    hasOpenIntents: counts.hasOpenIntents,
  };
}

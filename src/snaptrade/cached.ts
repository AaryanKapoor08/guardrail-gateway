import type { Deps } from '../deps.js';
import {
  type Balance,
  getBalances,
  getPositions,
  getQuotes,
  type Positions,
  type Quote,
  type SymbolMatch,
  searchSymbols,
} from './resources.js';

// SnapTrade reads through the short-lived caches of V§12.3, which protect the 10 requests per
// minute per-account budget. Keys always start with the user id, so one user's entries can be
// dropped together (webhooks).

export const POSITIONS_TTL_MS = 60 * 1000;
export const SYMBOL_SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
export const QUOTE_TTL_MS = 15 * 1000;

export function cachedPositions(
  deps: Deps,
  userId: string,
  snaptradeAccountId: string,
): Promise<Positions> {
  return deps.caches.positions.getOrLoad(`${userId}:${snaptradeAccountId}`, () =>
    getPositions(deps, userId, snaptradeAccountId),
  );
}

export function cachedBalances(
  deps: Deps,
  userId: string,
  snaptradeAccountId: string,
): Promise<Balance[]> {
  return deps.caches.balances.getOrLoad(`${userId}:${snaptradeAccountId}`, () =>
    getBalances(deps, userId, snaptradeAccountId),
  );
}

export function cachedSymbolSearch(
  deps: Deps,
  userId: string,
  request: { snaptradeAccountId: string; ticker: string },
): Promise<SymbolMatch[]> {
  const key = `${userId}:${request.snaptradeAccountId}:${request.ticker}`;
  return deps.caches.symbolSearches.getOrLoad(key, () =>
    searchSymbols(deps, userId, {
      snaptradeAccountId: request.snaptradeAccountId,
      substring: request.ticker,
    }),
  );
}

// One security's quote, or null if SnapTrade returned none for it.
export function cachedQuote(
  deps: Deps,
  userId: string,
  request: { snaptradeAccountId: string; universalSymbolId: string },
): Promise<Quote | null> {
  const key = `${userId}:${request.snaptradeAccountId}:${request.universalSymbolId}`;
  return deps.caches.quotes.getOrLoad(key, async () => {
    const quotes = await getQuotes(deps, userId, {
      snaptradeAccountId: request.snaptradeAccountId,
      universalSymbolIds: [request.universalSymbolId],
    });
    return quotes.find((quote) => quote.universalSymbolId === request.universalSymbolId) ?? null;
  });
}

// Drops the user's cached holdings and cash after SnapTrade says they changed
// (ACCOUNT_HOLDINGS_UPDATED webhook), so the next read fetches fresh data.
export function forgetHoldings(deps: Deps, userId: string): void {
  const isUsers = (key: string) => key.startsWith(`${userId}:`);
  deps.caches.positions.deleteWhere(isUsers);
  deps.caches.balances.deleteWhere(isUsers);
}

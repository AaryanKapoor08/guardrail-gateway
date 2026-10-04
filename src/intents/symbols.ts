import type { Deps } from '../deps.js';
import { SYMBOL_PATTERN } from '../policy/schema.js';
import { cachedSymbolSearch } from '../snaptrade/cached.js';
import type { SymbolMatch } from '../snaptrade/resources.js';

// Turns the ticker the AI typed into exactly one security that this account's broker supports
// (V§8.3). Unknown or ambiguous is an input problem for the AI to fix, not a policy decision.

export type ResolvedSecurity = SymbolMatch;

export type SymbolResolution =
  | { readonly ok: true; readonly security: ResolvedSecurity }
  | { readonly ok: false; readonly reason: string; readonly candidates: string[] };

const MAX_CANDIDATES = 5;

function isExactMatch(match: SymbolMatch, ticker: string): boolean {
  return match.symbol.toUpperCase() === ticker || match.rawSymbol?.toUpperCase() === ticker;
}

export async function resolveSymbol(
  deps: Deps,
  userId: string,
  request: { snaptradeAccountId: string; ticker: string },
): Promise<SymbolResolution> {
  const ticker = request.ticker.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(ticker)) {
    return {
      ok: false,
      reason: 'A symbol is 1 to 20 letters, digits, dots, or dashes, like VFV.TO or AAPL.',
      candidates: [],
    };
  }
  const matches = await cachedSymbolSearch(deps, userId, {
    snaptradeAccountId: request.snaptradeAccountId,
    ticker,
  });
  const exact = matches.filter((match) => isExactMatch(match, ticker));
  const [only] = exact;
  if (exact.length === 1 && only !== undefined) {
    return { ok: true, security: only };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      reason: `Ambiguous symbol ${ticker}: this account's broker lists more than one. Use the exact symbol.`,
      candidates: exact.slice(0, MAX_CANDIDATES).map((match) => match.symbol),
    };
  }
  return {
    ok: false,
    reason: `Unknown symbol for this account: ${ticker}.`,
    candidates: matches.slice(0, MAX_CANDIDATES).map((match) => match.symbol),
  };
}

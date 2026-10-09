import { and, eq } from 'drizzle-orm';
import { loadDotEnvFileIfPresent, loadEnv } from '../src/config/env.js';
import { accounts } from '../src/db/schema.js';
import { createDeps, type Deps } from '../src/deps.js';
import { type SnapTradeRequest, snaptradeFetch } from '../src/snaptrade/api.js';

// P5 capability spike: calls the REAL SnapTrade API as one signed-in user and prints response
// SHAPES only (keys, types, and a few safe sample values), plus the outcome of each call.
// Manual only, never in CI. It changes nothing at SnapTrade (reads and a symbol search).
// Run: npx tsx scripts/spike.ts <userId> [snaptradeAccountId]

// Values safe to show: tickers, exchange and currency codes, security types. Everything else
// (ids, account numbers, names, amounts) is replaced by its type.
const SHOWN_KEYS = new Set(['symbol', 'raw_symbol', 'code', 'mic_code', 'raw_type', 'status']);
const MAX_ARRAY_ITEMS = 2;

function describeShape(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => describeShape(item, key));
    return value.length > MAX_ARRAY_ITEMS ? [...items, `…${value.length} items`] : items;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, describeShape(child, childKey)]),
    );
  }
  if (typeof value === 'string' && SHOWN_KEYS.has(key)) {
    return value;
  }
  return value === null ? 'null' : typeof value;
}

async function probe(
  deps: Deps,
  userId: string,
  label: string,
  request: SnapTradeRequest,
): Promise<unknown> {
  try {
    const body = await snaptradeFetch(deps, userId, request);
    console.log(`\n## ${label}: OK`);
    console.log(JSON.stringify(describeShape(body), null, 2));
    return body;
  } catch (error) {
    const status = (error as { status?: unknown }).status ?? 'no response';
    console.log(`\n## ${label}: FAILED (status ${String(status)})`);
    return undefined;
  }
}

function firstSymbolId(searchResult: unknown): string | undefined {
  if (!Array.isArray(searchResult)) {
    return undefined;
  }
  const first: unknown = searchResult[0];
  if (first === null || typeof first !== 'object' || !('id' in first)) {
    return undefined;
  }
  return typeof first.id === 'string' ? first.id : undefined;
}

async function pickAccountId(deps: Deps, userId: string): Promise<string | undefined> {
  const [row] = await deps.db
    .select({ snaptradeAccountId: accounts.snaptradeAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.present, true)))
    .limit(1);
  return row?.snaptradeAccountId;
}

async function runSpike(deps: Deps, userId: string, chosenAccountId?: string): Promise<void> {
  await probe(deps, userId, 'GET /authorizations', {
    method: 'GET',
    path: '/authorizations',
    retry: 'read',
  });
  await probe(deps, userId, 'GET /accounts', { method: 'GET', path: '/accounts', retry: 'read' });
  const accountId = chosenAccountId ?? (await pickAccountId(deps, userId));
  if (accountId === undefined) {
    console.log('\nNo synced account for this user: open the dashboard once, then rerun.');
    return;
  }
  const base = `/accounts/${encodeURIComponent(accountId)}`;
  await probe(deps, userId, 'GET /accounts/{id}/positions/all', {
    method: 'GET',
    path: `${base}/positions/all`,
    retry: 'read',
  });
  await probe(deps, userId, 'GET /accounts/{id}/balances', {
    method: 'GET',
    path: `${base}/balances`,
    retry: 'read',
  });
  const symbolIds: string[] = [];
  for (const substring of ['VFV', 'AAPL']) {
    const found = await probe(deps, userId, `POST /accounts/{id}/symbols "${substring}"`, {
      method: 'POST',
      path: `${base}/symbols`,
      body: { substring },
      retry: 'read',
    });
    const id = firstSymbolId(found);
    if (id !== undefined) {
      symbolIds.push(id);
    }
  }
  if (symbolIds.length === 0) {
    console.log('\nNo symbol ids found, so quotes were not tried.');
    return;
  }
  await probe(deps, userId, 'GET /accounts/{id}/quotes', {
    method: 'GET',
    path: `${base}/quotes`,
    query: { symbols: symbolIds.join(','), use_ticker: 'false' },
    retry: 'read',
  });
}

async function main(): Promise<void> {
  const [userId, accountId] = process.argv.slice(2);
  if (userId === undefined) {
    console.log('Usage: npx tsx scripts/spike.ts <userId> [snaptradeAccountId]');
    process.exit(1);
  }
  loadDotEnvFileIfPresent();
  const deps = createDeps(loadEnv());
  try {
    await runSpike(deps, userId, accountId);
  } finally {
    await deps.pool.end();
  }
}

await main();

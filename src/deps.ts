import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createRateLimiter, type RateLimiter } from './lib/ratelimit.js';
import { CLIENT_METADATA_MAX_TTL_MS, type ClientMetadata } from './oauth-server/cimd.js';
import { createTtlCache, type TtlCache } from './snaptrade/cache.js';
import { POSITIONS_TTL_MS, QUOTE_TTL_MS, SYMBOL_SEARCH_TTL_MS } from './snaptrade/cached.js';
import { METADATA_TTL_MS, type SnapTradeMetadata } from './snaptrade/discovery.js';
import type { Balance, Positions, Quote, SymbolMatch } from './snaptrade/resources.js';
import { ACCOUNT_SYNC_TTL_MS } from './snaptrade/sync.js';

export type Caches = {
  readonly snaptradeMetadata: TtlCache<'metadata', SnapTradeMetadata>;
  // user id -> synced recently. Present means "connections and accounts are fresh enough".
  readonly accountSyncs: TtlCache<string, true>;
  // Keys start with the user id (see snaptrade/cached.ts).
  readonly positions: TtlCache<string, Positions>;
  readonly balances: TtlCache<string, Balance[]>;
  readonly symbolSearches: TtlCache<string, SymbolMatch[]>;
  readonly quotes: TtlCache<string, Quote | null>;
  // client_id URL -> the AI app's metadata document (CIMD), kept per its own max-age.
  readonly clientMetadata: TtlCache<string, ClientMetadata>;
};

export type Limiters = {
  // Per IP address, on /login and /oauth/* (V§13).
  readonly signInPerIp: RateLimiter;
  // Per user, on MCP tool calls: 60 a minute overall, 10 proposals a minute (V§11.1).
  readonly toolCallsPerUser: RateLimiter;
  readonly proposalsPerUser: RateLimiter;
};

// Returns the key set used to check SnapTrade's id_token signatures. Production downloads
// SnapTrade's JWKS (jose caches it and refetches on an unknown key id); tests use local keys.
export type IdTokenKeySource = (jwksUri: string) => JWTVerifyGetKey;

// Everything with side effects (database, network, clock, logs) is created here once and passed
// in, so tests can swap in a test database, a fake SnapTrade `fetch`, and a controllable clock.
export type Deps = {
  readonly env: Env;
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly logger: Logger;
  readonly caches: Caches;
  readonly limiters: Limiters;
  readonly idTokenKeys: IdTokenKeySource;
};

export function createCaches(now: () => Date): Caches {
  return {
    snaptradeMetadata: createTtlCache({ ttlMs: METADATA_TTL_MS, now }),
    accountSyncs: createTtlCache({ ttlMs: ACCOUNT_SYNC_TTL_MS, now }),
    positions: createTtlCache({ ttlMs: POSITIONS_TTL_MS, now }),
    balances: createTtlCache({ ttlMs: POSITIONS_TTL_MS, now }),
    symbolSearches: createTtlCache({ ttlMs: SYMBOL_SEARCH_TTL_MS, now }),
    quotes: createTtlCache({ ttlMs: QUOTE_TTL_MS, now }),
    clientMetadata: createTtlCache({ ttlMs: CLIENT_METADATA_MAX_TTL_MS, now }),
  };
}

const ONE_MINUTE_MS = 60_000;

export function createLimiters(now: () => Date): Limiters {
  return {
    signInPerIp: createRateLimiter({ limit: 30, windowMs: ONE_MINUTE_MS, now }),
    toolCallsPerUser: createRateLimiter({ limit: 60, windowMs: ONE_MINUTE_MS, now }),
    proposalsPerUser: createRateLimiter({ limit: 10, windowMs: ONE_MINUTE_MS, now }),
  };
}

// One remote key set per URL, created on first use and reused, so its cache survives requests.
function createRemoteKeySource(): IdTokenKeySource {
  const keySets = new Map<string, JWTVerifyGetKey>();
  return (jwksUri) => {
    const existing = keySets.get(jwksUri);
    if (existing !== undefined) {
      return existing;
    }
    const keySet = createRemoteJWKSet(new URL(jwksUri));
    keySets.set(jwksUri, keySet);
    return keySet;
  };
}

export function createDeps(env: Env): Deps {
  const logger = createLogger(env.LOG_LEVEL);
  const { pool, db } = createDb(env.DATABASE_URL);
  // An idle client can lose its connection (e.g. Neon scaling to zero). Without a listener,
  // pg's 'error' event would crash the process; the pool replaces the client on next use.
  pool.on('error', (error) => logger.logError('[Db] idle client error', error));
  const now = (): Date => new Date();
  return {
    env,
    db,
    pool,
    fetch: globalThis.fetch,
    now,
    logger,
    caches: createCaches(now),
    limiters: createLimiters(now),
    idTokenKeys: createRemoteKeySource(),
  };
}

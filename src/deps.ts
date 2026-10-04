import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createTtlCache, type TtlCache } from './snaptrade/cache.js';
import { METADATA_TTL_MS, type SnapTradeMetadata } from './snaptrade/discovery.js';

export type Caches = {
  readonly snaptradeMetadata: TtlCache<'metadata', SnapTradeMetadata>;
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
  readonly idTokenKeys: IdTokenKeySource;
};

export function createCaches(now: () => Date): Caches {
  return {
    snaptradeMetadata: createTtlCache({ ttlMs: METADATA_TTL_MS, now }),
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
    idTokenKeys: createRemoteKeySource(),
  };
}

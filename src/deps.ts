import type pg from 'pg';
import type { Env } from './config/env.js';
import { createDb, type Database } from './db/client.js';
import { createLogger, type Logger } from './lib/logger.js';

// Everything with side effects (database, network, clock, logs) is created here once and passed
// in, so tests can swap in a test database, a fake SnapTrade `fetch`, and a controllable clock.
export type Deps = {
  readonly env: Env;
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly logger: Logger;
};

export function createDeps(env: Env): Deps {
  const logger = createLogger(env.LOG_LEVEL);
  const { pool, db } = createDb(env.DATABASE_URL);
  // An idle client can lose its connection (e.g. Neon scaling to zero). Without a listener,
  // pg's 'error' event would crash the process; the pool replaces the client on next use.
  pool.on('error', (error) => logger.logError('[Db] idle client error', error));
  return {
    env,
    db,
    pool,
    fetch: globalThis.fetch,
    now: () => new Date(),
    logger,
  };
}

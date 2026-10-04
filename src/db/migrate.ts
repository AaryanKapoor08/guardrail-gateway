import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { z } from 'zod';
import { loadDotEnvFileIfPresent } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { createDb, type Database } from './client.js';

// Resolved from the repo root, not from dist/: `tsc` doesn't copy .sql files into dist/, and
// every place that runs migrations (dev, CI, Render's start command) runs from the repo root.
export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'src/db/migrations');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

async function countAppliedMigrations(pool: pg.Pool): Promise<number> {
  const table = await pool.query<{ name: string | null }>(
    "select to_regclass('drizzle.__drizzle_migrations')::text as name",
  );
  if (table.rows[0]?.name == null) {
    return 0;
  }
  const result = await pool.query<{ count: number }>(
    'select count(*)::int as count from drizzle.__drizzle_migrations',
  );
  return result.rows[0]?.count ?? 0;
}

const migrateEnvSchema = z.object({
  MIGRATE_TARGET: z.enum(['test']).optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  TEST_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
});

// Only the database URL is needed here, so migrations can run without the full app config.
function chooseDatabaseUrl(): string {
  const parsed = migrateEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('[Migrate] MIGRATE_TARGET, DATABASE_URL or TEST_DATABASE_URL is invalid');
  }
  const { MIGRATE_TARGET, DATABASE_URL, TEST_DATABASE_URL } = parsed.data;
  const url = MIGRATE_TARGET === 'test' ? TEST_DATABASE_URL : DATABASE_URL;
  if (url === undefined) {
    const name = MIGRATE_TARGET === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
    throw new Error(`[Migrate] ${name} is missing`);
  }
  return url;
}

async function main(): Promise<void> {
  const logger = createLogger('info');
  loadDotEnvFileIfPresent();
  const { pool, db } = createDb(chooseDatabaseUrl());
  try {
    const before = await countAppliedMigrations(pool);
    await runMigrations(db);
    const after = await countAppliedMigrations(pool);
    logger.info('Migrations complete', { event: 'migrate', count: after - before });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    createLogger('info').logError('[Migrate] migration failed', error);
    process.exit(1);
  });
}

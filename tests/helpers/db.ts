import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { createDb, type Database, type DatabaseConnection } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrl } from './env.js';

// Every table in the schema, found automatically so a new table is never left out of cleanup.
export const ALL_TABLE_NAMES: readonly string[] = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table));

// Migrations are idempotent, so each test file can call this; only the first run applies them.
export async function setupTestDb(): Promise<DatabaseConnection> {
  const connection = createDb(testDatabaseUrl());
  await runMigrations(connection.db);
  return connection;
}

// TRUNCATE doesn't fire row-level triggers, so the audit guard doesn't block test cleanup.
// The app itself never uses TRUNCATE.
export async function truncateAll(db: Database): Promise<void> {
  const tableList = ALL_TABLE_NAMES.map((name) => `"${name}"`).join(', ');
  await db.execute(sql.raw(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`));
}

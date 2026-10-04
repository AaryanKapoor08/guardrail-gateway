import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;

// The `tx` handed to `db.transaction(async (tx) => …)`.
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Helpers that may run inside or outside a transaction accept either.
export type DatabaseExecutor = Database | Transaction;

export type DatabaseConnection = {
  readonly pool: pg.Pool;
  readonly db: Database;
};

// SSL settings come from the connection string itself (`sslmode=verify-full` for Neon,
// none for the local Docker test database), so one function serves every environment.
// A small pool suits Neon's free plan and a single server instance.
export function createDb(url: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const db = drizzle({ client: pool });
  return { pool, db };
}

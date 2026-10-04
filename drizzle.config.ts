import { defineConfig } from 'drizzle-kit';

// Only used to generate migration files (`npm run db:generate`), which needs no database
// connection. Migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});

import { asc, eq } from 'drizzle-orm';
import { auditEvents } from '../src/db/schema.js';
import { approveIntent } from '../src/intents/decisions.js';
import { buildTestApp, signInTestUser } from '../tests/helpers/app.js';
import { setupTestDb, truncateAll } from '../tests/helpers/db.js';
import { allowAccount, expectIntent, proposeTestOrder } from '../tests/helpers/intents.js';

// The whole propose → approve → paper fill flow without any AI (P8 checkpoint), run in-process
// against the Docker TEST database and the fake SnapTrade. It never calls the real SnapTrade.
// Run: npm run db:test:up && npx tsx scripts/demo-flow.ts
// Warning: it empties the test database first.

async function runDemoFlow(): Promise<void> {
  const connection = await setupTestDb();
  try {
    await truncateAll(connection.db);
    const testApp = await buildTestApp(connection);
    const user = await signInTestUser(testApp);
    const accountRef = await allowAccount(testApp, user.userId);

    const proposed = expectIntent(
      await proposeTestOrder(testApp, user.userId, { account_ref: accountRef }),
    );
    console.log(`Proposed: BUY 1 ${proposed.symbol} → ${proposed.status}`);
    console.log(`  estimate ${proposed.estValue} ${proposed.currency} (${proposed.priceSource})`);

    testApp.clock.advanceMs(60_000);
    const approved = await approveIntent(testApp.deps, {
      userId: user.userId,
      intentId: proposed.id,
    });
    const fill = approved.intent.execution;
    console.log(`Approved: → ${approved.intent.status}`);
    console.log(`  filled ${fill?.filledQuantity ?? 0} at ${fill?.avgFillPrice ?? '-'} (paper)`);

    const trail = await testApp.deps.db
      .select({
        createdAt: auditEvents.createdAt,
        actor: auditEvents.actor,
        eventType: auditEvents.eventType,
      })
      .from(auditEvents)
      .where(eq(auditEvents.userId, user.userId))
      .orderBy(asc(auditEvents.id));
    console.log('Audit trail:');
    for (const event of trail) {
      console.log(
        `  ${event.createdAt.toISOString()}  ${event.actor.padEnd(6)}  ${event.eventType}`,
      );
    }
  } finally {
    await connection.pool.end();
  }
}

await runDemoFlow();

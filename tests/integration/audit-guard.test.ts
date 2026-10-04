import { count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAudit } from '../../src/audit/write.js';
import type { Database, DatabaseConnection, DatabaseExecutor } from '../../src/db/client.js';
import { auditEvents, users } from '../../src/db/schema.js';
import { setupTestDb, truncateAll } from '../helpers/db.js';

const NOW = new Date('2026-10-03T14:00:00Z');

let connection: DatabaseConnection;
let db: Database;

beforeAll(async () => {
  connection = await setupTestDb();
  db = connection.db;
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function insertUser(snaptradeSub: string): Promise<string> {
  const [user] = await db.insert(users).values({ snaptradeSub }).returning({ id: users.id });
  if (user === undefined) {
    throw new Error('test setup: user insert returned nothing');
  }
  return user.id;
}

async function insertAuditRow(userId: string): Promise<void> {
  await writeAudit(db, {
    userId,
    actor: 'system',
    eventType: 'test.event',
    details: { count: 1 },
    createdAt: NOW,
  });
}

async function countAuditRows(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId));
  return row?.total ?? 0;
}

// Same effect as `SET LOCAL app.deleting_user = '<id>'`, but set_config takes the id as a
// query parameter instead of string-building SQL. `true` = local to this transaction.
async function allowAuditDeletionFor(tx: DatabaseExecutor, userId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.deleting_user', ${userId}, true)`);
}

// Drizzle wraps database errors; the trigger's message is on the `cause` chain.
async function databaseErrorMessages(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(' | ');
  }
  throw new Error('expected the database to reject the statement');
}

describe('audit_events append-only guard', () => {
  it('blocks updating an audit row', async () => {
    const userId = await insertUser('user-a');
    await insertAuditRow(userId);

    const message = await databaseErrorMessages(
      db.update(auditEvents).set({ eventType: 'tampered' }).where(eq(auditEvents.userId, userId)),
    );

    expect(message).toContain('audit_events is append-only');
  });

  it('blocks deleting an audit row', async () => {
    const userId = await insertUser('user-a');
    await insertAuditRow(userId);

    const message = await databaseErrorMessages(
      db.delete(auditEvents).where(eq(auditEvents.userId, userId)),
    );

    expect(message).toContain('audit_events rows can only be deleted with their account');
  });

  it("allows deleting a user's audit rows inside that user's deletion transaction", async () => {
    const userId = await insertUser('user-a');
    await insertAuditRow(userId);

    await db.transaction(async (tx) => {
      await allowAuditDeletionFor(tx, userId);
      await tx.delete(auditEvents).where(eq(auditEvents.userId, userId));
    });

    expect(await countAuditRows(userId)).toBe(0);
  });

  it("does not allow deleting another user's audit rows under that setting", async () => {
    const userId = await insertUser('user-a');
    const otherUserId = await insertUser('user-b');
    await insertAuditRow(otherUserId);

    const message = await databaseErrorMessages(
      db.transaction(async (tx) => {
        await allowAuditDeletionFor(tx, userId);
        await tx.delete(auditEvents).where(eq(auditEvents.userId, otherUserId));
      }),
    );

    expect(message).toContain('audit_events rows can only be deleted with their account');
    expect(await countAuditRows(otherUserId)).toBe(1);
  });

  it('cascades audit rows when the user row is deleted under that setting', async () => {
    const userId = await insertUser('user-a');
    const otherUserId = await insertUser('user-b');
    await insertAuditRow(userId);
    await insertAuditRow(userId);
    await insertAuditRow(otherUserId);

    await db.transaction(async (tx) => {
      await allowAuditDeletionFor(tx, userId);
      await tx.delete(users).where(eq(users.id, userId));
    });

    expect(await countAuditRows(userId)).toBe(0);
    expect(await countAuditRows(otherUserId)).toBe(1);
  });

  it('blocks deleting a user with audit rows without that setting', async () => {
    const userId = await insertUser('user-a');
    await insertAuditRow(userId);

    const message = await databaseErrorMessages(db.delete(users).where(eq(users.id, userId)));

    expect(message).toContain('audit_events rows can only be deleted with their account');
    expect(await countAuditRows(userId)).toBe(1);
  });

  it('forgets the setting when the deletion transaction ends', async () => {
    const userId = await insertUser('user-a');
    await insertAuditRow(userId);
    await db.transaction(async (tx) => {
      await allowAuditDeletionFor(tx, userId);
    });

    const message = await databaseErrorMessages(
      db.delete(auditEvents).where(eq(auditEvents.userId, userId)),
    );

    expect(message).toContain('audit_events rows can only be deleted with their account');
  });
});

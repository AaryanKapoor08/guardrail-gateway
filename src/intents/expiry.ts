import { and, eq, lte } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';
import { lockUserRow } from '../db/locks.js';
import { orderIntents } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { applyTransitionToMany } from './transitions.js';

// Expiry is lazy (before every intent read and approval) plus a 60-second sweeper, so
// correctness never depends on the sweeper running (V§7.3). Both are idempotent.

// Moves the user's PENDING_APPROVAL intents whose window has passed to EXPIRED. Must run inside
// a transaction that already holds the user's row lock (lock order: users first).
export async function expireDue(tx: Transaction, userId: string, now: Date): Promise<number> {
  const due = await tx
    .select({ id: orderIntents.id })
    .from(orderIntents)
    .where(
      and(
        eq(orderIntents.userId, userId),
        eq(orderIntents.status, 'PENDING_APPROVAL'),
        lte(orderIntents.expiresAt, now),
      ),
    )
    .for('update');
  const expired = await applyTransitionToMany(tx, {
    userId,
    intentIds: due.map((row) => row.id),
    from: 'PENDING_APPROVAL',
    event: 'EXPIRE',
    now,
    actor: 'system',
    details: { reason: 'The approval window passed.' },
  });
  return expired.length;
}

// Users with at least one PENDING_APPROVAL intent past its expiry (for the sweeper).
export async function findUsersWithDueIntents(deps: Deps): Promise<string[]> {
  const rows = await deps.db
    .selectDistinct({ userId: orderIntents.userId })
    .from(orderIntents)
    .where(
      and(eq(orderIntents.status, 'PENDING_APPROVAL'), lte(orderIntents.expiresAt, deps.now())),
    );
  return rows.map((row) => row.userId);
}

export async function expireDueForUser(deps: Deps, userId: string): Promise<number> {
  return deps.db.transaction(async (tx) => {
    await lockUserRow(tx, userId);
    return expireDue(tx, userId, deps.now());
  });
}

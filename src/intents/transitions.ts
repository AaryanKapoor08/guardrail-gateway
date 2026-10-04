import { and, eq, inArray } from 'drizzle-orm';
import { type Actor, writeAudit, writeAudits } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { orderIntents } from '../db/schema.js';
import { type IntentEvent, type IntentState, transition } from './state-machine.js';

type IntentColumns = Partial<typeof orderIntents.$inferInsert>;

export type TransitionChange = {
  readonly intentId: string;
  readonly userId: string;
  readonly from: IntentState;
  readonly event: IntentEvent;
  readonly now: Date;
  readonly actor: Actor;
  readonly actorDetail?: string | undefined;
  readonly details?: Readonly<Record<string, unknown>>;
  // Other columns to change together with the status (results, prices, decided_at, …).
  readonly set?: IntentColumns;
};

// The single place an intent's status changes (V§7.3): the pure transition check, an UPDATE
// guarded by the current status (must hit exactly one row), and the audit row, all in the
// caller's transaction, so they commit together or not at all.
export async function applyTransition(
  tx: Transaction,
  change: TransitionChange,
): Promise<IntentState> {
  const to = transition(change.from, change.event);
  const updated = await tx
    .update(orderIntents)
    .set({ ...change.set, status: to, updatedAt: change.now })
    .where(and(eq(orderIntents.id, change.intentId), eq(orderIntents.status, change.from)))
    .returning({ id: orderIntents.id });
  if (updated.length !== 1) {
    // The row was locked by this transaction, so this would be a bug, not a race.
    throw new Error(`[Intents] intent was not in ${change.from} when applying ${change.event}`);
  }
  await writeAudit(tx, {
    userId: change.userId,
    intentId: change.intentId,
    actor: change.actor,
    actorDetail: change.actorDetail,
    eventType: `intent.${to.toLowerCase()}`,
    details: { from: change.from, to, ...change.details },
    createdAt: change.now,
  });
  return to;
}

// The same transition for several intents of one user, in one UPDATE and one audit insert.
// Used by expiry and by bulk cancels (kill switch, disconnect). Returns the ids changed.
export async function applyTransitionToMany(
  tx: Transaction,
  change: Omit<TransitionChange, 'intentId' | 'set'> & { readonly intentIds: readonly string[] },
): Promise<string[]> {
  if (change.intentIds.length === 0) {
    return [];
  }
  const to = transition(change.from, change.event);
  const updated = await tx
    .update(orderIntents)
    .set({ status: to, updatedAt: change.now, decidedAt: change.now })
    .where(
      and(inArray(orderIntents.id, [...change.intentIds]), eq(orderIntents.status, change.from)),
    )
    .returning({ id: orderIntents.id });
  await writeAudits(
    tx,
    updated.map(({ id }) => ({
      userId: change.userId,
      intentId: id,
      actor: change.actor,
      actorDetail: change.actorDetail,
      eventType: `intent.${to.toLowerCase()}`,
      details: { from: change.from, to, ...change.details },
      createdAt: change.now,
    })),
  );
  return updated.map(({ id }) => id);
}

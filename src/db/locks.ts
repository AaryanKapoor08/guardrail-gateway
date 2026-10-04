import { and, eq } from 'drizzle-orm';
import type { IntentState } from '../intents/state-machine.js';
import { NotFoundError } from '../lib/errors.js';
import type { Transaction } from './client.js';
import { orderIntents, users } from './schema.js';

export type LockedUser = {
  readonly id: string;
  readonly isDemo: boolean;
  readonly killSwitch: boolean;
  readonly mode: 'paper' | 'live';
  readonly needsReauth: boolean;
};

// The per-user lock (V§10.1). Every change that the policy engine depends on (proposals,
// approvals, the kill switch, mode, policy, allowed accounts) takes this row lock first, so two
// of them for the same user can never interleave. Lock order everywhere: users row first, then
// order_intents rows, then anything else. Row locks (not advisory locks) work through Neon's
// transaction-mode connection pooler.
export async function lockUserRow(tx: Transaction, userId: string): Promise<LockedUser | null> {
  const [user] = await tx
    .select({
      id: users.id,
      isDemo: users.isDemo,
      killSwitch: users.killSwitch,
      mode: users.mode,
      needsReauth: users.needsReauth,
    })
    .from(users)
    .where(eq(users.id, userId))
    .for('update');
  return user ?? null;
}

// Same as lockUserRow, for callers where a missing user is a bug or a "not found".
export async function lockExistingUser(tx: Transaction, userId: string): Promise<LockedUser> {
  const user = await lockUserRow(tx, userId);
  if (user === null) {
    throw new NotFoundError();
  }
  return user;
}

// The intent's row lock (second in the lock order). Null if it isn't this user's intent.
export async function lockIntentRow(
  tx: Transaction,
  userId: string,
  intentId: string,
): Promise<{ status: IntentState } | null> {
  const [row] = await tx
    .select({ status: orderIntents.status })
    .from(orderIntents)
    .where(and(eq(orderIntents.id, intentId), eq(orderIntents.userId, userId)))
    .for('update');
  return row ?? null;
}

import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';
import { lockUserRow } from '../db/locks.js';
import { users, webhookEvents } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { revokeAndDelete } from '../snaptrade/tokens.js';

// "Delete account" (V§4.6): everything Disconnect does, then every row of the user, including
// the audit log. This is the only path allowed to delete audit rows (V§14.3).

// Deletes every row of one user in the caller's transaction. Everything owned by a user
// cascades from `users`; webhook events have no foreign key (they can arrive for a user we
// don't know yet), so they go explicitly. Also used by the demo cleanup (P14).
export async function deleteUserRows(
  tx: Transaction,
  user: { id: string; snaptradeSub: string },
): Promise<void> {
  // Transaction-local, like SET LOCAL, but with the id as a parameter. The audit trigger only
  // lets this user's audit rows be deleted while it is set.
  await tx.execute(sql`select set_config('app.deleting_user', ${user.id}, true)`);
  await tx.delete(webhookEvents).where(eq(webhookEvents.userSub, user.snaptradeSub));
  await tx.delete(users).where(eq(users.id, user.id));
}

// Revoking at SnapTrade is best effort: if it fails we still delete everything here and tell
// the user to remove the app in their SnapTrade dashboard too.
async function revokeAtSnapTradeIfPossible(deps: Deps, userId: string): Promise<boolean> {
  try {
    const { revokedAtSnapTrade } = await revokeAndDelete(deps, userId);
    return revokedAtSnapTrade;
  } catch (error) {
    // Handled: deletion must not depend on SnapTrade being reachable.
    deps.logger.logError('[Accounts] SnapTrade revocation before deletion failed', error, {
      userId,
    });
    return false;
  }
}

export async function deleteAccount(
  deps: Deps,
  user: { id: string; snaptradeSub: string },
): Promise<{ revokedAtSnapTrade: boolean }> {
  const revokedAtSnapTrade = await revokeAtSnapTradeIfPossible(deps, user.id);
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, user.id);
    await deleteUserRows(tx, user);
  });
  deps.logger.info('Account deleted', { event: 'account.deleted', userId: user.id });
  return { revokedAtSnapTrade };
}

import { writeAudit } from '../audit/write.js';
import { lockUserRow } from '../db/locks.js';
import type { Deps } from '../deps.js';
import { cancelAllPending } from '../intents/decisions.js';
import { revokeAllGrantsForUser } from '../oauth-server/grants.js';
import { revokeAndDelete } from '../snaptrade/tokens.js';

// "Disconnect SnapTrade" (V§4.6): revoke our SnapTrade grant, cut off every connected AI app,
// cancel orders still waiting for approval, and keep the history. The user can sign in again later.
export async function disconnectUser(
  deps: Deps,
  userId: string,
): Promise<{ revokedAtSnapTrade: boolean }> {
  // Network call first, outside any transaction.
  const { revokedAtSnapTrade } = await revokeAndDelete(deps, userId);
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, userId);
    const revokedAiApps = await revokeAllGrantsForUser(tx, userId, now);
    const cancelledIntents = await cancelAllPending(tx, {
      userId,
      now,
      actor: 'system',
      reason: 'SnapTrade was disconnected.',
    });
    await writeAudit(tx, {
      userId,
      actor: 'user',
      eventType: 'snaptrade.disconnected',
      details: { revokedAtSnapTrade, revokedAiApps, cancelledIntents },
      createdAt: now,
    });
  });
  return { revokedAtSnapTrade };
}

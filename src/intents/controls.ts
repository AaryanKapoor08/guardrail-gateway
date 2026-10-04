import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import { type LockedUser, lockExistingUser } from '../db/locks.js';
import { users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import type { Mode } from '../policy/types.js';
import { grantHasTradeScope, isLiveTradingOnServer } from './context.js';
import { cancelAllPending } from './decisions.js';

// The user's two big switches. Both take the per-user lock, so they can't interleave with a
// proposal or an approval (V§7.3: a kill switch runs fully before or fully after an approval).

export async function setKillSwitch(
  deps: Deps,
  request: { userId: string; on: boolean },
): Promise<{ cancelled: number }> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, request.userId);
    const now = deps.now();
    await tx
      .update(users)
      .set({ killSwitch: request.on, updatedAt: now })
      .where(eq(users.id, request.userId));
    const cancelled = request.on
      ? await cancelAllPending(tx, {
          userId: request.userId,
          now,
          actor: 'user',
          reason: 'The kill switch was turned on.',
        })
      : 0;
    await writeAudit(tx, {
      userId: request.userId,
      actor: 'user',
      eventType: request.on ? 'kill_switch.on' : 'kill_switch.off',
      details: { cancelled },
      createdAt: now,
    });
    return { cancelled };
  });
}

// The account-independent live gates (V§10.3). The per-account ones (trade-enabled connection,
// paper account) are checked on every order by the `mode_allowed` rule.
export function liveModeProblems(
  deps: Deps,
  user: Pick<LockedUser, 'isDemo'>,
  hasTradeScope: boolean,
): string[] {
  const problems: string[] = [];
  if (user.isDemo) {
    problems.push("Live mode isn't available in the demo.");
  }
  if (!isLiveTradingOnServer(deps.env)) {
    problems.push('Live trading is turned off on this server.');
  }
  if (!hasTradeScope) {
    problems.push(
      "Your SnapTrade sign-in doesn't include trading permission (SnapTrade hasn't enabled it for this app yet).",
    );
  }
  return problems;
}

export type SetModeResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: string[] };

export async function setMode(
  deps: Deps,
  request: { userId: string; mode: Mode },
): Promise<SetModeResult> {
  return deps.db.transaction(async (tx) => {
    const user = await lockExistingUser(tx, request.userId);
    if (request.mode === 'live') {
      const problems = liveModeProblems(deps, user, await grantHasTradeScope(tx, request.userId));
      if (problems.length > 0) {
        return { ok: false, problems };
      }
    }
    const now = deps.now();
    await tx
      .update(users)
      .set({ mode: request.mode, updatedAt: now })
      .where(eq(users.id, request.userId));
    await writeAudit(tx, {
      userId: request.userId,
      actor: 'user',
      eventType: 'mode.changed',
      details: { from: user.mode, to: request.mode },
      createdAt: now,
    });
    return { ok: true };
  });
}

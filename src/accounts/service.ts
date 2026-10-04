import { and, asc, eq } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import { lockUserRow } from '../db/locks.js';
import { accounts, connections } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { NotFoundError } from '../lib/errors.js';

export type AccountListItem = {
  readonly ref: string;
  readonly institutionName: string;
  readonly name: string;
  readonly rawType: string | null;
  readonly accountCategory: string | null;
  readonly numberLast4: string | null;
  readonly isPaper: boolean;
  readonly allowed: boolean;
  readonly present: boolean;
  readonly connectionDisabled: boolean;
  readonly connectionType: 'read' | 'trade';
  readonly firstSeenAt: Date;
};

const NEW_ACCOUNT_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

// Accounts SnapTrade reported after the user's first sync (e.g. a NEW_ACCOUNT_AVAILABLE
// webhook), within the last week, that the user hasn't allowed: worth a "new account" notice.
export function newlyFoundAccounts(
  accounts: readonly AccountListItem[],
  now: Date,
): AccountListItem[] {
  const firstSyncMs = Math.min(...accounts.map((account) => account.firstSeenAt.getTime()));
  return accounts.filter(
    (account) =>
      !account.allowed &&
      account.present &&
      account.firstSeenAt.getTime() > firstSyncMs &&
      now.getTime() - account.firstSeenAt.getTime() < NEW_ACCOUNT_NOTICE_MS,
  );
}

// Every account we've seen for the user, with its connection's health, in one query.
export async function listUserAccounts(deps: Deps, userId: string): Promise<AccountListItem[]> {
  return deps.db
    .select({
      ref: accounts.id,
      institutionName: accounts.institutionName,
      name: accounts.name,
      rawType: accounts.rawType,
      accountCategory: accounts.accountCategory,
      numberLast4: accounts.numberLast4,
      isPaper: accounts.isPaper,
      allowed: accounts.allowed,
      present: accounts.present,
      connectionDisabled: connections.disabled,
      connectionType: connections.type,
      firstSeenAt: accounts.firstSeenAt,
    })
    .from(accounts)
    .innerJoin(connections, eq(connections.id, accounts.connectionId))
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.institutionName), asc(accounts.name));
}

// Allows or disallows one of the user's accounts. Someone else's account (or a made-up ref)
// is "not found", so account refs can't be probed.
export async function setAccountAllowed(
  deps: Deps,
  change: { userId: string; accountRef: string; allowed: boolean },
): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, change.userId);
    const updated = await tx
      .update(accounts)
      .set({ allowed: change.allowed })
      .where(and(eq(accounts.id, change.accountRef), eq(accounts.userId, change.userId)))
      .returning({ id: accounts.id });
    if (updated.length === 0) {
      throw new NotFoundError("We couldn't find that account.");
    }
    await writeAudit(tx, {
      userId: change.userId,
      actor: 'user',
      eventType: change.allowed ? 'account.allowed' : 'account.disallowed',
      details: { accountRef: change.accountRef },
      createdAt: now,
    });
  });
}

import { and, eq, notInArray, sql } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { accounts, connections } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { randomToken } from '../lib/crypto.js';
import {
  listAccounts,
  listConnections,
  type SnapTradeAccount,
  type SnapTradeConnection,
} from './resources.js';

// Copies the user's SnapTrade connections and accounts into our database (V§4.1 step 5).
// New accounts start NOT allowed; the user decides which ones the AI may see. Accounts that
// disappear from SnapTrade are kept (intents refer to them) but marked `present = false`.

export const ACCOUNT_SYNC_TTL_MS = 5 * 60 * 1000;

export type SyncSummary = {
  readonly connections: number;
  readonly accounts: number;
  readonly missingAccounts: number;
};

// Returns the ids of the connections now stored for this user. A connection id already stored
// for another user is left alone and not returned (SnapTrade ids are unique, so that would mean
// something is badly wrong; isolation comes first).
async function upsertConnections(
  tx: Transaction,
  userId: string,
  fetched: readonly SnapTradeConnection[],
  now: Date,
): Promise<Set<string>> {
  if (fetched.length === 0) {
    return new Set();
  }
  const stored = await tx
    .insert(connections)
    .values(
      fetched.map((connection) => ({
        id: connection.id,
        userId,
        brokerageName: connection.brokerageName,
        type: connection.type,
        disabled: connection.disabled,
        disabledAt: connection.disabledAt,
        syncedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: connections.id,
      set: {
        brokerageName: sql`excluded.brokerage_name`,
        type: sql`excluded.type`,
        disabled: sql`excluded.disabled`,
        disabledAt: sql`excluded.disabled_at`,
        syncedAt: sql`excluded.synced_at`,
      },
      // Never touch a row that belongs to someone else.
      setWhere: eq(connections.userId, userId),
    })
    .returning({ id: connections.id });
  return new Set(stored.map((connection) => connection.id));
}

function accountRow(userId: string, account: SnapTradeAccount, brokerageName: string, now: Date) {
  return {
    // Our own short public reference: the AI and the URLs never see SnapTrade's account id.
    id: `acc_${randomToken(6)}`,
    userId,
    snaptradeAccountId: account.snaptradeAccountId,
    connectionId: account.connectionId,
    institutionName: account.institutionName ?? brokerageName,
    name: account.name ?? account.rawType ?? 'Unnamed account',
    numberLast4: account.numberLast4,
    rawType: account.rawType,
    accountCategory: account.accountCategory,
    isPaper: account.isPaper,
    syncedAt: now,
    firstSeenAt: now,
  };
}

async function upsertAccounts(
  tx: Transaction,
  userId: string,
  fetched: { account: SnapTradeAccount; brokerageName: string }[],
  now: Date,
): Promise<void> {
  if (fetched.length === 0) {
    return;
  }
  await tx
    .insert(accounts)
    .values(
      fetched.map(({ account, brokerageName }) => accountRow(userId, account, brokerageName, now)),
    )
    .onConflictDoUpdate({
      target: [accounts.userId, accounts.snaptradeAccountId],
      // `id` and `allowed` are ours and never change on a sync.
      set: {
        connectionId: sql`excluded.connection_id`,
        institutionName: sql`excluded.institution_name`,
        name: sql`excluded.name`,
        numberLast4: sql`excluded.number_last4`,
        rawType: sql`excluded.raw_type`,
        accountCategory: sql`excluded.account_category`,
        isPaper: sql`excluded.is_paper`,
        present: true,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

async function markMissingAccounts(
  tx: Transaction,
  userId: string,
  presentIds: string[],
  now: Date,
): Promise<number> {
  const missing = await tx
    .update(accounts)
    .set({ present: false, syncedAt: now })
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.present, true),
        notInArray(accounts.snaptradeAccountId, presentIds),
      ),
    )
    .returning({ id: accounts.id });
  return missing.length;
}

// Always calls SnapTrade. Use `syncIfStale` for page loads.
export async function syncUserConnectionsAndAccounts(
  deps: Deps,
  userId: string,
): Promise<SyncSummary> {
  const [fetchedConnections, fetchedAccounts] = await Promise.all([
    listConnections(deps, userId),
    listAccounts(deps, userId),
  ]);
  const brokerageNames = new Map(fetchedConnections.map((c) => [c.id, c.brokerageName]));
  // An account whose connection wasn't listed can't be stored (it needs its connection row).
  const linkedAccounts = fetchedAccounts.flatMap((account) => {
    const brokerageName = brokerageNames.get(account.connectionId);
    return brokerageName === undefined ? [] : [{ account, brokerageName }];
  });
  const now = deps.now();
  const summary = await deps.db.transaction(async (tx) => {
    const ownConnectionIds = await upsertConnections(tx, userId, fetchedConnections, now);
    // An account may only point at this user's own connection row.
    const ownAccounts = linkedAccounts.filter(({ account }) =>
      ownConnectionIds.has(account.connectionId),
    );
    await upsertAccounts(tx, userId, ownAccounts, now);
    const presentIds = ownAccounts.map(({ account }) => account.snaptradeAccountId);
    const missingAccounts = await markMissingAccounts(tx, userId, presentIds, now);
    const result = {
      connections: ownConnectionIds.size,
      accounts: ownAccounts.length,
      missingAccounts,
    };
    await writeAudit(tx, {
      userId,
      actor: 'system',
      eventType: 'accounts.synced',
      details: result,
      createdAt: now,
    });
    return result;
  });
  deps.caches.accountSyncs.set(userId, true);
  return summary;
}

// Syncs at most once per 5 minutes per user (V§12.3), sharing a sync that is already running.
export async function syncIfStale(deps: Deps, userId: string): Promise<void> {
  await deps.caches.accountSyncs.getOrLoad(userId, async () => {
    await syncUserConnectionsAndAccounts(deps, userId);
    return true;
  });
}

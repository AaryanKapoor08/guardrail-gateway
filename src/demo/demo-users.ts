import { randomUUID } from 'node:crypto';
import { and, count, eq, lte } from 'drizzle-orm';
import { deleteUserRows } from '../accounts/deletion.js';
import { writeAudit } from '../audit/write.js';
import { createSession } from '../auth/sessions.js';
import { lockUserRow } from '../db/locks.js';
import { accounts, policies, users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { DEFAULT_POLICY } from '../policy/schema.js';
import { syncUserConnectionsAndAccounts } from '../snaptrade/sync.js';
import { DEMO_TFSA_ID } from './demo-brokerage.js';

// Instant demo accounts (V§4.7): no sign-up, built-in fake brokerage data, paper only, and
// deleted automatically after 24 hours.

export const MAX_ACTIVE_DEMO_USERS = 300;
export const DEMO_LIFETIME_MS = 24 * 60 * 60 * 1000;

export async function countDemoUsers(deps: Deps): Promise<number> {
  const [row] = await deps.db.select({ total: count() }).from(users).where(eq(users.isDemo, true));
  return row?.total ?? 0;
}

async function createDemoUser(deps: Deps): Promise<{ userId: string; sessionId: string }> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        snaptradeSub: `demo:${randomUUID()}`,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id });
    if (user === undefined) {
      throw new Error('[Demo] user insert returned no row');
    }
    await tx
      .insert(policies)
      .values({ userId: user.id, version: 1, rules: DEFAULT_POLICY, updatedAt: now });
    await writeAudit(tx, {
      userId: user.id,
      actor: 'system',
      eventType: 'demo.started',
      details: { expiresInHours: DEMO_LIFETIME_MS / 3_600_000 },
      createdAt: now,
    });
    const { sessionId } = await createSession(tx, user.id, now);
    return { userId: user.id, sessionId };
  });
}

// The Demo TFSA starts allowed, so the guided steps work at once; the Demo Individual account
// stays not allowed to show the allow-list.
async function allowDemoTfsa(deps: Deps, userId: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, userId);
    await tx
      .update(accounts)
      .set({ allowed: true })
      .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, DEMO_TFSA_ID)));
  });
}

export async function startDemo(deps: Deps): Promise<{ userId: string; sessionId: string }> {
  const demo = await createDemoUser(deps);
  // The demo brokerage answers in-process (no network), through the normal sync.
  await syncUserConnectionsAndAccounts(deps, demo.userId);
  await allowDemoTfsa(deps, demo.userId);
  return demo;
}

// Sweeper task: demo users older than 24 hours go through the same deletion as
// "Delete account", one transaction per user (user lock first).
export async function deleteExpiredDemoUsers(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - DEMO_LIFETIME_MS);
  const expired = await deps.db
    .select({ id: users.id, snaptradeSub: users.snaptradeSub })
    .from(users)
    .where(and(eq(users.isDemo, true), lte(users.createdAt, cutoff)));
  for (const user of expired) {
    await deps.db.transaction(async (tx) => {
      await lockUserRow(tx, user.id);
      await deleteUserRows(tx, user);
    });
  }
  return expired.length;
}

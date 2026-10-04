import { lte } from 'drizzle-orm';
import {
  loginAttempts,
  mcpAuthCodes,
  mcpAuthRequests,
  sessions,
  webhookEvents,
} from '../db/schema.js';
import { deleteExpiredDemoUsers } from '../demo/demo-users.js';
import type { Deps } from '../deps.js';
import { expireDueForUser, findUsersWithDueIntents } from '../intents/expiry.js';
import { processPending } from '../webhooks/processor.js';

// The 60-second background job (V§12.5). Every task is idempotent and safe to run late or
// twice, because a free Render instance can restart at any time.

export const SWEEP_INTERVAL_MS = 60_000;

export type SweepSummary = {
  readonly expiredIntents: number;
  readonly processedWebhooks: number;
  readonly deletedDemoUsers: number;
  readonly purgedRows: number;
};

const WEBHOOK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function expireIntents(deps: Deps): Promise<number> {
  let expired = 0;
  // One transaction per user, each taking that user's lock first (the global lock order).
  for (const userId of await findUsersWithDueIntents(deps)) {
    expired += await expireDueForUser(deps, userId);
  }
  return expired;
}

// Short-lived rows that are useless once expired: sessions (24h), login attempts (10 min),
// pending MCP authorizations (10 min), MCP authorization codes (60s), and webhook events after
// 30 days (V§12.5).
async function purgeExpiredRows(deps: Deps): Promise<number> {
  const now = deps.now();
  const webhookCutoff = new Date(now.getTime() - WEBHOOK_RETENTION_MS);
  const results = await Promise.all([
    deps.db
      .delete(webhookEvents)
      .where(lte(webhookEvents.receivedAt, webhookCutoff))
      .returning({ id: webhookEvents.webhookId }),
    deps.db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.idHash }),
    deps.db
      .delete(loginAttempts)
      .where(lte(loginAttempts.expiresAt, now))
      .returning({ id: loginAttempts.idHash }),
    deps.db
      .delete(mcpAuthRequests)
      .where(lte(mcpAuthRequests.expiresAt, now))
      .returning({ id: mcpAuthRequests.id }),
    deps.db
      .delete(mcpAuthCodes)
      .where(lte(mcpAuthCodes.expiresAt, now))
      .returning({ id: mcpAuthCodes.codeHash }),
  ]);
  return results.reduce((total, rows) => total + rows.length, 0);
}

export async function runSweepOnce(deps: Deps): Promise<SweepSummary> {
  const expiredIntents = await expireIntents(deps);
  // Retries webhook events that weren't processed right away (e.g. after a restart).
  const processedWebhooks = await processPending(deps);
  const deletedDemoUsers = await deleteExpiredDemoUsers(deps);
  const purgedRows = await purgeExpiredRows(deps);
  return { expiredIntents, processedWebhooks, deletedDemoUsers, purgedRows };
}

export type Sweeper = { readonly stop: () => Promise<void> };

export function startSweeper(deps: Deps): Sweeper {
  let running: Promise<void> | null = null;

  const sweep = async (): Promise<void> => {
    try {
      const summary = await runSweepOnce(deps);
      deps.logger.debug('Sweep finished', { event: 'sweep', count: summary.expiredIntents });
    } catch (error) {
      // Handled: the next run retries; every task is idempotent.
      deps.logger.logError('[Sweeper] sweep failed', error);
    }
  };

  const timer = setInterval(() => {
    // Overlap guard: skip this tick if the previous sweep is still running.
    if (running !== null) {
      return;
    }
    running = sweep().finally(() => {
      running = null;
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}

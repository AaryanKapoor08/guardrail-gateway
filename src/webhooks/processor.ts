import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { snaptradeGrants, users, webhookEvents } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { forgetHoldings } from '../snaptrade/cached.js';
import { syncIfStale, syncUserConnectionsAndAccounts } from '../snaptrade/sync.js';

// Processes stored webhook events (V§12.4 step 6). A webhook is only a hint that something
// changed: we never trust its payload as state, we re-read the truth from SnapTrade. Processing
// is idempotent (a re-sync or a cache drop twice is harmless), so it runs after the response,
// from the sweeper, and again after a restart without any risk.

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 200;

// Connection and account changes: re-read connections and accounts. The sync stores new
// accounts as not allowed and marks removed ones `present = false`.
const RESYNC_EVENT_TYPES: ReadonlySet<string> = new Set([
  'CONNECTION_BROKEN',
  'CONNECTION_FIXED',
  'CONNECTION_UPDATED',
  'CONNECTION_ADDED',
  'CONNECTION_DELETED',
  'NEW_ACCOUNT_AVAILABLE',
  'ACCOUNT_REMOVED',
]);
const HOLDINGS_EVENT_TYPE = 'ACCOUNT_HOLDINGS_UPDATED';

type PendingEvent = {
  readonly webhookId: string;
  readonly eventType: string;
  readonly userSub: string;
  readonly stale: boolean;
};

function findPendingEvents(deps: Deps): Promise<PendingEvent[]> {
  return deps.db
    .select({
      webhookId: webhookEvents.webhookId,
      eventType: webhookEvents.eventType,
      userSub: webhookEvents.userSub,
      stale: webhookEvents.stale,
    })
    .from(webhookEvents)
    .where(and(isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(BATCH_SIZE);
}

// The user behind the event, only if we can still call SnapTrade for them.
async function findActiveUserId(deps: Deps, userSub: string): Promise<string | null> {
  const [user] = await deps.db
    .select({ id: users.id, needsReauth: users.needsReauth, grantUserId: snaptradeGrants.userId })
    .from(users)
    .leftJoin(snaptradeGrants, eq(snaptradeGrants.userId, users.id))
    .where(eq(users.snaptradeSub, userSub));
  if (user === undefined || user.needsReauth || user.grantUserId === null) {
    return null;
  }
  return user.id;
}

async function markProcessed(deps: Deps, webhookId: string, note: string | null): Promise<void> {
  await deps.db
    .update(webhookEvents)
    .set({ processedAt: deps.now(), lastError: note })
    .where(and(eq(webhookEvents.webhookId, webhookId), isNull(webhookEvents.processedAt)));
}

// Our error messages never contain tokens or response bodies, so the message is safe to keep.
async function recordFailure(deps: Deps, webhookId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'unknown error';
  await deps.db
    .update(webhookEvents)
    .set({
      attempts: sql`${webhookEvents.attempts} + 1`,
      lastError: message.slice(0, MAX_ERROR_LENGTH),
    })
    .where(eq(webhookEvents.webhookId, webhookId));
}

// Returns a note to store with the event, or null when it was acted on normally.
async function applyEvent(deps: Deps, event: PendingEvent, userId: string): Promise<string | null> {
  if (RESYNC_EVENT_TYPES.has(event.eventType)) {
    // A stale event (possibly a replay or a late retry) re-syncs at most once per user per 5
    // minutes; a fresh one always re-syncs.
    await (event.stale ? syncIfStale(deps, userId) : syncUserConnectionsAndAccounts(deps, userId));
    return null;
  }
  if (event.eventType === HOLDINGS_EVENT_TYPE) {
    forgetHoldings(deps, userId);
    return null;
  }
  return 'ignored: event type not used';
}

async function processEvent(deps: Deps, event: PendingEvent): Promise<void> {
  const userId = await findActiveUserId(deps, event.userSub);
  if (userId === null) {
    await markProcessed(deps, event.webhookId, 'skipped: no active grant');
    return;
  }
  try {
    await markProcessed(deps, event.webhookId, await applyEvent(deps, event, userId));
  } catch (error) {
    // Handled: counted and retried by the next sweep, up to 5 attempts.
    deps.logger.logError('[Webhooks] processing failed', error, { userId });
    await recordFailure(deps, event.webhookId, error);
  }
}

// One batch, oldest first. Events run one at a time so a burst can't flood SnapTrade.
export async function processPending(deps: Deps): Promise<number> {
  const events = await findPendingEvents(deps);
  for (const event of events) {
    await processEvent(deps, event);
  }
  return events.length;
}

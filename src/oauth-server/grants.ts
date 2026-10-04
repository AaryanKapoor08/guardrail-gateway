import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import type { DatabaseExecutor, Transaction } from '../db/client.js';
import { lockUserRow } from '../db/locks.js';
import { mcpGrants, mcpTokens } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { NotFoundError } from '../lib/errors.js';

// A grant is one AI app's access for one user ("Connected AI apps"). Revoking it kills every
// access and refresh token issued under it, immediately (our tokens are looked up on each use).
// Revoked grants are never reactivated, so their old tokens stay dead.

async function revokeTokensOfGrants(tx: Transaction, grantIds: string[], now: Date): Promise<void> {
  if (grantIds.length === 0) {
    return;
  }
  await tx
    .update(mcpTokens)
    .set({ revokedAt: now })
    .where(and(inArray(mcpTokens.grantId, grantIds), isNull(mcpTokens.revokedAt)));
}

export async function revokeAllGrantsForUser(
  tx: Transaction,
  userId: string,
  now: Date,
): Promise<number> {
  const revoked = await tx
    .update(mcpGrants)
    .set({ revokedAt: now })
    .where(and(eq(mcpGrants.userId, userId), isNull(mcpGrants.revokedAt)))
    .returning({ id: mcpGrants.id });
  const grantIds = revoked.map((grant) => grant.id);
  await revokeTokensOfGrants(tx, grantIds, now);
  return grantIds.length;
}

// Revokes one grant and all its tokens. Also used when a reused code or refresh token suggests
// theft. The caller holds the user's row lock.
export async function revokeGrant(tx: Transaction, grantId: string, now: Date): Promise<void> {
  await tx
    .update(mcpGrants)
    .set({ revokedAt: now })
    .where(and(eq(mcpGrants.id, grantId), isNull(mcpGrants.revokedAt)));
  // Tokens are revoked even if the grant already was, in case one was issued in between.
  await revokeTokensOfGrants(tx, [grantId], now);
}

// The user's active grant for this app, or a new one. The caller holds the user's row lock, so
// two consents at once can't create two grants.
export async function activeGrantFor(
  tx: Transaction,
  request: { userId: string; clientId: string; clientHost: string; scope: string; now: Date },
): Promise<string> {
  const [existing] = await tx
    .select({ id: mcpGrants.id })
    .from(mcpGrants)
    .where(
      and(
        eq(mcpGrants.userId, request.userId),
        eq(mcpGrants.clientId, request.clientId),
        isNull(mcpGrants.revokedAt),
      ),
    );
  if (existing !== undefined) {
    await tx.update(mcpGrants).set({ scope: request.scope }).where(eq(mcpGrants.id, existing.id));
    return existing.id;
  }
  const [inserted] = await tx
    .insert(mcpGrants)
    .values({
      userId: request.userId,
      clientId: request.clientId,
      clientHost: request.clientHost,
      scope: request.scope,
      createdAt: request.now,
      lastUsedAt: request.now,
    })
    .returning({ id: mcpGrants.id });
  if (inserted === undefined) {
    throw new Error('[OAuth] grant insert returned no row');
  }
  return inserted.id;
}

export type ConnectedApp = {
  readonly id: string;
  readonly clientHost: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
};

export function listConnectedApps(db: DatabaseExecutor, userId: string): Promise<ConnectedApp[]> {
  return db
    .select({
      id: mcpGrants.id,
      clientHost: mcpGrants.clientHost,
      createdAt: mcpGrants.createdAt,
      lastUsedAt: mcpGrants.lastUsedAt,
    })
    .from(mcpGrants)
    .where(and(eq(mcpGrants.userId, userId), isNull(mcpGrants.revokedAt)))
    .orderBy(desc(mcpGrants.createdAt));
}

// "Disconnect" on the Connected AI apps page. Someone else's grant (or a made-up id) is
// "not found", so ids can't be probed.
export async function disconnectApp(
  deps: Deps,
  request: { userId: string; grantId: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, request.userId);
    const [grant] = await tx
      .select({ id: mcpGrants.id, clientHost: mcpGrants.clientHost })
      .from(mcpGrants)
      .where(
        and(
          eq(mcpGrants.id, request.grantId),
          eq(mcpGrants.userId, request.userId),
          isNull(mcpGrants.revokedAt),
        ),
      );
    if (grant === undefined) {
      throw new NotFoundError("We couldn't find that app.");
    }
    const now = deps.now();
    await revokeGrant(tx, grant.id, now);
    await writeAudit(tx, {
      userId: request.userId,
      actor: 'user',
      eventType: 'mcp.grant_revoked',
      details: { clientHost: grant.clientHost },
      createdAt: now,
    });
  });
}

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Transaction } from '../db/client.js';
import { mcpGrants, mcpTokens } from '../db/schema.js';

// A grant is one AI app's access for one user ("Connected AI apps"). Revoking it kills every
// access and refresh token issued under it, immediately (our tokens are looked up on each use).

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

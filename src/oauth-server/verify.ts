import { type AuthInfo, OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { and, eq } from 'drizzle-orm';
import { mcpGrants, mcpTokens } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { sha256Hex } from '../lib/crypto.js';
import { mcpResourceUrl } from './metadata.js';

// The check behind every /mcp request (V§11.1): our opaque token, looked up by its hash, so a
// revoked app or a disconnected user is cut off on the very next call.

const LAST_USED_RESOLUTION_MS = 60_000;

export type McpAuthExtra = {
  readonly userId: string;
  readonly grantId: string;
  readonly clientHost: string;
};

function invalidToken(): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is invalid or expired.');
}

// "Last used" on the Connected AI apps page needs minute precision, not a write per request.
async function recordUse(
  deps: Deps,
  grant: { grantId: string; lastUsedAt: Date },
  now: Date,
): Promise<void> {
  if (now.getTime() - grant.lastUsedAt.getTime() < LAST_USED_RESOLUTION_MS) {
    return;
  }
  await deps.db.update(mcpGrants).set({ lastUsedAt: now }).where(eq(mcpGrants.id, grant.grantId));
}

export function verifyAccessToken(deps: Deps): (token: string) => Promise<AuthInfo> {
  return async (token) => {
    const now = deps.now();
    // Grants are deleted with their user (foreign key cascade), so a found grant means the user
    // still exists.
    const [row] = await deps.db
      .select({
        grantId: mcpTokens.grantId,
        scope: mcpTokens.scope,
        resource: mcpTokens.resource,
        expiresAt: mcpTokens.expiresAt,
        revokedAt: mcpTokens.revokedAt,
        userId: mcpGrants.userId,
        clientId: mcpGrants.clientId,
        clientHost: mcpGrants.clientHost,
        lastUsedAt: mcpGrants.lastUsedAt,
        grantRevokedAt: mcpGrants.revokedAt,
      })
      .from(mcpTokens)
      .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
      .where(and(eq(mcpTokens.tokenHash, sha256Hex(token)), eq(mcpTokens.kind, 'access')));
    if (
      row === undefined ||
      row.revokedAt !== null ||
      row.grantRevokedAt !== null ||
      row.expiresAt <= now ||
      row.resource !== mcpResourceUrl(deps.env)
    ) {
      throw invalidToken();
    }
    await recordUse(deps, row, now);
    const extra: McpAuthExtra = {
      userId: row.userId,
      grantId: row.grantId,
      clientHost: row.clientHost,
    };
    return {
      token,
      clientId: row.clientId,
      scopes: row.scope.split(' '),
      expiresAt: Math.floor(row.expiresAt.getTime() / 1000),
      resource: new URL(row.resource),
      extra,
    };
  };
}

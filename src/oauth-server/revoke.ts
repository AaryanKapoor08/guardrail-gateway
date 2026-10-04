import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { writeAudit } from '../audit/write.js';
import { lockUserRow } from '../db/locks.js';
import { mcpGrants, mcpTokens } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { sha256Hex } from '../lib/crypto.js';
import { revokeGrant } from './grants.js';
import { isFormEncoded, parseOAuthForm } from './token.js';

// POST /oauth/revoke (RFC 7009): an app disconnects itself. Holding the token is the proof, so
// no other credential is needed. The whole grant goes, with every token issued under it.

async function revokeByToken(deps: Deps, token: string): Promise<void> {
  const [owner] = await deps.db
    .select({
      grantId: mcpTokens.grantId,
      userId: mcpGrants.userId,
      clientHost: mcpGrants.clientHost,
    })
    .from(mcpTokens)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
    .where(eq(mcpTokens.tokenHash, sha256Hex(token)));
  if (owner === undefined) {
    return;
  }
  await deps.db.transaction(async (tx) => {
    await lockUserRow(tx, owner.userId);
    const now = deps.now();
    await revokeGrant(tx, owner.grantId, now);
    await writeAudit(tx, {
      userId: owner.userId,
      actor: 'ai',
      actorDetail: owner.clientHost,
      eventType: 'mcp.grant_revoked',
      details: { clientHost: owner.clientHost, reason: 'The app disconnected itself.' },
      createdAt: now,
    });
  });
}

async function revoke(deps: Deps, c: Context): Promise<Response> {
  c.header('Cache-Control', 'no-store');
  c.header('Access-Control-Allow-Origin', '*');
  const fields = isFormEncoded(c) ? parseOAuthForm(await c.req.text()) : null;
  const token = fields?.token;
  if (token === undefined || token === '') {
    return c.json({ error: 'invalid_request', error_description: 'token is required.' }, 400);
  }
  await revokeByToken(deps, token);
  // Always 200, even for an unknown token, so the endpoint reveals nothing (RFC 7009 §2.2).
  return c.body(null, 200);
}

export function registerRevokeRoutes(app: Hono, deps: Deps): void {
  app.post('/oauth/revoke', (c) => revoke(deps, c));
}

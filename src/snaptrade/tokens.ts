import { eq } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import { lockUserRow } from '../db/locks.js';
import { snaptradeGrants, users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { aadFor, decryptField, encryptField, sha256Hex } from '../lib/crypto.js';
import { NeedsReauthError } from '../lib/errors.js';
import { getSnapTradeMetadata } from './discovery.js';
import {
  postToSnapTradeOAuth,
  requestTokens,
  TokenEndpointError,
  type TokenResponse,
} from './oidc.js';

// The SnapTrade token vault (PRODUCT_VISION §12.2): tokens are stored encrypted, refreshed
// lazily, and refreshed by exactly one request at a time per user.

// Refresh when fewer than 5 minutes are left, so a token never expires mid-request.
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function decryptToken(deps: Deps, userId: string, field: string, blob: string): string {
  return decryptField(blob, deps.env.TOKEN_ENCRYPTION_KEY, aadFor(userId, field));
}

function encryptToken(deps: Deps, userId: string, field: string, token: string): string {
  return encryptField(token, deps.env.TOKEN_ENCRYPTION_KEY, aadFor(userId, field));
}

// A usable access token for one API call, refreshed first if it is about to expire.
export async function getAccessToken(deps: Deps, userId: string): Promise<string> {
  const [grant] = await deps.db
    .select({
      accessTokenEnc: snaptradeGrants.accessTokenEnc,
      accessExpiresAt: snaptradeGrants.accessExpiresAt,
    })
    .from(snaptradeGrants)
    .where(eq(snaptradeGrants.userId, userId));
  if (grant === undefined) {
    throw new NeedsReauthError();
  }
  const accessToken = decryptToken(deps, userId, 'access_token', grant.accessTokenEnc);
  const msLeft = grant.accessExpiresAt.getTime() - deps.now().getTime();
  if (msLeft > REFRESH_MARGIN_MS) {
    return accessToken;
  }
  return refreshAccessToken(deps, userId, sha256Hex(accessToken));
}

// Network failures get one more try with the same refresh token: SnapTrade may or may not have
// rotated it, and if it did, the retry fails with invalid_grant and the user reconnects (V§12.2).
async function requestRefresh(
  deps: Deps,
  tokenEndpoint: string,
  refreshToken: string,
): Promise<TokenResponse> {
  const form = { grant_type: 'refresh_token', refresh_token: refreshToken };
  try {
    return await requestTokens(deps, tokenEndpoint, form);
  } catch (error) {
    if (error instanceof TokenEndpointError) {
      throw error;
    }
    deps.logger.logError('[Tokens] refresh got no response; retrying once', error);
    return requestTokens(deps, tokenEndpoint, form);
  }
}

type RefreshOutcome =
  | { readonly kind: 'refreshed'; readonly accessToken: string }
  | { readonly kind: 'grant-revoked' };

// Single-flight refresh. The grant row lock makes concurrent callers wait in line; whoever goes
// second sees that the token changed since it last looked and reuses the new one, so SnapTrade
// is asked once. `seenAccessTokenHash` is the hash of the token the caller found stale or that
// SnapTrade rejected. Holding the lock during the (≤10s) HTTP call is the one documented
// exception to "no network inside a transaction".
export async function refreshAccessToken(
  deps: Deps,
  userId: string,
  seenAccessTokenHash: string,
): Promise<string> {
  const metadata = await getSnapTradeMetadata(deps);
  const outcome = await deps.db.transaction(async (tx): Promise<RefreshOutcome> => {
    const [grant] = await tx
      .select({
        accessTokenEnc: snaptradeGrants.accessTokenEnc,
        refreshTokenEnc: snaptradeGrants.refreshTokenEnc,
      })
      .from(snaptradeGrants)
      .where(eq(snaptradeGrants.userId, userId))
      .for('update');
    if (grant === undefined) {
      return { kind: 'grant-revoked' };
    }
    const storedAccessToken = decryptToken(deps, userId, 'access_token', grant.accessTokenEnc);
    if (sha256Hex(storedAccessToken) !== seenAccessTokenHash) {
      return { kind: 'refreshed', accessToken: storedAccessToken };
    }
    const refreshToken = decryptToken(deps, userId, 'refresh_token', grant.refreshTokenEnc);
    try {
      const tokens = await requestRefresh(deps, metadata.tokenEndpoint, refreshToken);
      const now = deps.now();
      // The new refresh token replaces the old one in the same transaction: the old one is
      // already dead at SnapTrade, so losing the new one would lock the user out.
      await tx
        .update(snaptradeGrants)
        .set({
          accessTokenEnc: encryptToken(deps, userId, 'access_token', tokens.access_token),
          refreshTokenEnc: encryptToken(deps, userId, 'refresh_token', tokens.refresh_token),
          accessExpiresAt: new Date(now.getTime() + tokens.expires_in * 1000),
          scope: tokens.scope,
          updatedAt: now,
        })
        .where(eq(snaptradeGrants.userId, userId));
      return { kind: 'refreshed', accessToken: tokens.access_token };
    } catch (error) {
      if (!(error instanceof TokenEndpointError) || error.oauthError !== 'invalid_grant') {
        throw new Error('[Tokens] SnapTrade refresh failed', { cause: error });
      }
      // The grant is dead at SnapTrade (revoked, or the user removed our app). Delete it while
      // we still hold its lock, so waiting callers find no grant instead of retrying it.
      await tx.delete(snaptradeGrants).where(eq(snaptradeGrants.userId, userId));
      return { kind: 'grant-revoked' };
    }
  });
  if (outcome.kind === 'grant-revoked') {
    await markNeedsReauth(deps, userId, 'refresh token rejected');
    throw new NeedsReauthError();
  }
  return outcome.accessToken;
}

// The user must sign in with SnapTrade again: no stored tokens, a dashboard banner, and tools
// answer with a reconnect message. Locks the user row first (lock order: users first).
export async function markNeedsReauth(deps: Deps, userId: string, reason: string): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const user = await lockUserRow(tx, userId);
    if (user === null || user.needsReauth) {
      return;
    }
    await tx.delete(snaptradeGrants).where(eq(snaptradeGrants.userId, userId));
    await tx.update(users).set({ needsReauth: true, updatedAt: now }).where(eq(users.id, userId));
    await writeAudit(tx, {
      userId,
      actor: 'system',
      eventType: 'snaptrade.reauth_required',
      details: { reason },
      createdAt: now,
    });
  });
}

async function revokeAtSnapTrade(deps: Deps, refreshToken: string): Promise<boolean> {
  try {
    const metadata = await getSnapTradeMetadata(deps);
    const response = await postToSnapTradeOAuth(deps, metadata.revocationEndpoint, {
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    return response.ok;
  } catch (error) {
    // Handled: we still delete our copy; the page tells the user to remove the app at SnapTrade.
    deps.logger.logError('[Tokens] SnapTrade revocation failed', error);
    return false;
  }
}

// Revokes the refresh token at SnapTrade (which also ends the access token and webhooks), then
// deletes our copy whatever SnapTrade answered.
export async function revokeAndDelete(
  deps: Deps,
  userId: string,
): Promise<{ revokedAtSnapTrade: boolean }> {
  const [grant] = await deps.db
    .select({ refreshTokenEnc: snaptradeGrants.refreshTokenEnc })
    .from(snaptradeGrants)
    .where(eq(snaptradeGrants.userId, userId));
  if (grant === undefined) {
    return { revokedAtSnapTrade: false };
  }
  const refreshToken = decryptToken(deps, userId, 'refresh_token', grant.refreshTokenEnc);
  const revokedAtSnapTrade = await revokeAtSnapTrade(deps, refreshToken);
  await deps.db.delete(snaptradeGrants).where(eq(snaptradeGrants.userId, userId));
  return { revokedAtSnapTrade };
}

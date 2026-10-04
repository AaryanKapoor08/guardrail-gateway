import { eq } from 'drizzle-orm';
import { snaptradeGrants } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { aadFor, decryptField } from '../lib/crypto.js';
import { NeedsReauthError } from '../lib/errors.js';

// The user's SnapTrade access token, decrypted for one API call. No grant, or an expired token,
// means the user has to sign in with SnapTrade again.
export async function getAccessToken(deps: Deps, userId: string): Promise<string> {
  const [grant] = await deps.db
    .select({
      accessTokenEnc: snaptradeGrants.accessTokenEnc,
      accessExpiresAt: snaptradeGrants.accessExpiresAt,
    })
    .from(snaptradeGrants)
    .where(eq(snaptradeGrants.userId, userId));
  if (grant === undefined || grant.accessExpiresAt.getTime() <= deps.now().getTime()) {
    throw new NeedsReauthError();
  }
  return decryptField(
    grant.accessTokenEnc,
    deps.env.TOKEN_ENCRYPTION_KEY,
    aadFor(userId, 'access_token'),
  );
}

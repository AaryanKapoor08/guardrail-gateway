import { and, eq, gt, isNull } from 'drizzle-orm';
import { writeAudit } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { loginAttempts, policies, sessions, snaptradeGrants, users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import {
  aadFor,
  decryptField,
  encryptField,
  pkceChallenge,
  randomToken,
  sha256Hex,
} from '../lib/crypto.js';
import { DEFAULT_POLICY } from '../policy/schema.js';
import { getSnapTradeMetadata } from '../snaptrade/discovery.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  type SignedInIdentity,
  type TokenResponse,
  verifyIdToken,
} from '../snaptrade/oidc.js';
import { createSession } from './sessions.js';

// The SnapTrade sign-in flow (PRODUCT_VISION §4.1). A "login attempt" holds the state, nonce,
// and PKCE verifier for one browser's sign-in, found again by a short-lived cookie.

export const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export type LoginAttempt = {
  readonly idHash: string;
  readonly state: string;
  readonly codeVerifierEnc: string;
  readonly nonce: string;
  readonly returnTo: string | null;
  readonly mcpAuthRequestId: string | null;
};

// Returns the value for the login cookie and the SnapTrade URL to send the browser to.
export async function startLoginAttempt(
  deps: Deps,
  options: { returnTo: string; mcpAuthRequestId: string | null },
): Promise<{ cookieValue: string; authorizeUrl: string }> {
  const metadata = await getSnapTradeMetadata(deps);
  const cookieValue = randomToken(32);
  const idHash = sha256Hex(cookieValue);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(32);
  const now = deps.now();
  await deps.db.insert(loginAttempts).values({
    idHash,
    state,
    codeVerifierEnc: encryptField(
      codeVerifier,
      deps.env.TOKEN_ENCRYPTION_KEY,
      aadFor('login', idHash),
    ),
    nonce,
    returnTo: options.returnTo,
    mcpAuthRequestId: options.mcpAuthRequestId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_TTL_MS),
  });
  const codeChallenge = pkceChallenge(codeVerifier);
  return {
    cookieValue,
    authorizeUrl: buildAuthorizeUrl(deps.env, metadata, { state, nonce, codeChallenge }),
  };
}

// Marks the attempt used in the same statement that finds it, so a callback can only ever be
// processed once, even if two arrive at the same moment. Missing, expired, or used → null.
export async function consumeLoginAttempt(
  deps: Deps,
  cookieValue: string,
): Promise<LoginAttempt | null> {
  const now = deps.now();
  const [attempt] = await deps.db
    .update(loginAttempts)
    .set({ consumedAt: now })
    .where(
      and(
        eq(loginAttempts.idHash, sha256Hex(cookieValue)),
        isNull(loginAttempts.consumedAt),
        gt(loginAttempts.expiresAt, now),
      ),
    )
    .returning({
      idHash: loginAttempts.idHash,
      state: loginAttempts.state,
      codeVerifierEnc: loginAttempts.codeVerifierEnc,
      nonce: loginAttempts.nonce,
      returnTo: loginAttempts.returnTo,
      mcpAuthRequestId: loginAttempts.mcpAuthRequestId,
    });
  return attempt ?? null;
}

async function upsertUser(tx: Transaction, identity: SignedInIdentity, now: Date): Promise<string> {
  // Users are found by SnapTrade's stable `sub`, never by email (V§4.1).
  const [user] = await tx
    .insert(users)
    .values({
      snaptradeSub: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.snaptradeSub,
      set: {
        email: identity.email,
        emailVerified: identity.emailVerified,
        needsReauth: false,
        updatedAt: now,
      },
    })
    .returning({ id: users.id });
  if (user === undefined) {
    throw new Error('[SignIn] user upsert returned no row');
  }
  return user.id;
}

async function saveSnapTradeGrant(
  tx: Transaction,
  deps: Deps,
  grant: { userId: string; tokens: TokenResponse; now: Date },
): Promise<void> {
  const key = deps.env.TOKEN_ENCRYPTION_KEY;
  const values = {
    accessTokenEnc: encryptField(
      grant.tokens.access_token,
      key,
      aadFor(grant.userId, 'access_token'),
    ),
    refreshTokenEnc: encryptField(
      grant.tokens.refresh_token,
      key,
      aadFor(grant.userId, 'refresh_token'),
    ),
    accessExpiresAt: new Date(grant.now.getTime() + grant.tokens.expires_in * 1000),
    scope: grant.tokens.scope,
    updatedAt: grant.now,
  };
  await tx
    .insert(snaptradeGrants)
    .values({ userId: grant.userId, ...values })
    .onConflictDoUpdate({ target: snaptradeGrants.userId, set: values });
}

// Exchanges the code, checks the id_token, then saves the user, their encrypted SnapTrade
// tokens, a default policy, an audit row, and a brand-new session, all in one transaction.
export async function completeSignIn(
  deps: Deps,
  request: { attempt: LoginAttempt; code: string; previousSessionId: string | undefined },
): Promise<{ userId: string; sessionId: string }> {
  const { attempt } = request;
  const metadata = await getSnapTradeMetadata(deps);
  const codeVerifier = decryptField(
    attempt.codeVerifierEnc,
    deps.env.TOKEN_ENCRYPTION_KEY,
    aadFor('login', attempt.idHash),
  );
  const tokens = await exchangeCode(deps, metadata, { code: request.code, codeVerifier });
  const now = deps.now();
  // The id_token is only used here to learn who signed in; it is never stored.
  const identity = await verifyIdToken(tokens.id_token, {
    getKey: deps.idTokenKeys(metadata.jwksUri),
    issuer: metadata.issuer,
    clientId: deps.env.SNAPTRADE_OAUTH_CLIENT_ID,
    nonce: attempt.nonce,
    now,
  });
  return deps.db.transaction(async (tx) => {
    const userId = await upsertUser(tx, identity, now);
    await saveSnapTradeGrant(tx, deps, { userId, tokens, now });
    await tx
      .insert(policies)
      .values({ userId, version: 1, rules: DEFAULT_POLICY, updatedAt: now })
      .onConflictDoNothing();
    await writeAudit(tx, {
      userId,
      actor: 'user',
      eventType: 'user.signed_in',
      details: { scope: tokens.scope },
      createdAt: now,
    });
    // A new session id at every sign-in, so a session id planted before sign-in is useless
    // afterwards (session fixation).
    if (request.previousSessionId !== undefined) {
      await tx.delete(sessions).where(eq(sessions.idHash, sha256Hex(request.previousSessionId)));
    }
    const { sessionId } = await createSession(tx, userId, now);
    return { userId, sessionId };
  });
}

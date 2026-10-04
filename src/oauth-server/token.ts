import { and, eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { writeAudit } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { lockUserRow } from '../db/locks.js';
import { mcpAuthCodes, mcpGrants, mcpTokens } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { pkceChallenge, randomToken, safeEqual, sha256Hex } from '../lib/crypto.js';
import { revokeGrant } from './grants.js';
import { SCOPE_OFFLINE_ACCESS } from './metadata.js';

// POST /oauth/token (V§11.3). Database only, never an outbound call, so it always answers well
// within Claude's 10-second limit. Tokens are 32 random bytes; we store only their SHA-256.

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type TokenErrorCode =
  | 'invalid_request'
  | 'invalid_grant'
  | 'invalid_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target';

export type TokenResponse = {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly scope: string;
};

type TokenOutcome =
  | { readonly ok: true; readonly body: TokenResponse }
  | { readonly ok: false; readonly error: TokenErrorCode; readonly description: string };

function refuse(error: TokenErrorCode, description: string): TokenOutcome {
  return { ok: false, error, description };
}

const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

const AuthorizationCodeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1).max(200),
  redirect_uri: z.string().min(1),
  client_id: z.string().min(1),
  code_verifier: z.string().regex(CODE_VERIFIER),
  resource: z.string().optional(),
});

const RefreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1).max(200),
  client_id: z.string().min(1),
  resource: z.string().optional(),
  scope: z.string().optional(),
});

async function issueTokens(
  tx: Transaction,
  grant: { grantId: string; scope: string; resource: string; now: Date },
): Promise<TokenResponse> {
  const accessToken = randomToken(32);
  const nowMs = grant.now.getTime();
  const common = { grantId: grant.grantId, scope: grant.scope, resource: grant.resource };
  await tx.insert(mcpTokens).values({
    ...common,
    tokenHash: sha256Hex(accessToken),
    kind: 'access',
    expiresAt: new Date(nowMs + ACCESS_TOKEN_TTL_MS),
    createdAt: grant.now,
  });
  const body: TokenResponse = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_MS / 1000,
    scope: grant.scope,
  };
  // A refresh token only if the user's consent covered staying connected (offline_access).
  if (!grant.scope.split(' ').includes(SCOPE_OFFLINE_ACCESS)) {
    return body;
  }
  const refreshToken = randomToken(32);
  await tx.insert(mcpTokens).values({
    ...common,
    tokenHash: sha256Hex(refreshToken),
    kind: 'refresh',
    expiresAt: new Date(nowMs + REFRESH_TOKEN_TTL_MS),
    createdAt: grant.now,
  });
  return { ...body, refresh_token: refreshToken };
}

// A code or refresh token used twice means someone may have stolen it: the whole grant is
// revoked, including tokens already issued from it (OAuth 2.1 guidance).
async function revokeForReuse(
  tx: Transaction,
  reuse: { userId: string; grantId: string; clientHost: string; what: string; now: Date },
): Promise<TokenOutcome> {
  await revokeGrant(tx, reuse.grantId, reuse.now);
  await writeAudit(tx, {
    userId: reuse.userId,
    actor: 'system',
    eventType: 'mcp.grant_revoked',
    details: { clientHost: reuse.clientHost, reason: `${reuse.what} was used twice` },
    createdAt: reuse.now,
  });
  return refuse('invalid_grant', `This ${reuse.what} was already used.`);
}

type CodeGrant = z.infer<typeof AuthorizationCodeGrantSchema>;

async function lockCode(tx: Transaction, codeHash: string) {
  const [row] = await tx
    .select({
      grantId: mcpAuthCodes.grantId,
      redirectUri: mcpAuthCodes.redirectUri,
      codeChallenge: mcpAuthCodes.codeChallenge,
      scope: mcpAuthCodes.scope,
      resource: mcpAuthCodes.resource,
      expiresAt: mcpAuthCodes.expiresAt,
      usedAt: mcpAuthCodes.usedAt,
      userId: mcpGrants.userId,
      clientId: mcpGrants.clientId,
      clientHost: mcpGrants.clientHost,
      grantRevokedAt: mcpGrants.revokedAt,
    })
    .from(mcpAuthCodes)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpAuthCodes.grantId))
    .where(eq(mcpAuthCodes.codeHash, codeHash))
    .for('update');
  return row ?? null;
}

type LockedCode = NonNullable<Awaited<ReturnType<typeof lockCode>>>;

// Every check of V§11.3 for a code that exists and wasn't used before.
function checkCode(row: LockedCode, grant: CodeGrant, now: Date): TokenOutcome | null {
  if (row.expiresAt <= now || row.grantRevokedAt !== null) {
    return refuse('invalid_grant', 'The authorization code has expired.');
  }
  if (row.clientId !== grant.client_id || row.redirectUri !== grant.redirect_uri) {
    return refuse('invalid_grant', 'The code was issued to a different client or redirect URI.');
  }
  if (grant.resource !== undefined && grant.resource !== row.resource) {
    return refuse('invalid_target', 'The resource does not match the authorization request.');
  }
  if (!safeEqual(pkceChallenge(grant.code_verifier), row.codeChallenge)) {
    return refuse('invalid_grant', 'The code_verifier does not match the code_challenge.');
  }
  return null;
}

async function exchangeCode(deps: Deps, grant: CodeGrant): Promise<TokenOutcome> {
  const codeHash = sha256Hex(grant.code);
  // Found without a lock first, only to learn whose user row to lock (lock order: users first).
  const [owner] = await deps.db
    .select({ userId: mcpGrants.userId })
    .from(mcpAuthCodes)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpAuthCodes.grantId))
    .where(eq(mcpAuthCodes.codeHash, codeHash));
  if (owner === undefined) {
    return refuse('invalid_grant', 'The authorization code is invalid.');
  }
  return deps.db.transaction(async (tx) => {
    await lockUserRow(tx, owner.userId);
    const now = deps.now();
    const row = await lockCode(tx, codeHash);
    if (row === null) {
      return refuse('invalid_grant', 'The authorization code is invalid.');
    }
    if (row.usedAt !== null) {
      return revokeForReuse(tx, { ...row, what: 'authorization code', now });
    }
    const problem = checkCode(row, grant, now);
    if (problem !== null) {
      return problem;
    }
    await tx.update(mcpAuthCodes).set({ usedAt: now }).where(eq(mcpAuthCodes.codeHash, codeHash));
    const body = await issueTokens(tx, { ...row, now });
    return { ok: true, body };
  });
}

type RefreshGrant = z.infer<typeof RefreshTokenGrantSchema>;

async function lockRefreshToken(tx: Transaction, tokenHash: string) {
  const [row] = await tx
    .select({
      grantId: mcpTokens.grantId,
      scope: mcpTokens.scope,
      resource: mcpTokens.resource,
      expiresAt: mcpTokens.expiresAt,
      usedAt: mcpTokens.usedAt,
      revokedAt: mcpTokens.revokedAt,
      userId: mcpGrants.userId,
      clientId: mcpGrants.clientId,
      clientHost: mcpGrants.clientHost,
      grantRevokedAt: mcpGrants.revokedAt,
    })
    .from(mcpTokens)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
    .where(and(eq(mcpTokens.tokenHash, tokenHash), eq(mcpTokens.kind, 'refresh')))
    .for('update');
  return row ?? null;
}

type LockedRefreshToken = NonNullable<Awaited<ReturnType<typeof lockRefreshToken>>>;

function checkRefreshToken(
  row: LockedRefreshToken,
  grant: RefreshGrant,
  now: Date,
): TokenOutcome | null {
  if (row.revokedAt !== null || row.grantRevokedAt !== null || row.expiresAt <= now) {
    return refuse('invalid_grant', 'The refresh token has expired or was revoked.');
  }
  if (row.clientId !== grant.client_id) {
    return refuse('invalid_grant', 'The refresh token was issued to a different client.');
  }
  if (grant.resource !== undefined && grant.resource !== row.resource) {
    return refuse('invalid_target', 'The resource does not match the original grant.');
  }
  const grantedScopes = row.scope.split(' ');
  const requestedScopes = (grant.scope ?? '').split(' ').filter((scope) => scope !== '');
  if (!requestedScopes.every((scope) => grantedScopes.includes(scope))) {
    return refuse('invalid_scope', 'A refresh cannot add scopes.');
  }
  return null;
}

// Rotation: the old refresh token is marked used and a new pair issued in one transaction.
async function rotateRefreshToken(deps: Deps, grant: RefreshGrant): Promise<TokenOutcome> {
  const tokenHash = sha256Hex(grant.refresh_token);
  const [owner] = await deps.db
    .select({ userId: mcpGrants.userId })
    .from(mcpTokens)
    .innerJoin(mcpGrants, eq(mcpGrants.id, mcpTokens.grantId))
    .where(and(eq(mcpTokens.tokenHash, tokenHash), eq(mcpTokens.kind, 'refresh')));
  if (owner === undefined) {
    return refuse('invalid_grant', 'The refresh token is invalid.');
  }
  return deps.db.transaction(async (tx) => {
    await lockUserRow(tx, owner.userId);
    const now = deps.now();
    const row = await lockRefreshToken(tx, tokenHash);
    if (row === null) {
      return refuse('invalid_grant', 'The refresh token is invalid.');
    }
    if (row.usedAt !== null) {
      return revokeForReuse(tx, { ...row, what: 'refresh token', now });
    }
    const problem = checkRefreshToken(row, grant, now);
    if (problem !== null) {
      return problem;
    }
    await tx.update(mcpTokens).set({ usedAt: now }).where(eq(mcpTokens.tokenHash, tokenHash));
    const body = await issueTokens(tx, { ...row, now });
    return { ok: true, body };
  });
}

// Form fields, refusing any field sent twice (RFC 6749 §3.2).
export function parseOAuthForm(text: string): Record<string, string> | null {
  const params = new URLSearchParams(text);
  const fields: Record<string, string> = {};
  for (const [name, value] of params) {
    if (name in fields) {
      return null;
    }
    fields[name] = value;
  }
  return fields;
}

export function isFormEncoded(c: Context): boolean {
  const contentType = c.req.header('content-type') ?? '';
  return contentType.split(';')[0]?.trim().toLowerCase() === 'application/x-www-form-urlencoded';
}

async function handleTokenRequest(deps: Deps, fields: Record<string, string>) {
  if (fields.grant_type === 'authorization_code') {
    const grant = AuthorizationCodeGrantSchema.safeParse(fields);
    return grant.success
      ? exchangeCode(deps, grant.data)
      : refuse('invalid_request', 'Missing or malformed parameters for authorization_code.');
  }
  if (fields.grant_type === 'refresh_token') {
    const grant = RefreshTokenGrantSchema.safeParse(fields);
    return grant.success
      ? rotateRefreshToken(deps, grant.data)
      : refuse('invalid_request', 'Missing or malformed parameters for refresh_token.');
  }
  return fields.grant_type === undefined
    ? refuse('invalid_request', 'grant_type is required.')
    : refuse('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
}

async function token(deps: Deps, c: Context): Promise<Response> {
  // Tokens must never be stored by a cache or proxy.
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  c.header('Access-Control-Allow-Origin', '*');
  if (!isFormEncoded(c)) {
    return c.json(
      { error: 'invalid_request', error_description: 'Send the request as a form.' },
      415,
    );
  }
  const fields = parseOAuthForm(await c.req.text());
  const outcome =
    fields === null
      ? refuse('invalid_request', 'A parameter was sent more than once.')
      : await handleTokenRequest(deps, fields);
  if (!outcome.ok) {
    return c.json({ error: outcome.error, error_description: outcome.description }, 400);
  }
  return c.json(outcome.body);
}

export function registerTokenRoutes(app: Hono, deps: Deps): void {
  app.post('/oauth/token', (c) => token(deps, c));
}

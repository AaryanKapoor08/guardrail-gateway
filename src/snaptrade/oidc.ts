import { type JWTVerifyGetKey, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Deps } from '../deps.js';
import type { SnapTradeMetadata } from './discovery.js';

// "Sign in with SnapTrade": OpenID Connect with PKCE, state, and nonce (PRODUCT_VISION §4.1).

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

// `read` is always required by SnapTrade. `trade` only once SnapTrade has enabled it for our
// app, because an unapproved scope makes SnapTrade reject the whole sign-in (V§0 G19).
export function requestedScopes(env: Env): string {
  const scopes = ['openid', 'email', 'read', 'webhook'];
  if (env.SNAPTRADE_REQUEST_TRADE_SCOPE) {
    scopes.push('trade');
  }
  return scopes.join(' ');
}

export function buildAuthorizeUrl(
  env: Env,
  metadata: SnapTradeMetadata,
  request: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(metadata.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.SNAPTRADE_OAUTH_CLIENT_ID,
    redirect_uri: env.SNAPTRADE_REDIRECT_URI,
    scope: requestedScopes(env),
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

// The token endpoint answers with an OAuth error code like `invalid_grant`. We keep only that
// code (a short fixed word), never the rest of the body.
export class TokenEndpointError extends Error {
  override readonly name = 'TokenEndpointError';
  readonly status: number;
  readonly oauthError: string | null;

  constructor(status: number, oauthError: string | null) {
    super(`[OIDC] SnapTrade token endpoint returned status ${status} (${oauthError ?? 'no code'})`);
    this.status = status;
    this.oauthError = oauthError;
  }
}

export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
  scope: z.string(),
  // Present on the code exchange only; refresh responses never include one (V§5.1).
  id_token: z.string().min(1).optional(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const OAuthErrorBodySchema = z.object({ error: z.string().regex(/^[a-z_]{1,64}$/) });

async function readOAuthErrorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = OAuthErrorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error : null;
}

// RFC 6749 §2.3.1: the client id and secret are form-encoded before being joined and base64'd.
function clientBasicAuth(env: Env): string {
  const id = encodeURIComponent(env.SNAPTRADE_OAUTH_CLIENT_ID);
  const secret = encodeURIComponent(env.SNAPTRADE_OAUTH_CLIENT_SECRET);
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

// POSTs a form to one of SnapTrade's OAuth endpoints with our client credentials.
export function postToSnapTradeOAuth(
  deps: Deps,
  endpoint: string,
  form: Record<string, string>,
): Promise<Response> {
  return deps.fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: clientBasicAuth(deps.env),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
  });
}

export async function requestTokens(
  deps: Deps,
  tokenEndpoint: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const response = await postToSnapTradeOAuth(deps, tokenEndpoint, form);
  if (!response.ok) {
    throw new TokenEndpointError(response.status, await readOAuthErrorCode(response));
  }
  const parsed = TokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('[OIDC] SnapTrade token response is missing fields we need');
  }
  return parsed.data;
}

export async function exchangeCode(
  deps: Deps,
  metadata: SnapTradeMetadata,
  request: { code: string; codeVerifier: string },
): Promise<TokenResponse & { id_token: string }> {
  const tokens = await requestTokens(deps, metadata.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: request.code,
    redirect_uri: deps.env.SNAPTRADE_REDIRECT_URI,
    code_verifier: request.codeVerifier,
  });
  if (tokens.id_token === undefined) {
    throw new Error('[OIDC] SnapTrade code exchange returned no id_token');
  }
  return { ...tokens, id_token: tokens.id_token };
}

const IdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  nonce: z.string(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
});

export type SignedInIdentity = {
  readonly sub: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
};

export async function verifyIdToken(
  idToken: string,
  check: {
    getKey: JWTVerifyGetKey;
    issuer: string;
    clientId: string;
    nonce: string;
    now: Date;
  },
): Promise<SignedInIdentity> {
  const { payload } = await jwtVerify(idToken, check.getKey, {
    issuer: check.issuer,
    audience: check.clientId,
    algorithms: ['RS256'],
    maxTokenAge: '10m',
    currentDate: check.now,
  });
  const claims = IdTokenClaimsSchema.safeParse(payload);
  if (!claims.success) {
    throw new Error('[OIDC] id_token is missing required claims');
  }
  // The nonce ties this id_token to the sign-in this browser started, so a token captured from
  // another sign-in can't be replayed here.
  if (claims.data.nonce !== check.nonce) {
    throw new Error('[OIDC] id_token nonce does not match this sign-in');
  }
  return {
    sub: claims.data.sub,
    email: claims.data.email ?? null,
    emailVerified: claims.data.email_verified === true,
  };
}

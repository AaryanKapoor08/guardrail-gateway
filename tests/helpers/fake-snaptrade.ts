import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, type JSONWebKeySet, type JWTPayload, SignJWT } from 'jose';
import { pkceChallenge } from '../../src/lib/crypto.js';
import { buildDefaultBrokerage, type FakeBrokerage } from './snaptrade-data.js';

// A programmable stand-in for SnapTrade, injected as `deps.fetch`. It serves the discovery
// documents, the OAuth token and revocation endpoints (with refresh-token rotation and call
// counters), and the data API. No test ever reaches the real SnapTrade.

export const FAKE_ISSUER = 'https://api.snaptrade.com';
export const FAKE_API_BASE = 'https://api.snaptrade.com';
const AUTHORIZE_ENDPOINT = 'https://dashboard.snaptrade.com/oauth/authorize';
const TOKEN_ENDPOINT = `${FAKE_ISSUER}/oauth/token/`;
const REVOCATION_ENDPOINT = `${FAKE_ISSUER}/oauth/revoke_token/`;
const JWKS_URI = `${FAKE_ISSUER}/.well-known/jwks.json`;
const KEY_ID = 'fake-key-1';

export type RecordedRequest = {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;
};

export type FakeResponse = {
  // 0 simulates a network failure: fetch throws instead of answering.
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
};

export type AuthorizeOptions = {
  readonly sub?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  // Overrides for id_token claims, to test bad aud / iss / nonce.
  readonly idTokenClaims?: JWTPayload;
  readonly signWithUnknownKey?: boolean;
};

type IssuedCode = {
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly nonce: string;
  readonly options: AuthorizeOptions;
};

export type ApiHandler = (request: RecordedRequest) => FakeResponse;

type ApiRoute = { readonly method: string; readonly pattern: RegExp; readonly handler: ApiHandler };

export type FakeSnapTrade = {
  readonly fetch: typeof fetch;
  readonly jwks: JSONWebKeySet;
  readonly requests: RecordedRequest[];
  readonly countRequests: (pathname: string, method?: string) => number;
  // Simulates the user approving on SnapTrade's consent screen; returns the code for the callback.
  readonly authorize: (authorizeUrl: string, options?: AuthorizeOptions) => string;
  readonly failNextTokenRequest: (response: FakeResponse) => void;
  readonly failNextRevocation: (response: FakeResponse) => void;
  // Every access token issued so far stops working (SnapTrade would answer 401).
  readonly invalidateAccessTokens: () => void;
  readonly currentRefreshTokens: () => string[];
  readonly onApi: (method: string, pattern: RegExp, handler: ApiHandler) => void;
  // The next `times` API calls matching the pattern get this response instead.
  readonly failApi: (pattern: RegExp, response: FakeResponse, times?: number) => void;
  // Documents on other hosts the app fetches (an MCP client's metadata document): URL -> answer.
  readonly serveExternal: (url: string, response: FakeResponse) => void;
  tokenDelayMs: number;
  // The data the API serves. Tests change it to simulate what the user has at their brokerage.
  brokerage: FakeBrokerage;
};

function jsonResponse(response: FakeResponse): Response {
  return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
    status: response.status,
    headers: { 'content-type': 'application/json', ...response.headers },
  });
}

function parseBasicAuth(header: string | null): { id: string; secret: string } | null {
  if (header === null || !header.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const [id, secret] = decoded.split(':').map((part) => decodeURIComponent(part));
  return id === undefined || secret === undefined ? null : { id, secret };
}

function newToken(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const NOT_FOUND: FakeResponse = { status: 404, body: { detail: 'Account not found' } };

// `/accounts/<id>/quotes` -> '<id>', if that account exists at the fake brokerage.
function knownAccountId(fake: FakeSnapTrade, request: RecordedRequest): string | null {
  const accountId = request.url.pathname.split('/')[2] ?? '';
  return fake.brokerage.accounts.some((account) => account.id === accountId) ? accountId : null;
}

function searchSymbols(fake: FakeSnapTrade, request: RecordedRequest): FakeResponse {
  const parsed: unknown = JSON.parse(request.body);
  const substring =
    typeof parsed === 'object' && parsed !== null && 'substring' in parsed
      ? String(parsed.substring).toUpperCase()
      : '';
  const matches = fake.brokerage.symbols.filter(
    (symbol) => symbol.symbol.includes(substring) || symbol.raw_symbol.includes(substring),
  );
  return { status: 200, body: matches.slice(0, 20) };
}

function quoteSymbols(fake: FakeSnapTrade, request: RecordedRequest): FakeResponse {
  const ids = (request.url.searchParams.get('symbols') ?? '').split(',');
  const quotes = ids.flatMap((id) => {
    const quote = fake.brokerage.quotes[id];
    const symbol = fake.brokerage.symbols.find((candidate) => candidate.id === id);
    if (quote === undefined || symbol === undefined) {
      return [];
    }
    return [
      {
        symbol,
        last_trade_price: quote.last,
        bid_price: quote.bid,
        ask_price: quote.ask,
        bid_size: 100,
        ask_size: 100,
      },
    ];
  });
  return { status: 200, body: quotes };
}

// Positions, balances, symbol search, and quotes for the accounts in `fake.brokerage` (P8).
function registerAccountDataRoutes(fake: FakeSnapTrade): void {
  const forKnownAccount =
    (handler: (accountId: string, request: RecordedRequest) => FakeResponse): ApiHandler =>
    (request) => {
      const accountId = knownAccountId(fake, request);
      return accountId === null ? NOT_FOUND : handler(accountId, request);
    };
  fake.onApi(
    'GET',
    /^\/accounts\/[^/]+\/positions\/all$/,
    forKnownAccount((accountId) => ({
      status: 200,
      body: { results: fake.brokerage.positions[accountId] ?? [] },
    })),
  );
  fake.onApi(
    'GET',
    /^\/accounts\/[^/]+\/balances$/,
    forKnownAccount((accountId) => ({
      status: 200,
      body: (fake.brokerage.balances[accountId] ?? []).map((balance) => ({
        currency: { code: balance.currency, name: balance.currency },
        cash: balance.cash,
        buying_power: balance.buying_power,
      })),
    })),
  );
  fake.onApi(
    'POST',
    /^\/accounts\/[^/]+\/symbols$/,
    forKnownAccount((_accountId, request) => searchSymbols(fake, request)),
  );
  fake.onApi(
    'GET',
    /^\/accounts\/[^/]+\/quotes$/,
    forKnownAccount((_accountId, request) => quoteSymbols(fake, request)),
  );
}

export async function createFakeSnapTrade(options: {
  clientId: string;
  clientSecret: string;
  now: () => Date;
}): Promise<FakeSnapTrade> {
  const signingKeys = await generateKeyPair('RS256', { extractable: true });
  const unknownKeys = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(signingKeys.publicKey)), kid: KEY_ID, alg: 'RS256' };
  const jwks: JSONWebKeySet = { keys: [publicJwk] };

  const requests: RecordedRequest[] = [];
  const codes = new Map<string, IssuedCode>();
  const accessTokens = new Set<string>();
  // refresh token -> sub. Using a refresh token removes it (rotation).
  const refreshTokens = new Map<string, string>();
  const tokenFailures: FakeResponse[] = [];
  const revocationFailures: FakeResponse[] = [];
  const apiRoutes: ApiRoute[] = [];
  const apiFailures: { pattern: RegExp; response: FakeResponse; remaining: number }[] = [];
  const externalResponses = new Map<string, FakeResponse>();

  const fake: FakeSnapTrade = {
    fetch: handleFetch,
    jwks,
    requests,
    countRequests: (pathname, method) =>
      requests.filter(
        (request) =>
          request.url.pathname === pathname && (method === undefined || request.method === method),
      ).length,
    authorize,
    failNextTokenRequest: (response) => {
      tokenFailures.push(response);
    },
    failNextRevocation: (response) => {
      revocationFailures.push(response);
    },
    invalidateAccessTokens: () => accessTokens.clear(),
    currentRefreshTokens: () => [...refreshTokens.keys()],
    onApi: (method, pattern, handler) => {
      apiRoutes.unshift({ method, pattern, handler });
    },
    failApi: (pattern, response, times = 1) => {
      apiFailures.push({ pattern, response, remaining: times });
    },
    serveExternal: (url, response) => {
      externalResponses.set(url, response);
    },
    tokenDelayMs: 0,
    brokerage: buildDefaultBrokerage(),
  };

  fake.onApi('GET', /^\/authorizations$/, () => ({
    status: 200,
    body: fake.brokerage.connections,
  }));
  fake.onApi('GET', /^\/accounts$/, () => ({ status: 200, body: fake.brokerage.accounts }));
  registerAccountDataRoutes(fake);

  function authorize(authorizeUrl: string, authorizeOptions: AuthorizeOptions = {}): string {
    const params = new URL(authorizeUrl).searchParams;
    const code = newToken('code');
    codes.set(code, {
      codeChallenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      nonce: params.get('nonce') ?? '',
      options: authorizeOptions,
    });
    return code;
  }

  async function mintIdToken(issued: IssuedCode, sub: string): Promise<string> {
    const nowSeconds = Math.floor(options.now().getTime() / 1000);
    const claims: JWTPayload = {
      iss: FAKE_ISSUER,
      aud: options.clientId,
      sub,
      nonce: issued.nonce,
      email: issued.options.email ?? 'test.user@example.com',
      email_verified: issued.options.emailVerified ?? true,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      auth_time: nowSeconds,
      ...issued.options.idTokenClaims,
    };
    const key = issued.options.signWithUnknownKey ? unknownKeys.privateKey : signingKeys.privateKey;
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: KEY_ID }).sign(key);
  }

  function issueTokens(sub: string): { access_token: string; refresh_token: string } {
    const accessToken = newToken('access');
    const refreshToken = newToken('refresh');
    accessTokens.add(accessToken);
    refreshTokens.set(refreshToken, sub);
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  function tokenBody(tokens: { access_token: string; refresh_token: string }) {
    return {
      ...tokens,
      expires_in: 36000,
      token_type: 'Bearer',
      scope: 'openid email read webhook',
    };
  }

  async function exchangeCode(form: URLSearchParams): Promise<FakeResponse> {
    const code = form.get('code') ?? '';
    const issued = codes.get(code);
    codes.delete(code);
    if (issued === undefined || form.get('redirect_uri') !== issued.redirectUri) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    if (pkceChallenge(form.get('code_verifier') ?? '') !== issued.codeChallenge) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    const sub = issued.options.sub ?? 'snaptrade-user-1';
    const tokens = issueTokens(sub);
    return {
      status: 200,
      body: { ...tokenBody(tokens), id_token: await mintIdToken(issued, sub) },
    };
  }

  function refresh(form: URLSearchParams): FakeResponse {
    const refreshToken = form.get('refresh_token') ?? '';
    const sub = refreshTokens.get(refreshToken);
    if (sub === undefined) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    refreshTokens.delete(refreshToken);
    return { status: 200, body: tokenBody(issueTokens(sub)) };
  }

  async function handleTokenRequest(request: RecordedRequest): Promise<FakeResponse> {
    await wait(fake.tokenDelayMs);
    const credentials = parseBasicAuth(request.headers.get('authorization'));
    if (credentials?.id !== options.clientId || credentials.secret !== options.clientSecret) {
      return { status: 401, body: { error: 'invalid_client' } };
    }
    const failure = tokenFailures.shift();
    if (failure !== undefined) {
      return failure;
    }
    const form = new URLSearchParams(request.body);
    if (form.get('grant_type') === 'authorization_code') {
      return exchangeCode(form);
    }
    if (form.get('grant_type') === 'refresh_token') {
      return refresh(form);
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  function handleRevocation(request: RecordedRequest): FakeResponse {
    const failure = revocationFailures.shift();
    if (failure !== undefined) {
      return failure;
    }
    const form = new URLSearchParams(request.body);
    refreshTokens.delete(form.get('token') ?? '');
    return { status: 200 };
  }

  function handleApiRequest(request: RecordedRequest): FakeResponse {
    const authorization = request.headers.get('authorization') ?? '';
    if (!accessTokens.has(authorization.replace(/^Bearer /, ''))) {
      return { status: 401, body: { detail: 'Invalid token' } };
    }
    const path = request.url.pathname;
    const failure = apiFailures.find((entry) => entry.remaining > 0 && entry.pattern.test(path));
    if (failure !== undefined) {
      failure.remaining -= 1;
      return failure.response;
    }
    const route = apiRoutes.find(
      (candidate) => candidate.method === request.method && candidate.pattern.test(path),
    );
    return route === undefined
      ? { status: 404, body: { detail: 'Not found' } }
      : route.handler(request);
  }

  async function route(request: RecordedRequest): Promise<FakeResponse> {
    const url = request.url.toString();
    if (url === `${FAKE_ISSUER}/.well-known/oauth-authorization-server`) {
      return {
        status: 200,
        body: {
          issuer: FAKE_ISSUER,
          authorization_endpoint: AUTHORIZE_ENDPOINT,
          token_endpoint: TOKEN_ENDPOINT,
          revocation_endpoint: REVOCATION_ENDPOINT,
          token_endpoint_auth_methods_supported: [
            'client_secret_basic',
            'client_secret_post',
            'none',
          ],
        },
      };
    }
    if (url === `${FAKE_ISSUER}/.well-known/openid-configuration`) {
      return { status: 200, body: { issuer: FAKE_ISSUER, jwks_uri: JWKS_URI } };
    }
    if (url === JWKS_URI) {
      return { status: 200, body: jwks };
    }
    if (url === TOKEN_ENDPOINT && request.method === 'POST') {
      return handleTokenRequest(request);
    }
    if (url === REVOCATION_ENDPOINT && request.method === 'POST') {
      return handleRevocation(request);
    }
    if (url.startsWith(FAKE_API_BASE)) {
      return handleApiRequest(request);
    }
    const external = externalResponses.get(url);
    if (external !== undefined) {
      return external;
    }
    throw new TypeError(`fake SnapTrade: no route for ${request.method} ${url}`);
  }

  async function handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const recorded: RecordedRequest = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: await request.text(),
    };
    requests.push(recorded);
    const response = await route(recorded);
    if (response.status === 0) {
      throw new TypeError('fetch failed (simulated network error)');
    }
    return jsonResponse(response);
  }

  return fake;
}

import { pkceChallenge } from '../../src/lib/crypto.js';
import { getPage, postForm, type SignedInTestUser, TEST_ORIGIN, type TestApp } from './app.js';

// Builders for the MCP OAuth flow: a fake Claude (its CIMD document served by the injected
// fetch), authorization URLs, and the full "connect Claude" dance.

export const CLAUDE_CLIENT_ID = 'https://claude.ai/oauth/claude-client-metadata';
export const CLAUDE_REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
export const CLAUDE_CODE_CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
export const CLAUDE_CODE_REDIRECT_URI = 'http://localhost/callback';
export const MCP_RESOURCE = `${TEST_ORIGIN}/mcp`;
// 43 characters, the shortest verifier RFC 7636 allows.
export const CODE_VERIFIER = 'verifier-0123456789-abcdefghijklmnopqrstuvw';
export const STATE = 'state-from-claude';

export function claudeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLAUDE_CLIENT_ID,
    client_name: 'Claude',
    redirect_uris: [CLAUDE_REDIRECT_URI],
    token_endpoint_auth_method: 'none',
    ...overrides,
  };
}

export function serveClaudeMetadata(testApp: TestApp): void {
  testApp.fake.serveExternal(CLAUDE_CLIENT_ID, {
    status: 200,
    body: claudeMetadata(),
    headers: { 'cache-control': 'max-age=3600' },
  });
  testApp.fake.serveExternal(CLAUDE_CODE_CLIENT_ID, {
    status: 200,
    body: {
      client_id: CLAUDE_CODE_CLIENT_ID,
      client_name: 'Claude Code',
      redirect_uris: [CLAUDE_CODE_REDIRECT_URI, 'http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
}

export function authorizePath(overrides: Record<string, string | undefined> = {}): string {
  const parameters: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLAUDE_CLIENT_ID,
    redirect_uri: CLAUDE_REDIRECT_URI,
    state: STATE,
    code_challenge: pkceChallenge(CODE_VERIFIER),
    code_challenge_method: 'S256',
    resource: MCP_RESOURCE,
    scope: 'mcp offline_access',
    ...overrides,
  };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      query.set(name, value);
    }
  }
  return `/oauth/authorize?${query.toString()}`;
}

export function locationOf(response: Response): URL {
  return new URL(response.headers.get('location') ?? '', TEST_ORIGIN);
}

// A signed-in user opens the authorize link and lands on the consent page; returns the
// pending request id.
export async function openConsent(
  testApp: TestApp,
  user: SignedInTestUser,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const response = await getPage(testApp, authorizePath(overrides), user.cookie);
  const location = locationOf(response);
  if (response.status !== 302 || location.pathname !== '/oauth/authorize/resume') {
    throw new Error(`test setup: /oauth/authorize answered ${response.status}`);
  }
  return location.searchParams.get('request') ?? '';
}

export function decide(
  testApp: TestApp,
  user: SignedInTestUser,
  request: { requestId: string; decision: 'approve' | 'deny' },
): Promise<Response> {
  return postForm(testApp, '/oauth/authorize/decision', {
    cookie: user.cookie,
    form: { csrf: user.csrfToken, request: request.requestId, decision: request.decision },
  });
}

// Consent → the code Claude would receive on its callback.
export async function approveAndGetCode(
  testApp: TestApp,
  user: SignedInTestUser,
  overrides: Record<string, string | undefined> = {},
): Promise<string> {
  const requestId = await openConsent(testApp, user, overrides);
  const response = await decide(testApp, user, { requestId, decision: 'approve' });
  const code = locationOf(response).searchParams.get('code');
  if (code === null) {
    throw new Error(`test setup: consent answered ${response.status} without a code`);
  }
  return code;
}

export function postToken(testApp: TestApp, fields: Record<string, string>): Promise<Response> {
  return Promise.resolve(
    testApp.app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
  );
}

export function exchangeCode(
  testApp: TestApp,
  code: string,
  overrides: Record<string, string> = {},
): Promise<Response> {
  return postToken(testApp, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: CLAUDE_REDIRECT_URI,
    client_id: CLAUDE_CLIENT_ID,
    code_verifier: CODE_VERIFIER,
    resource: MCP_RESOURCE,
    ...overrides,
  });
}

export type IssuedTokens = { access_token: string; refresh_token?: string; scope: string };

// The whole flow for a signed-in user: consent, code, token. What Claude ends up holding.
export async function connectClaude(
  testApp: TestApp,
  user: SignedInTestUser,
): Promise<IssuedTokens> {
  serveClaudeMetadata(testApp);
  const code = await approveAndGetCode(testApp, user);
  const response = await exchangeCode(testApp, code);
  if (response.status !== 200) {
    throw new Error(`test setup: token endpoint answered ${response.status}`);
  }
  return (await response.json()) as IssuedTokens;
}

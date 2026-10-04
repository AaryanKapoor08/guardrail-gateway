import type { Env } from '../config/env.js';
import { mcpResourceUrl, SCOPE_MCP, SUPPORTED_SCOPES } from './metadata.js';

// V§11.3 step 5: the authorization request's own parameters. These are checked only after the
// client and its redirect URI are known to be genuine, so problems here are sent back to the
// app as an OAuth error redirect.

export type AuthorizeErrorCode =
  | 'invalid_request'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied';

export type CheckedParameters = {
  readonly state: string;
  readonly codeChallenge: string;
  // Space-separated, always including "mcp".
  readonly scope: string;
  readonly resource: string;
};

export type ParameterCheck =
  | { readonly ok: true; readonly parameters: CheckedParameters }
  | { readonly ok: false; readonly error: AuthorizeErrorCode; readonly description: string };

// RFC 7636: a base64url SHA-256 is 43 characters.
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const MAX_STATE_LENGTH = 512;

function problem(error: AuthorizeErrorCode, description: string): ParameterCheck {
  return { ok: false, error, description };
}

// No scope means "mcp". The token is useless without "mcp", so it is always granted;
// "offline_access" adds a refresh token. Anything else is refused.
function grantedScope(requested: string | undefined): string | null {
  const scopes = (requested ?? '').split(' ').filter((scope) => scope !== '');
  const isSupported = (scope: string) => (SUPPORTED_SCOPES as readonly string[]).includes(scope);
  if (!scopes.every(isSupported)) {
    return null;
  }
  return SUPPORTED_SCOPES.filter((scope) => scope === SCOPE_MCP || scopes.includes(scope)).join(
    ' ',
  );
}

export function checkAuthorizeParameters(
  env: Env,
  query: Readonly<Record<string, string | undefined>>,
): ParameterCheck {
  if (query.response_type !== 'code') {
    return problem('unsupported_response_type', 'response_type must be code.');
  }
  if (query.state === undefined || query.state === '' || query.state.length > MAX_STATE_LENGTH) {
    return problem('invalid_request', 'state is required.');
  }
  if (query.code_challenge_method !== 'S256') {
    return problem('invalid_request', 'PKCE with code_challenge_method S256 is required.');
  }
  if (query.code_challenge === undefined || !S256_CHALLENGE.test(query.code_challenge)) {
    return problem('invalid_request', 'code_challenge is missing or malformed.');
  }
  if (query.resource !== mcpResourceUrl(env)) {
    return problem('invalid_target', `resource must be ${mcpResourceUrl(env)}.`);
  }
  const scope = grantedScope(query.scope);
  if (scope === null) {
    return problem('invalid_scope', 'Only the scopes mcp and offline_access are supported.');
  }
  return {
    ok: true,
    parameters: {
      state: query.state,
      codeChallenge: query.code_challenge,
      scope,
      resource: query.resource,
    },
  };
}

// Where the browser goes back to the app: the registered redirect URI plus our parameters, and
// always `iss` (RFC 9207) so the app can tell which server answered.
export function redirectBackUrl(
  env: Env,
  redirectUri: string,
  parameters: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  url.searchParams.set('iss', env.APP_BASE_URL);
  return url.toString();
}

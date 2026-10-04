import { describe, expect, it } from 'vitest';
import { checkClientIdUrl, redirectUriAllowed } from '../../src/oauth-server/cimd.js';
import { buildTestEnv } from '../helpers/env.js';

describe('redirectUriAllowed', () => {
  it.each([
    ['an exact match', 'https://claude.ai/api/mcp/auth_callback', true],
    ['a loopback URI on another port', 'http://localhost:53682/callback', true],
    ['127.0.0.1 on another port', 'http://127.0.0.1:8080/callback', true],
    ['a loopback URI with another path', 'http://localhost:53682/other', false],
    ['a loopback URI with another scheme', 'https://localhost:53682/callback', false],
    ['localhost.evil.com', 'http://localhost.evil.com:53682/callback', false],
    ['a non-loopback host on another port', 'https://claude.ai:8443/api/mcp/auth_callback', false],
    ['an extra query', 'https://claude.ai/api/mcp/auth_callback?x=1', false],
    ['not a URL', 'not a url', false],
  ])('%s → %s', (_case, requested, expected) => {
    const registered = [
      'https://claude.ai/api/mcp/auth_callback',
      'http://localhost/callback',
      'http://127.0.0.1/callback',
    ];

    expect(redirectUriAllowed(requested, registered)).toBe(expected);
  });
});

describe('checkClientIdUrl', () => {
  const env = buildTestEnv();

  it.each([
    ['https://claude.ai/oauth/claude-client-metadata', true],
    ['http://claude.ai/oauth/claude-client-metadata', false],
    ['https://claude.ai/', false],
    ['https://claude.ai.evil.com/metadata', false],
    ['https://user:pass@claude.ai/metadata', false],
    ['https://claude.ai:8443/metadata', false],
  ])('%s → %s', (clientId, expected) => {
    expect(checkClientIdUrl(env, clientId).ok).toBe(expected);
  });
});

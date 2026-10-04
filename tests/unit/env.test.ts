import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { buildEnvSource } from '../helpers/env.js';

function loadEnvError(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected loadEnv to throw');
}

describe('loadEnv', () => {
  it('parses a complete, valid environment', () => {
    const env = loadEnv(buildEnvSource());

    expect(env.PORT).toBe(3000);
    expect(env.TOKEN_ENCRYPTION_KEY).toHaveLength(32);
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.LIVE_TRADING_PAPER_ACCOUNTS_ONLY).toBe(true);
  });

  it('applies safe defaults for optional settings', () => {
    const env = loadEnv(
      buildEnvSource({
        LOG_LEVEL: undefined,
        SNAPTRADE_REQUEST_TRADE_SCOPE: undefined,
        LIVE_TRADING_ENABLED: undefined,
        LIVE_TRADING_PAPER_ACCOUNTS_ONLY: undefined,
      }),
    );

    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SNAPTRADE_REQUEST_TRADE_SCOPE).toBe(false);
    expect(env.LIVE_TRADING_ENABLED).toBe(false);
    expect(env.LIVE_TRADING_PAPER_ACCOUNTS_ONLY).toBe(true);
  });

  it('treats a blank value as not set', () => {
    const env = loadEnv(buildEnvSource({ RESEND_API_KEY: '', EMAIL_FROM: '' }));

    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
  });

  it('parses the allowed client hosts into a lowercase list', () => {
    const env = loadEnv(buildEnvSource({ MCP_ALLOWED_CLIENT_HOSTS: ' Claude.ai, example.COM ,' }));

    expect(env.MCP_ALLOWED_CLIENT_HOSTS).toEqual(['claude.ai', 'example.com']);
  });

  it('names a missing variable in the error', () => {
    const message = loadEnvError(buildEnvSource({ TOKEN_ENCRYPTION_KEY: undefined }));

    expect(message).toContain('TOKEN_ENCRYPTION_KEY: is missing');
  });

  it('lists every invalid variable at once', () => {
    const message = loadEnvError(
      buildEnvSource({ DATABASE_URL: undefined, SNAPTRADE_CONSUMER_KEY: undefined, PORT: 'abc' }),
    );

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('SNAPTRADE_CONSUMER_KEY');
    expect(message).toContain('PORT');
  });

  it('rejects an encryption key that is 31 bytes', () => {
    const shortKey = Buffer.alloc(31, 7).toString('base64');

    const message = loadEnvError(buildEnvSource({ TOKEN_ENCRYPTION_KEY: shortKey }));

    expect(message).toContain('TOKEN_ENCRYPTION_KEY: must decode to exactly 32 bytes');
  });

  it('rejects an encryption key that is not base64', () => {
    const message = loadEnvError(buildEnvSource({ TOKEN_ENCRYPTION_KEY: 'not base64!' }));

    expect(message).toContain('TOKEN_ENCRYPTION_KEY: must be base64');
  });

  it('rejects a redirect URI on a different origin than the app', () => {
    const message = loadEnvError(
      buildEnvSource({ SNAPTRADE_REDIRECT_URI: 'http://127.0.0.1:3000/oauth/snaptrade/callback' }),
    );

    expect(message).toContain('SNAPTRADE_REDIRECT_URI: must have the same origin');
  });

  it.each([
    ['a trailing slash', 'http://localhost:3000/'],
    ['a path', 'http://localhost:3000/app'],
  ])('rejects an app base URL with %s', (_label, appBaseUrl) => {
    const message = loadEnvError(buildEnvSource({ APP_BASE_URL: appBaseUrl }));

    expect(message).toContain('APP_BASE_URL: must have no path and no trailing slash');
  });

  it('requires https for the app base URL in production', () => {
    const message = loadEnvError(buildEnvSource({ NODE_ENV: 'production' }));

    expect(message).toContain('APP_BASE_URL: must use https in production');
  });

  it('rejects an empty allowed client host list', () => {
    const message = loadEnvError(buildEnvSource({ MCP_ALLOWED_CLIENT_HOSTS: ' , ' }));

    expect(message).toContain('MCP_ALLOWED_CLIENT_HOSTS');
  });

  it('never includes variable values in the error message', () => {
    const secret = 'super-secret-value-123';
    const source = buildEnvSource({
      SNAPTRADE_OAUTH_CLIENT_SECRET: secret,
      TOKEN_ENCRYPTION_KEY: `${secret}==`,
      DATABASE_URL: `postgres://user:${secret}@`,
      PORT: secret,
      NODE_ENV: secret,
      LIVE_TRADING_ENABLED: secret,
    });

    const message = loadEnvError(source);

    expect(message).not.toContain(secret);
  });
});

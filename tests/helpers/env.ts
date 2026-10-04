import { type Env, loadEnv } from '../../src/config/env.js';

// The Docker test database from docker-compose.yml. Not a secret: it only exists on localhost
// and in the CI service container.
export const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5433/guardrail_test';

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

type EnvSource = Record<string, string | undefined>;

// Obviously fake but valid values: 32 bytes of 0x07 is a well-formed key that protects nothing.
export function buildEnvSource(overrides: EnvSource = {}): EnvSource {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    APP_BASE_URL: 'http://localhost:3000',
    LOG_LEVEL: 'error',
    SNAPTRADE_OAUTH_CLIENT_ID: 'test-client-id',
    SNAPTRADE_OAUTH_CLIENT_SECRET: 'test-client-secret-value',
    SNAPTRADE_REDIRECT_URI: 'http://localhost:3000/oauth/snaptrade/callback',
    SNAPTRADE_ISSUER: 'https://api.snaptrade.com',
    SNAPTRADE_API_BASE_URL: 'https://api.snaptrade.com',
    SNAPTRADE_REQUEST_TRADE_SCOPE: 'false',
    SNAPTRADE_CONSUMER_KEY: 'test-consumer-key-value',
    DATABASE_URL: testDatabaseUrl(),
    TEST_DATABASE_URL: testDatabaseUrl(),
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    MCP_ALLOWED_CLIENT_HOSTS: 'claude.ai',
    LIVE_TRADING_ENABLED: 'false',
    LIVE_TRADING_PAPER_ACCOUNTS_ONLY: 'true',
    ...overrides,
  };
}

export function buildTestEnv(overrides: EnvSource = {}): Env {
  return loadEnv(buildEnvSource(overrides));
}

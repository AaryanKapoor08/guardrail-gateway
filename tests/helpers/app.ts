import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { createLocalJWKSet } from 'jose';
import { createApp } from '../../src/app.js';
import type { DatabaseConnection } from '../../src/db/client.js';
import { sessions } from '../../src/db/schema.js';
import { createCaches, createLimiters, type Deps } from '../../src/deps.js';
import { createBackgroundTasks } from '../../src/lib/background.js';
import { sha256Hex } from '../../src/lib/crypto.js';
import { createLogger } from '../../src/lib/logger.js';
import { createTestClock, type TestClock } from './clock.js';
import { buildTestEnv } from './env.js';
import {
  type AuthorizeOptions,
  createFakeSnapTrade,
  type FakeSnapTrade,
} from './fake-snaptrade.js';

export const TEST_ORIGIN = 'http://localhost:3000';
export const SESSION_COOKIE = 'gg_session';

export type TestApp = {
  readonly app: Hono;
  readonly deps: Deps;
  readonly fake: FakeSnapTrade;
  readonly clock: TestClock;
  // Every log line the app wrote, so tests can check nothing secret was logged.
  readonly logs: string[];
};

export async function buildTestApp(
  connection: DatabaseConnection,
  options: { envOverrides?: Record<string, string> } = {},
): Promise<TestApp> {
  const env = buildTestEnv(options.envOverrides);
  const clock = createTestClock();
  const fake = await createFakeSnapTrade({
    clientId: env.SNAPTRADE_OAUTH_CLIENT_ID,
    clientSecret: env.SNAPTRADE_OAUTH_CLIENT_SECRET,
    now: clock.now,
  });
  const logs: string[] = [];
  const logger = createLogger('debug', (line) => logs.push(line));
  const deps: Deps = {
    env,
    db: connection.db,
    pool: connection.pool,
    fetch: fake.fetch,
    now: clock.now,
    logger,
    caches: createCaches(clock.now),
    limiters: createLimiters(clock.now),
    background: createBackgroundTasks(logger),
    idTokenKeys: () => createLocalJWKSet(fake.jwks),
  };
  return { app: createApp(deps), deps, fake, clock, logs };
}

// All `Set-Cookie` values of a response as name -> value (deleted cookies have value '').
export function readSetCookies(response: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const [name, ...valueParts] = (pair ?? '').split('=');
    if (name !== undefined) {
      cookies[name.trim()] = valueParts.join('=');
    }
  }
  return cookies;
}

export function findSetCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((header) => header.startsWith(`${name}=`));
}

export async function startLogin(
  testApp: TestApp,
  path = '/login',
): Promise<{ authorizeUrl: string; loginCookie: string }> {
  const response = await testApp.app.request(path);
  const authorizeUrl = response.headers.get('location');
  const loginCookie = readSetCookies(response).gg_login;
  if (response.status !== 302 || authorizeUrl === null || loginCookie === undefined) {
    throw new Error(`test setup: /login answered ${response.status}`);
  }
  return { authorizeUrl, loginCookie };
}

export function callbackUrl(params: Record<string, string>): string {
  return `/oauth/snaptrade/callback?${new URLSearchParams(params).toString()}`;
}

export type SignedInTestUser = {
  readonly userId: string;
  readonly sessionId: string;
  readonly cookie: string;
  readonly csrfToken: string;
};

async function findSession(testApp: TestApp, sessionId: string) {
  const [session] = await testApp.deps.db
    .select({ userId: sessions.userId, csrfToken: sessions.csrfToken })
    .from(sessions)
    .where(eq(sessions.idHash, sha256Hex(sessionId)));
  if (session === undefined) {
    throw new Error('test setup: session row not found after sign-in');
  }
  return session;
}

// Drives the real sign-in flow against the fake SnapTrade: /login -> consent -> callback.
export async function signInTestUser(
  testApp: TestApp,
  options: AuthorizeOptions = {},
): Promise<SignedInTestUser> {
  const { authorizeUrl, loginCookie } = await startLogin(testApp);
  const code = testApp.fake.authorize(authorizeUrl, options);
  const state = new URL(authorizeUrl).searchParams.get('state') ?? '';
  const response = await testApp.app.request(callbackUrl({ code, state }), {
    headers: { cookie: `gg_login=${loginCookie}` },
  });
  const sessionId = readSetCookies(response)[SESSION_COOKIE];
  if (response.status !== 302 || sessionId === undefined || sessionId === '') {
    throw new Error(`test setup: sign-in callback answered ${response.status}`);
  }
  const session = await findSession(testApp, sessionId);
  return {
    userId: session.userId,
    sessionId,
    cookie: `${SESSION_COOKIE}=${sessionId}`,
    csrfToken: session.csrfToken,
  };
}

// A form POST as a browser on our site sends it: our Origin, form encoding, and cookies.
export function postForm(
  testApp: TestApp,
  path: string,
  request: { cookie?: string; form?: Record<string, string> },
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: TEST_ORIGIN,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (request.cookie !== undefined) {
    headers.cookie = request.cookie;
  }
  return Promise.resolve(
    testApp.app.request(path, {
      method: 'POST',
      headers,
      body: new URLSearchParams(request.form ?? {}).toString(),
    }),
  );
}

export function getPage(testApp: TestApp, path: string, cookie?: string): Promise<Response> {
  return Promise.resolve(
    testApp.app.request(path, cookie === undefined ? {} : { headers: { cookie } }),
  );
}

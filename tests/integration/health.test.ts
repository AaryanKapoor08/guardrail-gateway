import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDb } from '../../src/db/client.js';
import type { Deps } from '../../src/deps.js';
import { createLogger } from '../../src/lib/logger.js';
import { buildTestEnv, testDatabaseUrl } from '../helpers/env.js';

function buildDeps(databaseUrl: string): Deps {
  const { pool, db } = createDb(databaseUrl);
  return {
    env: buildTestEnv(),
    db,
    pool,
    fetch: () => Promise.reject(new Error('network is disabled in tests')),
    now: () => new Date('2026-10-03T14:00:00Z'),
    logger: createLogger('error', () => {}),
  };
}

describe('GET /health', () => {
  const deps = buildDeps(testDatabaseUrl());

  afterAll(async () => {
    await deps.pool.end();
  });

  it('reports ok when the database answers', async () => {
    const app = createApp(deps);

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports degraded when the database is unreachable', async () => {
    const brokenDeps = buildDeps(testDatabaseUrl());
    await brokenDeps.pool.end();
    const app = createApp(brokenDeps);

    const response = await app.request('/health');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded' });
  });
});

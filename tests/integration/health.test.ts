import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DatabaseConnection } from '../../src/db/client.js';
import { buildTestApp } from '../helpers/app.js';
import { setupTestDb } from '../helpers/db.js';
import { testDatabaseUrl } from '../helpers/env.js';

describe('GET /health', () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = await setupTestDb();
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  it('reports ok when the database answers', async () => {
    const { app } = await buildTestApp(connection);

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('reports degraded when the database is unreachable', async () => {
    const closedConnection = createDb(testDatabaseUrl());
    await closedConnection.pool.end();
    const { app } = await buildTestApp(closedConnection);

    const response = await app.request('/health');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'degraded' });
  });
});

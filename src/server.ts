import { type ServerType, serve } from '@hono/node-server';
import { createApp } from './app.js';
import { type Env, loadDotEnvFileIfPresent, loadEnv } from './config/env.js';
import { createDeps, type Deps } from './deps.js';
import { type Sweeper, startSweeper } from './jobs/sweeper.js';

const SHUTDOWN_GRACE_MS = 10_000;

function loadEnvOrExit(): Env {
  try {
    loadDotEnvFileIfPresent();
    return loadEnv();
  } catch (error) {
    // Handled: bad config is an operator mistake. Print the readable list of invalid keys
    // (names only) and refuse to start, rather than running half-configured.
    const message = error instanceof Error ? error.message : 'Invalid environment';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

// Render sends SIGTERM on every deploy. Stop accepting new requests, give in-flight ones up to
// 10 seconds, let a running sweep and background work finish, then close the database pool so
// no query is cut off mid-transaction.
async function shutDown(
  server: ServerType,
  services: { deps: Deps; sweeper: Sweeper },
  signal: string,
): Promise<void> {
  const { deps, sweeper } = services;
  deps.logger.info('Shutting down', { event: 'shutdown', reason: signal });
  await Promise.race([closeServer(server), waitMs(SHUTDOWN_GRACE_MS)]);
  await sweeper.stop();
  await deps.background.settle();
  await deps.pool.end();
  deps.logger.info('Shutdown complete', { event: 'shutdown' });
  process.exit(0);
}

function main(): void {
  const env = loadEnvOrExit();
  const deps = createDeps(env);
  const app = createApp(deps);

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    deps.logger.info(`Server listening on port ${info.port}`, { event: 'startup' });
  });

  const sweeper = startSweeper(deps);

  let isShuttingDown = false;
  const onSignal = (signal: string): void => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    shutDown(server, { deps, sweeper }, signal).catch((error: unknown) => {
      deps.logger.logError('[Server] shutdown failed', error);
      process.exit(1);
    });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

main();

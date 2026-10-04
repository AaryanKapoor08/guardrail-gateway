import type { Logger } from './logger.js';

// Work that runs after a response has been sent (e.g. processing a webhook). The caller never
// waits for it; failures are logged, and the sweeper retries anything left undone. `settle()`
// waits for whatever is still running: graceful shutdown uses it before closing the database,
// and tests use it to check the result without sleeping.
export type BackgroundTasks = {
  readonly run: (label: string, task: () => Promise<void>) => void;
  readonly settle: () => Promise<void>;
};

export function createBackgroundTasks(logger: Logger): BackgroundTasks {
  const running = new Set<Promise<void>>();

  function run(label: string, task: () => Promise<void>): void {
    const started: Promise<void> = Promise.resolve()
      .then(task)
      .catch((error: unknown) => logger.logError(`[Background] ${label} failed`, error))
      .finally(() => running.delete(started));
    running.add(started);
  }

  async function settle(): Promise<void> {
    while (running.size > 0) {
      await Promise.all([...running]);
    }
  }

  return { run, settle };
}

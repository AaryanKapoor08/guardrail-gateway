import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests share one test database, so test files must not run at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
    // The two modules that decide what is allowed must have every branch tested (P7).
    coverage: {
      provider: 'v8',
      include: ['src/policy/**', 'src/intents/state-machine.ts'],
      thresholds: { branches: 100 },
    },
  },
});

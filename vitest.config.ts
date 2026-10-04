import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests share one test database, so test files must not run at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});

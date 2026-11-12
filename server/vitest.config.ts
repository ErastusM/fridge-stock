import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/test-db';

export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

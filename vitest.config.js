import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup-env.js'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

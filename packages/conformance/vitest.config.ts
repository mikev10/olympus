import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Fixture compilation loads @types/node once per worker; allow for it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

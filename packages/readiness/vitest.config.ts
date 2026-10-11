import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // A scan provisions several containers, and the fixtures that declare a
    // test framework install it from the registry. Generous rather than
    // absent: a hung daemon must still end the run.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});

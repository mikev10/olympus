import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The behavioral suite provisions a container, and on a cold host pulls
    // its image. The bound is generous rather than absent: a hung daemon must
    // still end the run.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

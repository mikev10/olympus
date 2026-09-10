import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Provisioning a container, and on a cold host pulling its image, is slower
    // than a default test. The bound is generous rather than absent: a hung
    // daemon must still end the run.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Each file provisions containers on one shared daemon. Serial files keep
    // a wall-clock assertion from being timed against another file's pull.
    fileParallelism: false,
  },
});

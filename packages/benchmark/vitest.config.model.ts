import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/tiers/model.tier.ts'],
    testTimeout: 7_200_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
  },
});

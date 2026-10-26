import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `TIER=critic-plumbing` runs the critic arm's no-model check on the same bench instead.
    include: [`test/tiers/${process.env.TIER ?? 'deterministic'}.tier.ts`],
    // Every item is a run on the real line: several containers each, and an install. Generous rather than
    // absent, so a hung daemon still ends the run (I5).
    testTimeout: 3_600_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
  },
});

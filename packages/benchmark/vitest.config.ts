import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tiers run under their own configs: one provisions containers for every item, the other calls a model.
    include: ['test/**/*.test.ts'],
    exclude: ['test/tiers/**'],
  },
});

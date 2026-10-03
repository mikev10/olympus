import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The paid suite calls the model; it runs only under its own config, in CI's run-driver step (D-I1a-07).
    exclude: ['test/paid/**', '**/node_modules/**'],
  },
});

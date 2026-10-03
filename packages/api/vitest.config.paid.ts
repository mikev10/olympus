import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/paid/**/*.test.ts'],
    // This suite owns external assertions, so the registry counts one only
    // after reconciling it against the report this reporter writes
    // (I8.external-assertion-execution-reconciled).
    reporters: ['default', '@olympus-ai/conformance/reporter'],
    // A run provisions containers, may build the driver's image, and waits on a model twice.
    testTimeout: 600_000,
    hookTimeout: 1_200_000,
  },
});

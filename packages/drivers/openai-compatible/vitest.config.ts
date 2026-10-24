import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // This package owns external assertions, so the registry counts one only
    // after reconciling it against the report this reporter writes
    // (I8.external-assertion-execution-reconciled). Removing it does not make
    // the assertions pass unreconciled; it makes them refuse.
    reporters: ['default', '@olympus-ai/conformance/reporter'],
    // A task here provisions a container and a relay and starts a TLS
    // endpoint beside them. No model is called; the bound is for a cold daemon.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Every file drives the same daemon, and a concurrency assertion must not
    // be timed against another file's containers.
    fileParallelism: false,
  },
});

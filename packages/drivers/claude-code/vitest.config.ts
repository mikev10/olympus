import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // This package owns external assertions, so the registry counts one only
    // after reconciling it against the report this reporter writes
    // (I8.external-assertion-execution-reconciled). Removing it does not make
    // the assertions pass unreconciled; it makes them refuse.
    reporters: ['default', '@olympus-ai/conformance/reporter'],
    // A task here provisions a container, pulls or builds an image on a cold
    // host, and waits on a model. The bound is generous rather than absent: a
    // hung daemon or a wedged CLI must still end the run.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Every file drives the same daemon and the same account. Serial files
    // keep a concurrency assertion from being timed against another file's
    // model call.
    fileParallelism: false,
    // Every test here is a paid model call. Once one fails, the rest are
    // stopped rather than each paying to fail the same way: an account out of
    // credit answered nine calls with the same 400 in one run. A stopped test
    // is reported skipped, which the registry refuses exactly as it refuses a
    // failure, so this saves money and weakens nothing.
    bail: 1,
  },
});

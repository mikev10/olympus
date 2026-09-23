import { defineConfig } from 'vitest/config';

// The workspace packages each run their own `vitest run`; `pnpm -r test` cannot
// see a root-level directory. This config exists so scripts/ is tested at all.
export default defineConfig({
  test: {
    include: ['scripts/**/test/**/*.test.ts'],
    environment: 'node',
  },
});

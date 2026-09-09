import { defineConfig } from 'vitest/config';
import { conformanceAliases } from './src/kit/paths.js';

export default defineConfig({
  resolve: {
    // One map, two readers: the tsconfig `paths` the fixtures typecheck
    // against also decides what a runtime assertion's import() resolves to,
    // so `import('@olympus-ai/api')` reaches the published entry without a
    // package.json dependency and so without a workspace cycle (D-F3-04).
    alias: conformanceAliases(),
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Fixture compilation loads @types/node once per worker; allow for it.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

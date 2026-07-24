import path from 'path';
import { defineConfig } from 'vitest/config';

// Development / test runner config. Library build is in vite.build.ts.
//
// Imports `defineConfig` from `vitest/config` (rather than `vite`) so the
// `test` field type-checks. Aliases workspace deps to their source so
// vitest resolves them directly instead of through built dist output.
export default defineConfig({
  resolve: {
    alias: {
      '@wafflebase/slides': path.resolve(__dirname, '../slides/src/index.ts'),
      '@wafflebase/docs': path.resolve(__dirname, '../docs/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'jsdom',
  },
});

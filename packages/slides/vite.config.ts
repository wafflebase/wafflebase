import path from 'path';
import { defineConfig } from 'vitest/config';

// Development / test runner config. Library build is in vite.build.ts.
//
// Imports `defineConfig` from `vitest/config` (rather than `vite`) so the
// `test` field type-checks before any `*.test.ts` exists in `src/`. Once
// tests land they pull in vitest's type augmentation transitively, but the
// scaffold task needs to typecheck cleanly with zero source files.
export default defineConfig({
  resolve: {
    alias: {
      // Resolve @wafflebase/docs to its source so vitest can use
      // browser-only exports (e.g. CanvasTextMeasurer) that the docs
      // package's `node` export condition intentionally omits. Mirrors
      // packages/frontend/vite.config.ts.
      '@wafflebase/docs': path.resolve(__dirname, '../docs/src/index.ts'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});

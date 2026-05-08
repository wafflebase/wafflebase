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
    // Visual snapshot tests render through node-canvas, whose Cairo +
    // fontconfig stack differs between macOS and Linux CI. Goldens are
    // generated on Darwin, so byte-equal compare on Linux would fail.
    // Keep them out of the default lane (and `verify:fast`); the
    // `test:visual` script sets `INCLUDE_VISUAL_TESTS=1` to opt back in.
    exclude:
      process.env.INCLUDE_VISUAL_TESTS === '1'
        ? ['**/node_modules/**', '**/dist/**']
        : ['**/node_modules/**', '**/dist/**', '**/*.visual.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});

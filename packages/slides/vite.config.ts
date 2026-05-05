import { defineConfig } from 'vitest/config';

// Development / test runner config. Library build is in vite.build.ts.
//
// Imports `defineConfig` from `vitest/config` (rather than `vite`) so the
// `test` field type-checks before any `*.test.ts` exists in `src/`. Once
// tests land they pull in vitest's type augmentation transitively, but the
// scaffold task needs to typecheck cleanly with zero source files.
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});

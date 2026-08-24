import { defineConfig } from 'vitest/config';

// Test-runner config only. This package has no library build: it exports
// `./src/index.ts` and reaches its consumers as source, the same arrangement
// `@wafflebase/design-editor` uses. See `docs/design/debug-report.md`.
//
// `jsdom` because the store and session run in a browser — `localStorage`,
// event loops and blob eviction are the parts most worth testing, and the
// IndexedDB backend is behind an interface so it does not need a real one here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Test-runner config only. This package has no library build: it exports source
// and reaches its consumers that way, the same arrangement
// `@wafflebase/design-editor` uses. See `docs/design/debug-report.md`.
//
// `jsdom` because all of it runs in a browser — `localStorage`, event loops,
// blob eviction and now the overlay and panel themselves. The IndexedDB backend
// is behind an interface, so it does not need a real one here.
//
// React is a PEER dependency of the `/react` entry point only, and a dev
// dependency here so these tests can render it. The core entry stays free of it.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/ui/test-setup.ts'],
  },
});

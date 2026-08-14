/**
 * A test config separate from `vite.config.ts`, which vitest would otherwise adopt.
 *
 * Not tidiness. `vite.config.ts` calls `designEditor({ tokens: wafflebaseCore(...) })` at
 * module scope, so adopting it would construct the plugin — and the adapter that owns a
 * child process — once per test worker, in a run whose whole point is to exercise those
 * things deliberately. It also failed outright: see that file's note on how a Vite config
 * loads a workspace package.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});

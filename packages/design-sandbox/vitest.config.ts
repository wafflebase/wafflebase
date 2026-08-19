/**
 * A test config separate from `vite.config.ts`, which vitest would otherwise adopt.
 *
 * Not tidiness. `vite.config.ts` calls `designEditor({ tokens: wafflebaseCore(...) })` at
 * module scope, so adopting it would construct the plugin — and the adapter that owns a
 * child process — once per test worker, in a run whose whole point is to exercise those
 * things deliberately. It also failed outright: see that file's note on how a Vite config
 * loads a workspace package.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sceneAliases } from './src/scenes/aliases';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  /*
   * The SAME aliases the scenes run under, from the one shared module.
   *
   * The seed tests import `@yorkie-js/sdk` and `@wafflebase/sheets` exactly as a scene does;
   * resolved to different copies they would prove nothing about what actually runs — and the
   * CRDT classes here are compared by identity, so a second copy is not merely wasteful, it
   * silently flattens seeded content into plain objects.
   */
  resolve: { alias: sceneAliases(path.resolve(HERE, '../..')) },
  test: {
    include: ['test/**/*.test.ts'],
  },
});

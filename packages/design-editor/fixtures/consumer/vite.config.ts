/*
 * The fixture consumer's Vite config — everything a stranger has to write.
 *
 * Four lines of configuration and no adapter of their own: the project's tokens are
 * plain custom properties in one stylesheet, which is the population `cssVariables()`
 * exists for. Compare `packages/design-sandbox/vite.config.ts`, which is the other
 * population and writes ~250 lines of `TokenAdapter`.
 *
 * `@wafflebase/design-editor` is imported BY NAME, not by a relative path into `src/`.
 * The package self-references through its own `exports` map, so this exercises the same
 * entry point a real installation resolves — and would break the same way if a subpath
 * were misdeclared.
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { designEditor, cssVariables } from '@wafflebase/design-editor';

export default defineConfig({
  // A real alias, in this project's own idiom — `@` points at `app/`, not at a
  // `src/`. The plugin reads this rather than being told about it, so the outline's
  // drill-in resolves `@/components/badge` without any editor configuration.
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'app') },
  },
  plugins: [
    /*
     * ADDED IN 11b, and it changes what this fixture proves.
     *
     * Through 11a nothing mounted: the gate drove the JSON API, the generated scene
     * loader was never called, and the project needed no React at all. 11b's frame
     * MOUNTS the scene, which needs the consumer's own `plugin-react` — the frame
     * renders their components, so their transform is the one that has to run.
     *
     * This is also the whole reason the fixture is worth having. It is a project that
     * is not wafflebase, with its own `app/` layout and its own alias, and it now
     * exercises the frame end to end without any of wafflebase's providers or fixtures
     * — which is exactly the boundary §2 says inspection would miss.
     */
    react(),
    designEditor({
      scenes: 'scenes.config.json',
      tokens: cssVariables({ stylesheet: 'app/styles/theme.css' }),
    }),
  ],
});

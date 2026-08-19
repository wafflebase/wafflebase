/**
 * The shell build. `pnpm --filter @wafflebase/design-editor build` → `dist/shell/`.
 *
 * A SEPARATE CONFIG FILE, not the package's `vite.config.ts`, because the package
 * has no Vite app of its own — it IS a Vite plugin. Naming this `vite.config.ts`
 * would make every `vite` invocation in the directory pick it up, including the
 * fixture gate's, which boots the consumer with `--config` pointing elsewhere and
 * would silently inherit these plugins if it ever stopped passing the flag.
 *
 * WHAT THIS BUILDS, AND WHAT IT DELIBERATELY DOES NOT. `src/shell/index.html` is
 * the chrome: our React, our Tailwind, bundled and hashed. `scene.html` is NOT an
 * input — it sits in `src/shell/public/` so Vite copies it verbatim, because its
 * script has to be resolved by the CONSUMER's dev server (their React, their fast
 * refresh, their `virtual:wb-scenes`). Making it an input would have Vite try to
 * bundle a module that must stay source.
 *
 * `base` is the plugin's own mount. `shellServer` strips it and resolves the rest
 * against `distDir`, so an asset emitted as `/__design-editor/assets/x-HASH.js`
 * arrives as `assets/x-HASH.js` — which is why the build cannot use the default
 * `/`: the browser would ask the CONSUMER's dev server for `/assets/x.js` and get
 * their app's 404 (or worse, their own asset).
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { BASE } from './src/base.ts';

const HERE = import.meta.dirname;

export default defineConfig({
  root: path.join(HERE, 'src', 'shell'),
  // Trailing slash: Vite joins `base` with the asset path, and without it the
  // emitted URL is `/__design-editorassets/…`.
  base: `${BASE}/`,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.join(HERE, 'dist', 'shell'),
    emptyOutDir: true,
    // The shell is dev-only and read by a developer with devtools open. Sourcemaps
    // cost nothing at install time (the package is a devDependency) and turn a
    // stack trace in the chrome into something reportable.
    sourcemap: true,
    // Every dependency is ours and bundled; there is nothing for the consumer to
    // provide, which is the point of a prebuilt shell.
    rollupOptions: { input: path.join(HERE, 'src', 'shell', 'index.html') },
  },
  // No dev server is ever started from this config — the shell is served by
  // `shellServer` out of `dist/`. Declared anyway so a stray `vite` here fails
  // loudly on a port collision rather than quietly shadowing the consumer's 5173.
  server: { port: 5199, strictPort: true },
});

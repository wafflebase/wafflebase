import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
export default defineConfig({
  build: {
    lib: {
      // Multiple entry points so the published package can expose both:
      //   - `.`      (full editor; browser-only)
      //   - `./node` (data-model + DOM-free importers — backend/CLI/SSR safe)
      entry: {
        'wafflebase-slides.es': 'src/index.ts',
        node: 'src/node.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (entryName === 'node') {
          return format === 'cjs' ? 'node.cjs' : 'node.js';
        }
        return format === 'cjs'
          ? 'wafflebase-slides.cjs'
          : 'wafflebase-slides.es.js';
      },
    },
  },
});

import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
export default defineConfig({
  build: {
    lib: {
      entry: { 'wafflebase-board.es': 'src/index.ts' },
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'cjs' ? 'wafflebase-board.cjs' : 'wafflebase-board.es.js',
    },
  },
});

import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
export default defineConfig({
  build: {
    lib: {
      entry: {
        'wafflebase-notes.es': 'src/index.ts',
        node: 'src/node.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (entryName === 'node') {
          return format === 'cjs' ? 'node.cjs' : 'node.js';
        }
        return format === 'cjs' ? 'wafflebase-notes.cjs' : 'wafflebase-notes.es.js';
      },
    },
    rollupOptions: {
      // Yorkie is a peer dep supplied by the frontend; never bundle it.
      external: ['@yorkie-js/sdk'],
    },
  },
});

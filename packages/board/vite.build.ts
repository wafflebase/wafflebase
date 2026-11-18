import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
export default defineConfig({
  build: {
    lib: {
      // Two entry points, like `@wafflebase/slides`:
      //   - `.`      (everything; what the frontend imports)
      //   - `node`   (the DOM-free data-model surface the backend imports)
      entry: {
        'wafflebase-board.es': 'src/index.ts',
        node: 'src/node.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (entryName === 'node') {
          return format === 'cjs' ? 'node.cjs' : 'node.js';
        }
        return format === 'cjs' ? 'wafflebase-board.cjs' : 'wafflebase-board.es.js';
      },
    },
    rollupOptions: {
      // Sibling workspace packages stay imports, never inlined. A bundled
      // `@wafflebase/slides` would be its BROWSER entry (vite resolves the
      // browser conditions), dragging the canvas editor into the node build;
      // left external, Node resolves it through slides' own `node` condition.
      external: [/^@wafflebase\//],
    },
  },
});

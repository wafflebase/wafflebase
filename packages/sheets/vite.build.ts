import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'wafflebase-sheet',
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'cjs'
          ? 'wafflebase-sheet.cjs'
          : 'wafflebase-sheet.es.js',
    },
    rollupOptions: {
      // Keep Node built-ins external so antlr4ts can use util.inspect.custom
      // and assert at runtime without browser-compat warnings.
      // The frontend imports sheet from source, not this bundle.
      external: ['assert', 'util'],
    },
  },
});

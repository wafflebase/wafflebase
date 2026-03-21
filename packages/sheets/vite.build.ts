import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});

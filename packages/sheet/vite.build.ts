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
      // at runtime. The frontend imports sheet from source, not this bundle.
      external: ['util'],
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});

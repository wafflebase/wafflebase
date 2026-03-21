import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'wafflebase-document',
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'cjs'
          ? 'wafflebase-document.cjs'
          : 'wafflebase-document.es.js',
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});

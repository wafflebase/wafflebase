import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { 'wafflebase-board.es': 'src/index.ts' },
      formats: ['es', 'cjs'],
      fileName: (format) =>
        format === 'cjs' ? 'wafflebase-board.cjs' : 'wafflebase-board.es.js',
    },
  },
  plugins: [dts({ rollupTypes: true })],
});

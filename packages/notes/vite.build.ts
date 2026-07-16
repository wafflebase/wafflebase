import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
  plugins: [dts({ rollupTypes: true })],
});

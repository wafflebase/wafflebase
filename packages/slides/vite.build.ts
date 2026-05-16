import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

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
  plugins: [dts({ rollupTypes: true })],
});

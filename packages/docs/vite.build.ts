import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      // Multiple entry points so the published package can expose both:
      //   - `.`      (full editor; browser-only)
      //   - `./node` (data-model-only; backend/CLI/SSR safe — no DOM)
      entry: {
        'wafflebase-document.es': 'src/index.ts',
        node: 'src/node.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        if (entryName === 'node') {
          return format === 'cjs' ? 'node.cjs' : 'node.js';
        }
        // Preserve the legacy filename scheme for the main entry so existing
        // consumers (`main`, `module`, `types`) keep resolving the same path.
        return format === 'cjs'
          ? 'wafflebase-document.cjs'
          : 'wafflebase-document.es.js';
      },
    },
  },
  plugins: [
    dts({
      // rollupTypes bundles each entry's .d.ts independently, producing
      // `wafflebase-document.es.d.ts` and `node.d.ts` next to their .js files.
      rollupTypes: true,
    }),
  ],
});

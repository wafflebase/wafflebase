import { defineConfig } from 'vite';

// Declarations are NOT emitted here. `tsc -p tsconfig.build.json` runs after
// this build (see the package `build` script) — vite owns the JS, tsc owns
// the .d.ts. The order is load-bearing: vite's `emptyOutDir` would wipe
// declarations emitted first.
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
});

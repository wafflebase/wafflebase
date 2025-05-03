import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'wafflebase-sheet',
      fileName: (format) =>
        format === 'umd'
          ? 'wafflebase-sheet.js'
          : `wafflebase-sheet.${format}.js`,
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
    nodePolyfills(),
  ],
});

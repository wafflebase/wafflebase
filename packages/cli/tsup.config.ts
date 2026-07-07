import { defineConfig } from 'tsup';

// The CLI depends on the private workspace packages `@wafflebase/docs`,
// `@wafflebase/slides` (and transitively `@wafflebase/tokens`). Those are
// never published to npm, so a plain `tsc` build leaves the published CLI
// with `workspace:*`-derived deps that 404 on `npm install`. Bundle every
// `@wafflebase/*` package inline so the published CLI is self-contained and
// carries no private workspace deps. Third-party deps stay external and are
// declared in package.json `dependencies`.
export default defineConfig({
  entry: { bin: 'src/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  noExternal: [/^@wafflebase\//],
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: false,
});

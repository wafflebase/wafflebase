# Lessons — CLI bundle workspace deps

## `workspace:*` + `private: true` = unpublishable dependency

`pnpm publish` rewrites `workspace:*` to the concrete version. If that
dependency is `"private": true` (never published), the published package
declares a version that 404s on `npm install`. Any runtime `dependencies`
entry pointing at a private workspace package is a publish-time landmine.
Rule: a publishable package's `dependencies` must contain only
registry-resolvable packages — bundle private workspace deps inline instead.

## Check whether the built dist is already self-contained before adding deps

The instinct was to compute the union of transitive third-party deps and add
them to the CLI. But the docs/slides **Vite library builds inline all their
deps** (zero bare imports in `dist/*.js`). Verifying that first
(`grep` for bare `import ... from` in the dist) saved adding jszip/nspell/etc.
Always inspect the actual build output before reasoning about its deps.

## Bundling flattens the output tree — runtime path resolution breaks

`createRequire(import.meta.url)` + `require('../../package.json')` worked under
`tsc` (output mirrored `src/`, so `dist/commands/root.js` → `../../` = pkg root)
and under `tsx` dev (`src/commands/root.ts` → `../../` = pkg root). After tsup
bundles everything into a flat `dist/bin.js`, `../../` points one level too high.

Fix: replace the **runtime** resolution with a **static** `import pkg from
'../../package.json' with { type: 'json' }`. esbuild resolves static imports at
build time relative to the *source* file and inlines the value, so it's correct
regardless of where the bundled output lands. Reserve `createRequire`/
`import.meta.url` path math for things that must be read from disk at runtime —
and remember a bundler moves that "runtime location."

## esbuild JSON: default import inlines the whole file; named import tree-shakes

`import pkg from './package.json'` (default) makes esbuild embed the *entire*
manifest into the bundle — including `devDependencies` with `workspace:*`
strings, which is confusing residue in a published single-file CLI. Use a
**named** import — `import { version } from './package.json'` — and esbuild's
JSON loader inlines only that key.

Gotcha: the import attribute forces the opposite. `import { version } from
'./package.json' with { type: 'json' }` fails to build — under the
`type: 'json'` spec assertion esbuild exposes only a *default* export, so the
named import has "No matching export." TypeScript's `resolveJsonModule` happily
typechecks it (it synthesizes named exports), so the error only shows at bundle
time. Drop the attribute to get tree-shakeable named JSON imports.

## Verify the bundle by executing a bundled code path, not just grepping

Grepping `dist/bin.js` for `@wafflebase` proves no import remains, but minified
symbol renaming (`BUILT_IN_LAYOUTS` → gone) means grep can't confirm the code
*works*. Running `slides import --dry-run` against a real `.pptx` exercised the
inlined `importPptx` end-to-end — the real proof.

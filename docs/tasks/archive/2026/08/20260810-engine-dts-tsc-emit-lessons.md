# Lessons — Engine declaration builds: api-extractor → `tsc`

## "Synchronous" is a reproduction hint, not a footnote

The crash looked unreproducible: six consecutive `pnpm build` runs (plus CPU
load) all passed, and the user's own retry passed immediately. What broke it
open was reading the failing call path closely enough to notice that
`Extractor.invoke` is **fully synchronous**. Node is single-threaded, so
nothing in api-extractor's own process can delete a file between the moment
its program loads `dist/src/model/types.d.ts` and the moment it reports an
issue against it. The deleter therefore *had* to be a second process.

Two `docs` builds started 1s apart reproduced it on the first attempt.

Generalisable: when a race looks impossible in-process, that is evidence
about **which process**, not evidence that there is no race. Ask "what else
writes to this directory?" before reaching for load/timing theories.

## Measure the migration's biggest unknown before choosing the direction

Moving off api-extractor hinged on one question: does `tsc` with
`declaration: true` even succeed on codebases that have never been built
that way? The usual answer is a wall of TS4023/TS2742 ("inferred type cannot
be named"), which api-extractor hides by inlining everything.

Emitting into a scratch `--outDir` took a couple of minutes and answered it
with evidence rather than optimism: `docs` 0 errors, `slides` 0 errors,
`sheets` 3 mechanical errors (`rootDir` too narrow for `antlr/`, one
`.ts`-extension import). That converted "this might be a large migration"
into a scoped, sized change *before* any config was touched.

## Hash the old build output first; "byte-identical" is the release argument

Before changing anything, every engine package was built from `main` and its
`dist/**/*.{js,cjs}` hashed. After the migration the same hashes matched
exactly — 172 files, zero differences. That single check is what makes the
release-safety claim checkable rather than rhetorical: the published CLI
bundles engine **JS**, so identical JS means the npm artifact cannot have
moved. Assertions about "no impact" on a build system are cheap; a diff is
not.

## `include`/`exclude` belong in `tsconfig.build.json`, never the main one

The tempting cleanup is to add `exclude: ["test", "dist"]` to the package's
`tsconfig.json`. Don't: `pnpm <pkg> typecheck` (`tsc --noEmit`) reads that
file, so excluding tests there silently removes test typecheck coverage from
`verify:fast`. `@wafflebase/core` already had the right shape — main
tsconfig includes tests, `tsconfig.build.json` excludes them.

## `exclude: ["test/**/*"]` is not enough — tests live in `src/` too

`docs` keeps all tests under `test/`, so the first build tsconfig worked and
looked correct. `sheets` (11), `slides` (8), `notes` (6) and `board` (5) have
in-`src` `*.test.ts` files; `notes` failed outright
(`Cannot find module 'node:module'` from a test's import), and the others
would have quietly emitted test declarations into `dist/`. Excluding
`src/**/*.test.ts` too is required, and one package building cleanly says
nothing about the rest.

## A guard you haven't seen fail is not a guard

`verify-dts-entries.mjs` was written to catch the stub `.d.ts` that a crashed
rollup leaves behind. Before wiring it into `verify:self` and
`npm-publish.yml`, the exact historical corruption was recreated by hand
(`export * from './src/index'` with `dist/src/` gone) and the script was
confirmed to exit 1 with a useful message, then to exit 0 once restored.
Green-on-healthy-input proves nothing on its own.

## Check `git status` before blaming your own config

`packages/sheets/antlr/*.d.ts` appeared in the source tree, which looked like
a `rootDir` mistake in the new build config. It was residue from an *earlier
scratchpad experiment* (a `rootDir: "src"` run where out-of-rootDir files
emitted next to their sources). Deleting them and rebuilding proved the
committed config emits to `dist/antlr/` correctly. Exploratory `tsc` runs
mutate the working tree — reconcile against `git status` before rewriting
something that already works.

## Scope note: `notes` and `board` are built by nothing

Neither package appears in the root `build` script nor in any `verify:self`
lane; `frontend` (their only consumer) aliases them to source in
`vite.config.ts`. Their `dist/` is therefore produced only by an explicit
`pnpm --filter` invocation. They were migrated anyway so the monorepo has one
build idiom, but the fact that no gate builds them is a pre-existing gap left
untouched here — and the reason `verify-dts-entries.mjs` skips unbuilt
packages instead of failing on them.

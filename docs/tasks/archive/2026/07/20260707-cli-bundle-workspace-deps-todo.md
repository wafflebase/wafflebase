# CLI: bundle private workspace deps to fix npm install 404

## Problem

`npm install -g @wafflebase/cli` fails:

```
404 '@wafflebase/slides@0.4.9' is not in this registry.
```

Root cause: the published `@wafflebase/cli` declares `@wafflebase/slides`
(and transitively `@wafflebase/tokens`) as runtime deps via `workspace:*`,
but both are `"private": true` and never published to npm. `pnpm publish`
rewrites `workspace:*` to the concrete version `0.4.9`, which does not
exist on the registry.

Note: `@wafflebase/docs` is self-contained (no workspace deps) and IS
published by the release workflow — it stays external. Only `slides` and
`tokens` are broken.

## Approach — bundle the private packages into CLI dist

Bundle `@wafflebase/slides` + `@wafflebase/tokens` inline into the CLI
output with tsup (esbuild). Keep `@wafflebase/docs` and all third-party
deps external.

## Tasks

- [x] Add `tsup` devDependency + `tsup.config.ts` (entry `src/bin.ts`,
      ESM, node20, `noExternal: [/^@wafflebase\//]`, shebang preserved,
      dts off).
- [x] Switch `build` script to tsup; keep `typecheck` on `tsc --noEmit`.
- [x] Confirm bundled workspace dists are fully self-contained (docs +
      slides Vite libs already inline all third-party deps) → no new CLI
      third-party deps required.
- [x] Update `package.json`: move `@wafflebase/docs` + `@wafflebase/slides`
      to `devDependencies` (build-time only); no `@wafflebase/*` runtime deps.
- [x] Fix `root.ts` version read: `createRequire('../../package.json')`
      resolved at runtime against the (now flattened) output path → switch to
      a static `import pkg from '../../package.json'`, resolved by esbuild
      at build time relative to the source file.
- [x] Drop the redundant `@wafflebase/docs` publish step from
      `npm-publish.yml`; mark `@wafflebase/docs` `private: true`.
- [x] Verify: `--version`/`--help` run; `slides import --dry-run` parses a
      real `.pptx` through the bundled slides code; zero `import '@wafflebase/*'`
      in `dist/bin.js`.
- [x] `npm pack` shows only `README.md, dist/bin.js, package.json`, deps free
      of `@wafflebase/*`.
- [x] `pnpm cli typecheck && pnpm cli test` (208 pass); docs/slides
      typecheck+test green; `verify:architecture` green; `--frozen-lockfile` ok.

## Review

Root cause was a published `@wafflebase/cli` whose `workspace:*` deps
(`@wafflebase/slides` → `@wafflebase/tokens`) were `private: true` and never
on npm; pnpm rewrote them to `0.4.9` at publish → `npm install` 404.

Fix: bundle every `@wafflebase/*` package inline via tsup (esbuild) into a
single `dist/bin.js`. Because the docs/slides Vite library builds already
inline all their third-party deps, the CLI gained **no** new runtime deps —
the published package now declares only registry-resolvable third-party deps
and ships as `README.md + dist/bin.js + package.json`.

Notable gotcha captured in lessons: bundling flattens the output tree, so any
**runtime** relative-path resolution (`createRequire(import.meta.url)` +
`../../package.json`) breaks; use a static import so the bundler resolves it
at build time against the source location instead.

Bundle size: 4.31 MB single file (acceptable for a CLI; contains docs+slides
engines). `docs` is now `private` like the other internal packages, and the
CLI is the sole npm artifact.

## Code review dispositions (workflow review, high effort)

- **[fixed] `root.ts` whole-manifest inline** — default JSON import embedded the
  entire package.json (incl. `workspace:*` devDeps) in the bundle. Switched to a
  named import `import { version }` → esbuild tree-shakes; bundle now has no
  `workspace:*` / `@wafflebase/*` manifest strings. (Attribute `with { type:
  'json' }` had to be dropped — see lessons.)
- **[known limitation] published devDependencies show `@wafflebase/{docs,slides}@0.4.9`**
  — pnpm rewrites `workspace:*` at publish. These are `devDependencies`, which
  `npm install @wafflebase/cli` does not fetch, so the reported install path is
  unaffected; only dev-dep-walking tooling would 404. They must stay declared so
  pnpm symlinks them for the build-time tsup resolution. Inherent to publishing a
  monorepo leaf that build-depends on private siblings.
- **[intended] docs no longer published to npm** — it was only ever a transitive
  CLI dep with no external consumer; now bundled + marked private.
- **[intentional] `sourcemap: false`** — the 4.3 MB bundle is mostly minified
  third-party; shipping a same-size map (unused without `--enable-source-maps`)
  isn't worth the published-artifact weight.

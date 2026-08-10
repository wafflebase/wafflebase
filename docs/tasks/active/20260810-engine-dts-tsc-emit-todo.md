# Engine declaration builds: api-extractor → plain `tsc`

Move the five engine packages (`docs`, `sheets`, `slides`, `notes`, `board`)
off `vite-plugin-dts`'s `rollupTypes` (which runs `@microsoft/api-extractor`)
and onto a plain `tsc --emitDeclarationOnly` step, converging them on the
build shape `@wafflebase/core` already uses. Vite keeps building the JS.

## Why

`pnpm build` failed on `main` with:

```
[vite:dts] Internal Error: The referenced path was not found:
  packages/docs/dist/src/model/types.d.ts
    at SourceMapper._getMappedSourceLocation (@microsoft/api-extractor/lib/collector/SourceMapper.js:70)
```

Root cause, reproduced deterministically (two concurrent `docs` builds, 1s
apart — first attempt reproduced it on `dist/src/model/document.d.ts`):

1. `vite-plugin-dts` writes ~170 intermediate `.d.ts` files under
   `packages/docs/dist/src/**` and `dist/test/**`, rolls them up with
   api-extractor, then deletes them.
2. api-extractor raises **304** analyzer issues for `docs`
   (`ae-missing-release-tag`, `ae-forgotten-export`). For each one it calls
   `FileSystem.exists()` on the intermediate `.d.ts` to attach a source
   location, and throws a hard `InternalError` if the file is gone.
3. `Extractor.invoke` is synchronous, so nothing in its own process can
   delete those files mid-analysis — the deleter is always **another
   process** building the same package into the same `dist`.

The everyday trigger is `.githooks/pre-push` → `pnpm verify:self`, whose
lane list includes `docs:build`. A `git push` in one terminal overlapping a
`pnpm build` in another gives two concurrent `docs` builds. (The failing log
corroborates the contention: `sheets` dts took 11.4s vs 3.7s normally.)

Beyond the crash, the api-extractor path has three standing costs:

- **Silent corruption.** A build that dies mid-rollup leaves the entry
  `.d.ts` as a 2-line stub (`export * from './src/index'`) pointing at the
  already-deleted `dist/src/`. `skipLibCheck: true` means `slides`,
  `backend` and `cli` typecheck green against `any`.
- **Speed.** The dts rollup is the slowest step of each engine build
  (3.7–11s × 5 packages).
- **Two build idioms.** `core` already uses `tsc -p tsconfig.build.json`.

The rollup exists to emit one bundled `.d.ts` per package — a *publishing*
affordance. Every engine package is `private: true`; the only published
artifact is `@wafflebase/cli`, and it ships **no** declarations at all
(`tsup` is configured `dts: false`).

## Release impact — verified, none

- `.github/workflows/npm-publish.yml` publishes only `@wafflebase/cli`
  (`files: ["dist"]` → `dist/bin.js`).
- `tsup` has `noExternal: [/^@wafflebase\//]` and `platform: 'node'`, so it
  bundles engine **JS**, resolved through the `node` export condition:
  `@wafflebase/docs` → `packages/docs/dist/node.js`,
  `@wafflebase/slides` → `packages/slides/dist/node.js` (confirmed with
  `import.meta.resolve`). Declaration changes cannot reach the published
  bytes.
- `pnpm --filter @wafflebase/cli... build` runs `core → docs → slides → cli`
  in dependency order, so the release never builds one package twice — the
  concurrency crash is local-only.

Note the publish job runs `build` + `test` but **not** `typecheck`, so a
broken engine `.d.ts` would not block a release today. Hence the guard below.

## Feasibility — measured before committing

Ran `tsc --emitDeclarationOnly` with a core-style build tsconfig against each
package. The usual risk (TS4023/TS2742 "inferred type cannot be named" on a
codebase never built with `declaration: true`, which api-extractor hides by
inlining everything) did **not** materialise:

| package | result |
| ------- | ------ |
| `docs`   | 0 errors |
| `slides` | 0 errors |
| `sheets` | 3 errors, mechanical (see below) |
| `notes`  | 0 errors (after excluding in-`src` tests) |
| `board`  | 0 errors |

`sheets` needs `rootDir: "."` (ANTLR output lives in `packages/sheets/antlr/`,
outside `src` — TS6059 ×2) and must exclude the dev-only `src/main.ts`
(`.ts`-extension import — TS5097). Its `types` entry therefore becomes
`dist/src/index.d.ts`.

## Non-goals

- **No build lock / mutex.** It would make concurrent builds "work" while
  preserving the slow, fragile pipeline, and fixes none of the three
  standing costs. Overlapping builds stay an operator concern.
- Not closing the shared-`dist` race itself. Two builds writing one `dist`
  stays unsafe; the failure mode just degrades from "hard crash + silently
  corrupted `dist`" to "output clobbered, rebuild".
- No change to any package's JS output, exports surface, or public API.

## Plan

### 1. Per-package conversion

For each of `docs`, `slides`, `notes`, `board`, `sheets`:

- [x] Add `tsconfig.build.json` extending the package tsconfig with
      `noEmit: false`, `emitDeclarationOnly: true`, `declaration: true`,
      `allowImportingTsExtensions: false`, `outDir: "dist"`, `rootDir`, and
      `include`/`exclude` that omit tests. **Do not** move `include`/
      `exclude` into the main `tsconfig.json` — `pnpm <pkg> typecheck` reads
      that one, and excluding `test` there would silently drop test
      typecheck coverage from `verify:fast`.
- [x] Change `build` to `vite --config vite.build.ts build && tsc -p tsconfig.build.json`.
      Order matters: vite's `emptyOutDir` would wipe declarations emitted first.
- [x] Drop the `dts()` plugin from `vite.build.ts`.
- [x] Repoint `types` and every `exports.*.types` at the emitted paths
      (`dist/index.d.ts`, `dist/node.d.ts`; `dist/src/...` for `sheets`).
- [x] Remove the `vite-plugin-dts` devDependency.

### 2. Guard against stub / missing declarations

- [x] Add a script that resolves each engine package's declared `types` (and
      `exports.*.types`) entries and asserts they exist and are not stubs.
- [x] Wire it into `verify:self`.
- [x] Wire it into `.github/workflows/npm-publish.yml`, which currently runs
      no typecheck at all.

### 3. Verification

- [x] `pnpm build` green from a clean `dist`.
- [x] `pnpm verify:fast` green.
- [x] `pnpm --filter @wafflebase/cli typecheck` + `test` green (real consumer
      of `docs`/`slides` declarations).
- [x] `pnpm backend build` green (consumer of `docs`/`sheets`/`slides`).
- [x] `pnpm slides typecheck` green (consumer of `docs` declarations).
- [x] Confirm no engine `.d.ts` regressed to a stub, and that emitted
      declarations resolve **without** `skipLibCheck`.
- [x] Diff the built JS against `main` to confirm the JS output is byte-identical.

## Review

Shipped as planned; no scope changes.

### Result

| check | result |
| ----- | ------ |
| `pnpm build` from a wiped `dist/` | green |
| `pnpm verify:fast` | green |
| `pnpm cli typecheck` / `pnpm cli test` | green |
| `pnpm backend build` | green |
| `pnpm slides typecheck` | green |
| `notes` / `board` typecheck | green |
| built JS vs `main` (172 `.js`/`.cjs` files, sha256) | **byte-identical** |
| all 7 declaration entries with `skipLibCheck: false` | 0 errors |
| `verify-dts-entries.mjs` on the historical stub corruption | exits 1 with a useful message |

The byte-identical JS is the release-safety proof: `@wafflebase/cli` bundles
engine **JS** (`tsup`, `noExternal: [/^@wafflebase\//]`, `dts: false`) and ships
no declarations, so an unchanged JS output means the npm artifact cannot have
moved.

Build time improved as a side effect — `docs` went from 5.98s to ~4.1s, and
the api-extractor step (3.7–11s, and the source of the crash) is gone entirely.

### Deviations from the plan

- The build tsconfigs also exclude `src/**/*.test.ts(x)`, not just
  `test/**/*`. `sheets`/`slides`/`notes`/`board` keep tests inside `src`;
  `notes` failed to emit without this.
- `verify-dts-entries.mjs` gained an argument mode. `verify:self` and
  `npm-publish.yml` each build only the subset they need, so named packages
  are required and unnamed ones are skipped when unbuilt.

### Known limitations

- The shared-`dist` race is not closed, by design (see Non-goals). Two
  concurrent builds of one package still clobber each other; the failure mode
  is now a recoverable rebuild instead of a hard crash plus silent corruption,
  and `verify:dts` catches the corrupted state if it happens.
- `notes` and `board` are built by no gate — not the root `build` script, not
  any `verify:self` lane — because `frontend` aliases them to source. Their
  migration is therefore covered only by the explicit builds run here. Closing
  that gap is a separate change.


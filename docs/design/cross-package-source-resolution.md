---
title: cross-package-source-resolution
target-version: 0.4.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Cross-Package Source Resolution for Dev & Test

## Summary

In the monorepo, consumers (`frontend`, `backend`, `cli`, and `slides`)
resolve their workspace dependencies (`@wafflebase/sheets`,
`@wafflebase/docs`, `@wafflebase/slides`) through each package's **built
`dist/`** output rather than its TypeScript source. `dist/` is
`.gitignore`d and is not rebuilt by the inner-loop gates (`verify:fast`,
one-off `--filter` test runs, fresh worktrees). As a result, editing a
package's `src/` — for example adding an export — is invisible to
consumers until that package is rebuilt, producing failures that look
like regressions but are pure staleness:

- `SyntaxError: The requested module '@wafflebase/slides' does not
  provide an export named '...'` (runtime test channel)
- `TS2353` / "Property does not exist" / "missing export" during
  typecheck (type channel)

This pattern is the single most frequently recorded process pain in the
task-lessons corpus: across ~137 lessons files, **~18 distinct tasks**
hit stale-`dist/` false failures (`verify:fast` in 18, `stale` in 13,
`dist/` in 12, overlapping on one root cause). Representative entries:
`20260430-pdf-export`, `20260508-slides-layout-change`,
`20260509-slides-shapes-p1`, `20260515-slides-connectors-pr1`,
`20260516-pptx-table-cell-margins`, `20260517-pptx-connector-site-ind`.

This proposal makes dev/test resolution **source-first** so that a source
edit is immediately visible to consumers without any rebuild step,
eliminating this class of false failure at its root.

### Why #287 did not fix it

Commit `f5a5191f` ("Build packages in dependency order in pnpm build",
#287) reordered the root `build` script into topological order
(`(docs, sheets) → slides → (frontend, backend, cli)`). This fixes the
**from-scratch `pnpm build` / CI full-build** path, where a parallel,
unordered build let consumers compile against outdated dependency
declarations.

It does **not** address the inner loop, because:

1. `verify:fast` contains **no build step** — it runs `frontend test`,
   `slides typecheck`, etc. directly against whatever `dist/` happens to
   exist.
2. Package `exports`/`types` still point at `dist/` (`packages/*/package.json`),
   so `tsc` reads `dist/*.d.ts`.
3. The runtime test hook prefers `dist/` whenever it exists
   (`packages/frontend/tests/resolve-hooks.mjs:71-99`), falling back to
   source only when `dist/` is entirely **absent** — which is never the
   case once a developer has built at least once.

#287's own commit message names the root cause ("cross-package type
resolution reads each dependency's built `dist/*.d.ts` … rather than its
source") but keeps the resolution pointed at `dist/`; it only ensures
`dist/` is fresh at full-build time. The inner loop is unchanged.

### Goals

- A source edit in a workspace package is visible to a consumer's
  **typecheck** with **no rebuild step**, killing the `TS2353` /
  "missing export" stale-`dist/` false-failure class in `verify:fast`.
- Production builds (`pnpm build`) and published/runtime consumers are
  unaffected — they continue to resolve `dist/`.
- The mechanism is opt-in per consumer and inert to every resolver that
  does not explicitly enable it (Node, Vite serve/build, eslint, IDE).

### Non-Goals

- The **runtime test channel** (`resolve-hooks`). Validated as blocked
  under strip-types (see "Constraint A"); addressed separately by migrating
  the frontend test runner to Vitest (#291).
- Changing what gets **published** or how `pnpm build` emits `dist/`
  (#287's topological ordering stays).
- Full TypeScript project references (`tsc -b`). Heavier; would be the
  correct way to extend source resolution to cross-environment consumers
  (see Constraint B) but is out of scope here.
- The unrelated lessons-corpus themes (OOXML import-primitive duplication;
  task-lifecycle closure). Tracked separately.

## Proposal Details

There are two independent resolution channels. This work targets the
typecheck channel; the runtime channel is handled separately by the Vitest
migration (#291).

| Channel | Driver | Resolves to | Status |
|---|---|---|---|
| Typecheck | `tsc` → package.json `exports` | `dist/*.d.ts` | **Fixed (this PR, slides→docs)** via a custom source condition |
| Runtime tests | `resolve-hooks` custom loader | `dist/` if present, else src, else stub | **Solved in #291** (frontend → Vitest); strip-types limit (Constraint A) no longer applies |

### Implemented — typecheck via a custom `wafflebase-source` condition

Each library declares a custom source condition in its `exports`, placed
**first** so it wins when active; the consumer enables it via
`customConditions`. Implemented edge: `slides typecheck` → `@wafflebase/docs`
source.

```jsonc
// packages/docs/package.json — source entry first, dist entries unchanged
"exports": {
  ".": {
    "wafflebase-source": "./src/index.ts",
    "node": { /* …dist… */ },
    "types": "./dist/wafflebase-document.es.d.ts",
    "import": "./dist/wafflebase-document.es.js",
    "require": "./dist/wafflebase-document.cjs",
    "default": "./dist/wafflebase-document.es.js"
  }
}
```

```jsonc
// packages/slides/tsconfig.json (typecheck-only; slides build uses Vite)
"compilerOptions": {
  "moduleResolution": "bundler",
  "customConditions": ["wafflebase-source"],
  "allowImportingTsExtensions": true
}
```

`tsc` (TS 5.9, repo on `^5.9.3`) then resolves `@wafflebase/docs` to
`packages/docs/src/index.ts` during `slides typecheck`. `allowImportingTsExtensions`
is required because the resolved target is a `.ts` file, and it in turn
requires `noEmit` — satisfied because `slides typecheck` is `tsc --noEmit`
and `slides build` is Vite (does not read this tsconfig for emit).

**Why a dedicated `wafflebase-source` condition, not the conventional
`development`?** `development` is also enabled by Vite's dev server, which
would silently switch the frontend dev server to load workspace source —
a side effect outside this change's scope. A made-up condition name is
matched by nothing except the `customConditions` opt-in, keeping the blast
radius to exactly the configs that name it.

**Why a separate typecheck tsconfig is needed for some consumers.**
A package whose `build` is `tsc` (e.g. `cli`) shares one tsconfig
between build and typecheck. `allowImportingTsExtensions`/`customConditions`
cannot live there (they would break the emitting build), so such a consumer
needs a `noEmit` typecheck tsconfig that `extends` the base and is
referenced by its `typecheck` script. Packages whose `build` is Vite
(`docs`, `slides`, `sheets`) keep a single typecheck-only tsconfig.

### Validated constraints (the hard-won part)

**Constraint A — the runtime test channel cannot go source-first under
`--experimental-strip-types`.** Flipping `resolve-hooks` to prefer
source dropped `pnpm frontend test` from 88 suites to 19 with 23 import
failures, from three causes the bundled `dist/` had hidden:

1. `ERR_UNSUPPORTED_DIR_IMPORT` — `packages/slides/src/index.ts` does
   `export … from './import/pptx'` (a directory); Node ESM needs `/index`.
2. `antlr4ts/CharStream does not provide export 'CharStream'` — CJS
   named-export interop the bundler resolved but raw Node ESM does not.
3. `TypeScript parameter property is not supported in strip-only mode` —
   `packages/docs/src/view/find-replace.ts` uses `constructor(private doc: Doc, …)`;
   strip-types only removes types, it cannot emit the property assignment.

`#3` is fundamental: strip-types is not a transpiler. Loading source in the
test runner therefore requires a transpiling loader. Rather than patch the
custom loader, the frontend test runner was migrated to **Vitest** (#291),
whose Vite/esbuild pipeline handles all three blockers and reuses
`packages/frontend/vite.config.ts`'s existing source aliases — so the runtime channel now
resolves workspace deps to source too, and `resolve-hooks` is removed.

**Constraint B — `customConditions`-to-source compiles the dependency's
source under the *consumer's* compiler options.** This works only when the
two packages share a compatible environment. `slides typecheck → docs`
works (both browser/canvas, `lib: [DOM]`). `cli typecheck → slides`
**fails**: `cli` is a Node program (`lib: [ES2022]`, no DOM), so following
`slides` source surfaces `error TS2304: Cannot find name 'Path2D'` across
its shape files. `skipLibCheck` hid this for `dist/*.d.ts` but does not
apply to followed `.ts` source. Extending source resolution to
cross-environment consumers (cli, backend) needs project references (each
package checks its own files with its own `lib`), not this mechanism — so
they stay on `dist/` for now.

### Verification (performed)

1. **No regression:** `pnpm slides typecheck` green; full `pnpm verify:fast`
   exit 0 (`docs test` — the last `&&`-chained lane — runs, so every prior
   lane incl. `slides typecheck` passed).
2. **Reads source, not dist (positive):** appended a symbol to
   `packages/docs/src/index.ts` only (absent from `docs/dist`), referenced it from
   `slides/src`, ran `pnpm slides typecheck` **without** rebuilding docs →
   green. Reverted.
3. **Negative control:** same probe with `customConditions` removed →
   `tsc` exit 2 (correctly resolves stale `dist`). Confirms the condition,
   not something else, is what makes source visible.

### Follow-ups

- ~~**Runtime test channel (Constraint A):**~~ Done — frontend tests
  migrated to Vitest (#291), which resolves workspace deps to source via the
  reused `packages/frontend/vite.config.ts` aliases.
- **cli / backend typecheck (Constraint B):** adopt TS project references
  to resolve their workspace deps to source under each package's own `lib`.
- **frontend typecheck / eslint:** not a `verify:fast` lane today; could
  opt into `wafflebase-source` later for IDE/lint accuracy.
- **harness-engineering.md** "Dependency Layering": document the
  source-first typecheck contract once it covers more edges.

## Risks and Mitigation

- **Source compiled under consumer config (Constraint B).** Mitigation:
  only wire edges where the two packages share a compatible `lib`/strictness
  (slides↔docs verified). New edges must be validated, not assumed.
- **Inert-condition assumption.** A custom `wafflebase-source` key is
  skipped by any resolver that doesn't enable it. Mitigation: kept the full
  `node`/`types`/`import`/`require`/`default` set after it; `pnpm build`,
  frontend Vite serve/build, and `pnpm frontend test` were unaffected
  (verify:fast green).
- **Deep subpath imports.** `wafflebase-source` was added only to the
  `.` root that is actually consumed (slides imports `@wafflebase/docs`
  root only). Subpaths (`/node`) keep `dist` until a consumer needs them.
- **CI parity.** CI still builds `dist/` (`verify:self`), so the publish
  resolution path stays exercised on every PR; only the pre-commit
  `slides typecheck` lane reads source.
